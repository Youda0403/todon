import {advanceDialogue,validateRule,newId,formatMessage,upgradeActions,statView} from './engine.mjs';
import {esc,actionsHTML,collectActions,actionCommand,listsHTML,variableHTML} from './action-editor.mjs';
const $=(s,r)=>r.querySelector(s),$$=(s,r)=>[...r.querySelectorAll(s)];
const editors=new Map();
export function mountDialogueEditor(root,ctx){
  const rule=ctx.rule,d=rule.dialogue,c=ctx.config||{fields:ctx.fields,items:[]};
  for(const s of d.scenes)upgradeActions(s.actions);
  if(!editors.has(rule.id))editors.set(rule.id,{sceneId:d.start,runner:'a',sim:{},log:{}});
  const v=editors.get(rule.id);if(!d.scenes.some(s=>s.id===v.sceneId))v.sceneId=d.start;
  const scene=d.scenes.find(s=>s.id===v.sceneId)||d.scenes[0];
  const options=(value,add=false)=>'<option value="">다음 장면 선택</option>'+d.scenes.map(s=>`<option value="${esc(s.id)}" ${s.id===value?'selected':''}>${esc(s.title)}</option>`).join('')+(add?'<option value="__new__">+ 새 장면 만들어 연결</option>':'');
  const keyOptions=(map,current)=>[...new Set([...map,current].filter(Boolean))].map(k=>`<option value="${esc(k)}" ${k===current?'selected':''}>${esc(k)}</option>`).join('');
  root.innerHTML=`${listsHTML(c)}<div class="dialogue-builder"><section class="card" id="dialogueEditor"><div class="card-head"><h2>선택지형 조사</h2><label class="checkline"><input data-rule-prop="enabled" type="checkbox" ${rule.enabled?'checked':''}> 이 규칙 켜기</label></div><p class="notice">시작 키워드 → 첫 장면 → 러너의 선택 → 다음 장면 순서로 이어져요. 답장을 쉬어도 진행 상황이 저장되어 다음 답부터 이어져요.</p><div class="form-grid"><label>조사 이름<input data-rule-prop="name" value="${esc(rule.name)}" maxlength="80"></label><label>답장할 운영 계정<select data-rule-prop="accountId">${ctx.accountOptions(rule.accountId)}</select></label><label>조사를 시작하는 키워드<input data-rule-prop="keyword" value="${esc(rule.keyword)}"></label><label>첫 장면<select data-dialogue-prop="start">${options(d.start)}</select></label></div><details class="dialogue-controls"><summary>시작 키워드 인식·횟수 설정</summary><div class="form-grid"><label>인식 방식<select data-rule-prop="match"><option value="contains" ${rule.match==='contains'?'selected':''}>문장에 포함되면</option><option value="exact" ${rule.match==='exact'?'selected':''}>명령 전체가 같으면</option></select></label><label>러너당 하루 새 조사 횟수 · 0은 무제한<input data-rule-prop="dailyLimit" type="number" value="${rule.dailyLimit}" min="0" max="1000"></label><label>새 조사 시작 대기시간 · 초<input data-rule-prop="cooldown" type="number" value="${rule.cooldown}" min="0" max="86400"></label></div><p class="inline-help">진행 중인 선택지에 답하는 횟수는 여기서 차감하지 않아요. 등록된 러너가 운영 계정에 보낸 새 멘션에 반응해요.</p></details><div class="dialogue-scene-heading"><h3>편집할 장면</h3><button data-editor-act="addScene" class="small">+ 장면 추가</button></div><div class="dialogue-scene-list">${d.scenes.map(s=>`<button data-scene-pick="${esc(s.id)}" class="small ${s.id===scene.id?'green':''}">${esc(s.title)}${s.id===d.start?' · 시작':s.end?' · 끝':''}</button>`).join('')}</div><div class="dialogue-scene-editor"><label>장면 이름 · 운영자에게만 보임<input data-scene-prop="title" value="${esc(scene.title)}" maxlength="80"></label><section class="scene-stage"><h3>① 이 장면에 도착하면 보내는 이야기 · 선택 사항</h3><p class="inline-help">첫 장면이면 시작 키워드를 받았을 때, 다른 장면이면 이곳으로 연결된 선택지를 골랐을 때 나와요. 이 문장 속 수치는 결과 적용 전의 값이에요. 비워두면 앞 문장 없이 ② 결과와 ③ 선택지 또는 종료 문장만 보내요.</p><label>장면 이야기 · 선택 사항<textarea id="sceneNarrative" data-scene-prop="text" rows="4" maxlength="1500" placeholder="이야기 없이 결과만 보내려면 비워두세요.">${esc(scene.text)}</textarea></label>${variableHTML(c,'sceneNarrative',false)}</section><section class="scene-stage"><h3>② 이어서 처리할 결과</h3><p class="inline-help">필요한 작업을 추가해 주세요. 확률별 결과 안에도 아이템 획득·HP 감소·랜덤 능력치 상승 등을 함께 넣을 수 있어요. 같은 조사에서 같은 장면의 결과는 한 번만 적용해요.</p><div id="sceneActions">${actionsHTML(scene.actions,c)}</div><a href="#catalog" class="text-link">아이템·능력치 목록 관리 ↗</a></section><label class="checkline"><input data-scene-prop="end" type="checkbox" ${scene.end?'checked':''}> 이 장면에서 조사를 마칩니다</label><section class="scene-stage"><h3>③ ${scene.end?'마지막에 보낼 종료 문장':'다음 선택지 보내기'}</h3>${scene.end?`<p class="inline-help">① 이야기와 ② 결과 다음에 붙는 마지막 문장이에요. 종료 문장을 따로 보내지 않으려면 비워두세요.</p><label>조사를 마무리하는 문장<textarea id="sceneEnding" data-scene-prop="endText" rows="2" maxlength="1500">${esc(scene.endText??d.endText??'조사가 끝났어요.')}</textarea></label>${variableHTML(c,'sceneEnding')}`:`<p class="inline-help">조건이 맞는 선택지만 번호를 다시 매겨 러너에게 보여줘요. 숨긴 선택지의 키워드를 직접 보내도 이동하지 않아요.</p><div class="dialogue-choices">${scene.choices.map((choice,i)=>{const condition=choice.conditions?.[0],target=condition?.target||'';return `<section class="dialogue-choice-v2" data-choice-row="${i}"><div class="card-head"><strong>선택지 ${i+1}</strong><button data-choice-delete="${i}" class="small danger">선택지 삭제</button></div><div class="form-grid"><label>러너에게 보여줄 선택지<input data-choice-key value="${esc(choice.keyword)}" maxlength="80"></label><label class="span2">인식할 키워드 · 쉼표로 구분<input data-choice-aliases value="${esc((choice.keywords||[]).join(', '))}" placeholder="예: 칼, 벗긴다"></label><p class="inline-help span2">쉼표로 여러 개를 적을 수 있어요. 예: 선택지는 ‘칼로 벗긴다’, 인식어는 ‘칼’. 비우면 선택지 문구로 인식하고, 문구 전체나 번호도 항상 사용할 수 있어요.</p><label>이 선택지를 고르면 이동할 장면<select data-choice-next>${options(choice.next,true)}</select></label><label>이 선택지를 보여줄 조건<select data-choice-condition><option value="" ${!target?'selected':''}>항상 표시</option><option value="item" ${target==='item'?'selected':''}>아이템 수량이 조건에 맞을 때</option><option value="stat" ${target==='stat'?'selected':''}>능력치·변수가 조건에 맞을 때</option></select></label>${target?`<label>${target==='item'?'필요 아이템':'능력치·변수'}<select data-condition-key>${keyOptions(target==='item'?(c.items||[]).map(i=>i.name):Object.keys(c.fields||{}),condition.key)}</select></label><label>비교<select data-condition-op>${[['>=','이상'],['<=','이하'],['==','같음'],['>','초과'],['<','미만']].map(([op,t])=>`<option value="${op}" ${condition.op===op?'selected':''}>${t}</option>`).join('')}</select></label><label>기준 수치<input data-condition-amount type="number" value="${condition.amount}" step="any"></label>`:''}</div></section>`;}).join('')}</div><button data-editor-act="addChoice" class="small">+ 선택지 추가</button>`}</section><button data-editor-act="deleteScene" class="small danger" ${d.scenes.length===1?'disabled':''}>이 장면 삭제</button></div><div class="editor-foot"><button data-editor-act="save" class="primary">규칙 저장</button><button data-editor-act="copy">복제</button><button data-editor-act="delete" class="danger">규칙 삭제</button></div></section><section class="card dialogue-practice" id="dialoguePractice"></section></div>`;
  const collect=()=>{
    for(const el of $$('[data-rule-prop]',root))rule[el.dataset.ruleProp]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
    for(const el of $$('[data-dialogue-prop]',root))d[el.dataset.dialogueProp]=el.value;
    for(const el of $$('[data-scene-prop]',root))scene[el.dataset.sceneProp]=el.type==='checkbox'?el.checked:el.value;
    if(!scene.end&&$('.dialogue-choices',root))scene.choices=$$('[data-choice-row]',root).map((row,i)=>{
      const target=$('[data-choice-condition]',row).value,old=scene.choices[i]?.conditions||[];
      return {keyword:$('[data-choice-key]',row).value.trim(),keywords:$('[data-choice-aliases]',row).value.split(/[,\n]+/).map(k=>k.trim()).filter(Boolean),next:$('[data-choice-next]',row).value,conditions:target?[{target,key:$('[data-condition-key]',row)?.value||old[0]?.key||(target==='item'?c.items?.[0]?.name:Object.keys(c.fields||{})[0])||'',op:$('[data-condition-op]',row)?.value||'>=',amount:Number($('[data-condition-amount]',row)?.value??1)},...old.slice(1)]:[]};
    });
    collectActions($('#sceneActions',root),scene.actions);
  };
  const redraw=()=>{const y=window.scrollY;mountDialogueEditor(root,ctx);window.scrollTo(0,y);},changed=()=>ctx.onChange();
  const makeScene=title=>{if(d.scenes.length>=60)throw Error('장면은 최대 60개예요.');const s={id:newId(),title:title||'새 장면',text:'',end:true,endText:'',choices:[],actions:[]};d.scenes.push(s);return s;};
  root.oninput=e=>{if(e.target.closest('#dialoguePractice'))return;try{collect();changed();}catch(error){ctx.onError(error.message);}};
  root.onchange=e=>{if(e.target.closest('#dialoguePractice'))return;try{
    collect();
    if(e.target.matches('[data-choice-next]')&&e.target.value==='__new__'){const index=Number(e.target.closest('[data-choice-row]').dataset.choiceRow),s=makeScene(scene.choices[index].keyword);scene.choices[index].next=s.id;v.sceneId=s.id;}
    if(e.target.matches('[data-choice-condition],[data-choice-next],[data-scene-prop="end"]')){changed();redraw();}
  }catch(error){ctx.onError(error.message);}};
  root.onclick=async e=>{
    const b=e.target.closest('button');if(!b||b.closest('#dialoguePractice')||b.disabled)return;e.preventDefault();
    try{
      collect();const command=actionCommand(b,scene.actions,c);if(command){if(command==='redraw'){changed();redraw();}return;}
      if(b.dataset.scenePick){v.sceneId=b.dataset.scenePick;redraw();return;}
      if(b.dataset.choiceDelete!==undefined){if(!confirm('이 선택지를 삭제할까요?'))return;scene.choices.splice(Number(b.dataset.choiceDelete),1);changed();redraw();return;}
      const act=b.dataset.editorAct;
      if(act==='save'){validateRule(rule);b.disabled=true;await ctx.onSave();return;}
      if(act==='copy'){await ctx.onCopy();return;}
      if(act==='delete'){if(confirm('이 조사 규칙 전체를 삭제할까요?'))await ctx.onDelete();return;}
      if(act==='addScene')v.sceneId=makeScene().id;
      if(act==='addChoice'){if(scene.choices.length>=9)throw Error('선택지는 최대 9개예요.');scene.choices.push({keyword:'새 선택지',next:'',conditions:[]});}
      if(act==='deleteScene'){
        if(!confirm('이 장면과 그 안의 결과를 삭제할까요? 이 장면으로 향하는 선택지 연결도 해제돼요.'))return;
        d.scenes=d.scenes.filter(s=>s.id!==scene.id);for(const s of d.scenes)for(const choice of s.choices)if(choice.next===scene.id)choice.next='';
        if(d.start===scene.id)d.start=d.scenes[0].id;v.sceneId=d.start;
      }
      changed();redraw();
    }catch(error){ctx.onError(error.message);}finally{b.disabled=false;}
  };
  function simulation(){return v.sim[v.runner]??=( {actor:{name:'연습 러너 '+v.runner.toUpperCase(),stats:structuredClone(c.fields||{}),inventory:{}},session:null});}
  function appliedStatsText(){const view=statView(simulation().actor,c);return '적용 중인 수치: '+Object.entries(view.stats).map(([k,n])=>k+' '+n+(Object.hasOwn(view.maxima,k)?'/'+view.maxima[k]:'')).join(' · ');}
  function recordHTML(){const sim=simulation();return `<details><summary>시험용 능력치·소지품 바꾸기</summary><p class="notice" data-practice-applied>${esc(appliedStatsText())}</p><p class="inline-help">아래 능력치는 아이템 보정 전 기본 수치예요. 소지 수량을 바꾸면 상시 효과와 선택지 조건도 바뀌어요.</p><div class="practice-values">${Object.entries(sim.actor.stats).map(([k,n])=>`<label>${esc(k)}<input data-practice-stat="${esc(k)}" type="number" value="${n}"></label>`).join('')}${[...new Set([...(c.items||[]).map(i=>i.name),...Object.keys(sim.actor.inventory)])].map(k=>`<label>${esc(k)} 소지 수량<input data-practice-item="${esc(k)}" type="number" value="${sim.actor.inventory[k]||0}" min="0" step="1"></label>`).join('')}</div></details>`;}
  function chatHTML(){return (v.log[v.runner]||[]).map(m=>`<div class="bubble ${m.me?'me':''}">${esc(m.text)}</div>`).join('')||'<p class="inline-help">‘시작 키워드 보내기’를 누른 다음 단어나 번호로 답해 보세요.</p>';}
  function updatePractice(){
    const sim=simulation(),current=sim.session&&d.scenes.find(s=>s.id===sim.session.sceneId);
    $('#practiceState',root).textContent=sim.session?(sim.session.status==='ended'?'조사 완료 · ':'진행 중 · ')+(current?.title||'변경된 장면'):'아직 시작하지 않았어요.';
    const chat=$('#practiceLog',root);chat.innerHTML=chatHTML();chat.scrollTop=chat.scrollHeight;
    $('#practiceRecords',root).innerHTML=recordHTML();
  }
  function send(text){
    collect();validateRule(rule);if(!text.trim())throw Error('보낼 답장을 적어 주세요.');
    const sim=simulation();const out=advanceDialogue(rule,sim.actor,text,sim.session,{items:c.items||[],statMaxes:c.statMaxes||{}});
    v.sim[v.runner]={actor:{...sim.actor,stats:out.stats,inventory:out.inventory},session:out.session};
    v.log[v.runner]=[...(v.log[v.runner]||[]),{me:true,text},...out.replies.map(text=>({text}))].slice(-40);
    $('#practiceReply',root).value='';updatePractice();
  }
  const practice=$('#dialoguePractice',root);
  practice.innerHTML=`<div class="card-head"><h2>대화하며 연습하기</h2><button class="small" data-practice-act="reset">처음부터</button></div><p class="inline-help">실제 계정과 기록은 바뀌지 않아요. 설정을 고쳤다면 ‘처음부터’로 다시 시험해 주세요.</p><label>시험할 러너<select id="practiceRunner"><option value="a" ${v.runner==='a'?'selected':''}>연습 러너 A</option><option value="b" ${v.runner==='b'?'selected':''}>연습 러너 B</option></select></label><p id="practiceState" class="dialogue-progress" role="status"></p><div class="dialogue-chat" id="practiceLog" aria-live="polite"></div><div class="practice-reply-row"><input id="practiceReply" aria-label="조사 연습 답장" placeholder="선택지 단어 또는 번호"><button data-practice-act="send" class="green">답장 보내기</button></div><div class="actions dialogue-practice-controls"><button data-practice-act="start" class="small">시작 키워드 보내기</button><button data-practice-act="current" class="small">현재 장면 다시 보기</button></div><div id="practiceRecords"></div><details><summary>등록한 아이템 사용 시험</summary><div class="action-add"><select id="practiceUseItem" aria-label="시험할 사용 아이템"><option value="">아이템 선택</option>${(c.items||[]).filter(i=>i.usable).map(i=>`<option value="${esc(i.name)}">${esc(i.name)}</option>`).join('')}</select><button data-practice-act="use" class="small">사용해 보기</button></div></details>`;
  updatePractice();
  practice.oninput=e=>{
    e.stopPropagation();const sim=simulation();if(e.target.dataset.practiceStat!==undefined)sim.actor.stats[e.target.dataset.practiceStat]=Number(e.target.value);
    if(e.target.dataset.practiceItem!==undefined)sim.actor.inventory[e.target.dataset.practiceItem]=Number(e.target.value);
    if(e.target.matches('[data-practice-stat],[data-practice-item]'))$('[data-practice-applied]',practice).textContent=appliedStatsText();
  };
  practice.onchange=e=>{e.stopPropagation();if(e.target.id==='practiceRunner'){v.runner=e.target.value;updatePractice();}};
  practice.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.target.id==='practiceReply'){e.preventDefault();$('[data-practice-act="send"]',root).click();}};
  practice.onclick=async e=>{
    const b=e.target.closest('button');if(!b)return;e.stopPropagation();e.preventDefault();
    try{
      if(b.dataset.practiceAct==='send')send($('#practiceReply',root).value);
      if(['start','current'].includes(b.dataset.practiceAct))send(rule.keyword);
      if(b.dataset.practiceAct==='reset'){if(!confirm('이 연습 러너의 대화와 시험 기록을 초기화할까요?'))return;delete v.sim[v.runner];v.log[v.runner]=[];updatePractice();}
      if(b.dataset.practiceAct==='use'){
        const {execute}=await import('./engine.mjs'),name=$('#practiceUseItem',root).value;if(!name)throw Error('사용할 아이템을 골라 주세요.');
        const sim=simulation(),out=execute({blocks:[{type:'useItem',key:name,amount:1}]},sim.actor,{items:c.items,statMaxes:c.statMaxes||{}});
        sim.actor={...sim.actor,stats:out.stats,inventory:out.inventory};v.log[v.runner]=[...(v.log[v.runner]||[]),{me:true,text:name+' 사용'},...out.replies.map(text=>({text}))];updatePractice();
      }
    }catch(error){ctx.onError(error.message);}
  };
}
