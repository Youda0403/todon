import {example,execute,validateRule,numericMap,cleanKey,matches,newId} from './engine.mjs';
const $=(s,root=document)=>root.querySelector(s),$$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=newId;
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const initial=()=>({config:{paused:true,rules:[example('check','practice'),example('dice','practice')],fields:{체력:100,관찰력:0,소지금:0},events:[],invites:{},dailyCap:1500,revision:0},accounts:[{id:'practice',label:'연습 계정',acct:'practice@planet.moe',active:1}],participants:[{id:'practice-runner',name:'연습 러너',acct:'runner@planet.moe',stats:{체력:100,관찰력:0,소지금:0},inventory:{회복약:2},revision:0}],audit:[],outbox:[],runtime:{}});
let S=read('cc.practice.v1',null)||initial(),online=false,secret=sessionStorage.getItem('cc.admin')||'',active=localStorage.getItem('cc.account')||'',selected='',draft=null,dirty=false;
let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),story={title:'첫 번째 이야기',start:new Date(Date.now()+600000),scenes:[]};
let simulation=null,toastTimer;
const pages=[['home','◷','오늘의 운영'],['bots','▧','자동봇 제작소'],['story','▷','스토리 진행실'],['runners','♙','러너 기록부'],['calendar','▦','운영 캘린더'],['accounts','◎','운영 계정'],['settings','⚙','연결·설정']];
const route=()=>location.hash.slice(1).split('?')[0]||'home';
const dateTime=t=>new Date(Number(t)||t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const inputDate=t=>{const d=new Date(t);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const koreaDay=t=>new Date(new Date(t).getTime()+9*3600000).toISOString().slice(0,10);
const activeAccount=()=>S.accounts.find(a=>a.id===active)||S.accounts[0];
const accountOptions=value=>'<option value="">발신 계정 선택</option>'+S.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===value?'selected':''}>${esc(a.label)} · @${esc(a.acct.split('@')[0])}</option>`).join('');
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function persist(){if(!online)localStorage.setItem('cc.practice.v1',JSON.stringify(S));}
async function api(path,method='GET',body){
  const response=await fetch(path,{method,headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let data;try{data=await response.json();}catch{throw Error('아직 실행 서버에 연결되지 않았어요. 설정 안내를 확인해 주세요.');}
  if(!response.ok)throw Error(data.error||'요청을 처리하지 못했어요.');return data;
}
function action(selector,fn,root=document){for(const element of $$(selector,root))element.addEventListener('click',async e=>{e.preventDefault();if(element.disabled)return;element.disabled=true;try{await fn(e,element);}catch(error){toast(error.message);}finally{element.disabled=false;}});}
function modal(html){$('#modalBody').innerHTML=html;$('#modal').showModal();}
function close(){ $('#modal').close(); }
$('#closeModal').onclick=close;
async function reload(){S=await api('/api/state');online=true;sessionStorage.setItem('cc.admin',secret);dirty=false;draft=null;selected='';render();}
async function saveConfig(){if(online){const result=await api('/api/config','PUT',S.config);S.config.revision=result.revision;}else persist();dirty=false;toast(online?'서버에 저장했어요.':'이 기기의 연습 설정에 저장했어요.');}
async function connect(){
  modal(`<h2>운영실 연결</h2><p>Cloudflare에 등록한 운영 암호를 입력해 주세요. 이 암호는 이 탭이 열린 동안만 기억해요.</p><label>운영 암호<input id="adminSecret" type="password" autocomplete="current-password" minlength="24"></label><div class="actions" style="margin-top:20px"><button id="doConnect" class="primary">연결하기</button><button id="demoMode">연습 모드로</button></div>`);
  action('#doConnect',async()=>{secret=$('#adminSecret').value;await reload();close();toast('실제 운영실에 연결했어요.');});
  action('#demoMode',()=>{sessionStorage.removeItem('cc.admin');secret='';online=false;S=read('cc.practice.v1',null)||initial();draft=null;selected='';close();render();});
}
$('#connect').onclick=connect;
$('#refresh').onclick=async()=>{if(dirty&&!confirm('저장하지 않은 편집을 버리고 불러올까요?'))return;try{if(online)await reload();else render();toast(online?'서버 기록을 불러왔어요.':'연습 모드예요. 실제 연결은 서버 연결을 눌러 주세요.');}catch(e){toast(e.message);}};
$('#activeAccount').onchange=e=>{active=e.target.value;localStorage.setItem('cc.account',active);toast('발신 기본 계정을 바꿨어요.');};
window.addEventListener('hashchange',()=>{if(dirty){toast('편집 중인 내용은 현재 화면에만 있어요. 돌아와 저장해 주세요.');}render();window.scrollTo(0,0);});
const heading=(eyebrow,title,sub,buttons='')=>`<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${buttons}</div></div>`;
const empty=(text)=>`<div class="empty"><div class="empty-mark">✳</div>${text}</div>`;
const timeline=(events)=>events.length?events.map(e=>`<div class="timeline-item"><span class="time-label">${esc(new Date(e.at).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}))}</span><div><div class="event-name">${esc(e.title)}</div><div class="event-desc">${esc(e.note||'운영 일정')}</div></div></div>`).join(''):empty('오늘 등록된 일정이 없어요.');
function render(){
  const current=route();$('#nav').innerHTML=pages.map(([r,icon,title])=>`<a href="#${r}" class="${r===current?'active':''}" ${r===current?'aria-current="page"':''}><span class="nav-icon">${icon}</span>${title}</a>`).join('');
  $('#connection').textContent=online?(S.config.paused?'실제 연결 · 일시정지':'실제 연결 · 실행 중'):'연습 모드';$('#connection').className='pill'+(online&&S.config.paused?' warn':'');
  $('#activeAccount').innerHTML=accountOptions(activeAccount()?.id);$('#connect').textContent=online?'연결 관리':'서버 연결';
  const app=$('#app');app.innerHTML=(!online?'<div class="notice">지금은 연습 모드예요. 계정에 툿을 보내지 않으며, 연습 데이터는 이 브라우저에만 저장돼요.</div>':'');
  ({home:homePage,bots:botsPage,story:storyPage,runners:runnersPage,calendar:calendarPage,accounts:accountsPage,settings:settingsPage}[current]||homePage)(app);
}
function homePage(app){
  const today=koreaDay(Date.now()),events=S.config.events.filter(e=>koreaDay(e.at)===today).sort((a,b)=>new Date(a.at)-new Date(b.at));
  const used=Number(S.runtime['used:'+today]||0),enabled=S.config.rules.filter(r=>r.enabled).length;
  app.insertAdjacentHTML('beforeend',heading('YOUR COMMUNITY, IN MOTION','오늘의 운영','이야기를 시작하기 전에, 오늘의 흐름을 살펴봐요.',`<button id="toggleRun" class="${S.config.paused?'green':'primary'}">${S.config.paused?'전체 실행':'전체 일시정지'}</button>`)+`
  <section class="hero"><div><div class="eyebrow">${esc(today.replaceAll('-','.'))} · COMMUNITY JOURNAL</div><h2>오늘도, 우리의 이야기가 이어져요.</h2><p>${events.length?`오늘은 ${events.length}개의 일정이 기다리고 있어요.`:'아직 빈 하루예요. 새로운 일정을 채워볼까요?'}<br>${online?'실행 상태를 확인하고, 준비가 끝나면 봇을 켜 주세요.':'봇을 조립하고 연습한 뒤 실제 운영실에 연결할 수 있어요.'}</p><div class="actions" style="margin-top:20px"><a href="#bots"><button class="primary small">자동봇 만들기 ↗</button></a><a href="#calendar"><button class="small">캘린더 보기</button></a></div></div><div class="hero-stamp"><small>OUR STORY</small><strong>${String(S.participants.length).padStart(2,'0')}</strong><small>${online?'RUNNERS':'PRACTICE'}</small></div></section>
  <div class="stats-grid"><div class="stat-card"><small>반응 설정이 켜진 규칙</small><span class="number">${enabled}<small>/ ${S.config.rules.length}개</small></span></div><div class="stat-card"><small>오늘 처리한 명령</small><span class="number">${used}<small>/ ${S.config.dailyCap}</small></span></div><div class="stat-card"><small>기다리는 출력</small><span class="number">${S.outbox.filter(o=>o.state==='pending').length}<small>개</small></span></div></div>
  <div class="grid"><section class="card"><div class="card-head"><h2>오늘의 타임라인</h2><span class="tag">KST</span></div>${timeline(events)}</section><section class="card"><div class="card-head"><h2>최근 기록</h2><a class="text-link" href="#runners">기록부 ↗</a></div>${S.audit.length?S.audit.slice(0,5).map(a=>`<div class="audit-line">${esc(S.participants.find(p=>p.id===a.actor_id)?.name||'러너')} · ${esc(a.message)}<small>${dateTime(a.created)} · ${esc(a.source)}</small></div>`).join(''):empty('능력치와 물건이 바뀌면 여기에 기록돼요.')}</section></div>
  <p class="inline-help" style="margin-top:17px">마지막 자동 확인: ${S.runtime.lastTick?dateTime(S.runtime.lastTick):'아직 없음'} · 무료 구성은 분 단위로 확인하며, 몰릴 때 답글이 늦어질 수 있어요.</p>`);
  action('#toggleRun',async()=>{if(!online){toast('실제 봇 실행은 서버 연결 후 사용할 수 있어요. 연습창에서 먼저 시험해 주세요.');return;}S.config.paused=!S.config.paused;try{await saveConfig();render();}catch(e){S.config.paused=!S.config.paused;throw e;}});
}
const blockNames={reply:'대사 출력',random:'후보 중 랜덤 선택',roll:'주사위 굴리기',calculate:'계산 결과 저장',stat:'능력치 더하기·빼기',item:'물건 지급·사용',guard:'조건이 맞을 때 계속',status:'현재 능력치 출력',inventory:'현재 가방 출력',history:'최근 기록 출력'};
function blockFields(b){
  const label=(text,html)=>`<label>${text}${html}</label>`;
  const input=(field,value,type='text',extra='')=>`<input data-field="${field}" type="${type}" value="${esc(value)}" ${extra}>`;
  if(b.type==='reply'||b.type==='random')return label(b.type==='random'?'후보를 한 줄에 하나씩 · 확률 가중치 예: 30 | 단서 발견':'문장 · {닉네임}, {결과}, {체력}을 사용할 수 있어요.',`<textarea data-field="text">${esc(b.text||'')}</textarea>`);
  if(b.type==='roll')return `<div class="form-grid">${label('주사위 개수',input('count',b.count,'number','min="1" max="20"'))}${label('주사위 면수',input('sides',b.sides,'number','min="2" max="1000"'))}</div>`;
  if(b.type==='calculate')return `<div class="form-grid">${label('결과를 저장할 능력치',input('key',b.key))}${label('계산식 · 예: {체력} + 5',input('expression',b.expression))}</div>`;
  if(b.type==='stat'||b.type==='item')return `<div class="form-grid">${label(b.type==='stat'?'능력치 이름':'물건 이름',input('key',b.key))}${label('변경량 · 사용하거나 줄일 때 음수',input('amount',b.amount,'number'))}</div>`;
  if(b.type==='guard')return `<div class="form-grid">${label('확인할 대상',`<select data-field="target"><option value="stat" ${b.target==='stat'?'selected':''}>능력치</option><option value="item" ${b.target==='item'?'selected':''}>물건 수량</option><option value="result" ${b.target==='result'?'selected':''}>직전 주사위·계산 결과</option></select>`)}${label('항목 이름',input('key',b.key))}${label('비교',`<select data-field="op">${['>=','<=','==','>','<'].map(op=>`<option ${b.op===op?'selected':''} value="${esc(op)}">${esc(op)} ${({'>=':'이상','<=':'이하','==':'같음','>':'초과','<':'미만'})[op]}</option>`).join('')}</select>`)}${label('기준 숫자',input('amount',b.amount,'number'))}<label class="span2">조건에 맞지 않을 때 답글<textarea data-field="text">${esc(b.text||'조건이 맞지 않아요.')}</textarea></label></div><div class="inline-help">조건에 맞지 않으면 앞 블록의 변경도 취소하고 이 규칙을 끝내요. 조건 블록은 앞쪽에 두면 이해하기 쉬워요.</div>`;
  return '<p class="inline-help">이 러너의 기록을 읽어서 답글로 출력해요.</p>';
}
function collectDraft(){
  const form=$('#botEditor');if(!form||!draft)return;
  for(const el of $$('[data-rule]',form)){const k=el.dataset.rule;draft[k]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}
  for(const block of $$('.block',form)){const b=draft.blocks[Number(block.dataset.index)];for(const el of $$('[data-field]',block))b[el.dataset.field]=el.type==='number'?Number(el.value):el.value;}
}
function newRuleModal(){
  modal(`<h2>어떤 봇부터 만들까요?</h2><p>기본 블록을 가져온 뒤 문장과 숫자를 바꿀 수 있어요.</p><div class="stack">${[['check','내 상태·가방 확인'],['dice','주사위 봇'],['search','확률로 단서를 얻는 조사봇'],['item','물건 사용과 체력 회복'],['history','최근 획득·변경 기록']].map(([kind,title])=>`<button data-template="${kind}">${title} ↗</button>`).join('')}</div>`);
  action('[data-template]',(_e,b)=>{const r=example(b.dataset.template,activeAccount()?.id||'');S.config.rules.push(r);selected=r.id;draft=structuredClone(r);simulation=null;dirty=true;close();render();});
}
function botsPage(app){
  if(!selected&&S.config.rules.length)selected=S.config.rules[0].id;
  const current=S.config.rules.find(r=>r.id===selected);if(current&&(!draft||draft.id!==selected))draft=structuredClone(current);
  app.insertAdjacentHTML('beforeend',heading('BUILD WITHOUT CODE','자동봇 제작소','언제 반응할지 정하고, 아래로 블록을 이어 붙여요.',`<button id="newRule" class="primary">+ 새 자동봇</button>`)+`
  <div class="bot-layout"><aside class="bot-list">${S.config.rules.map(r=>`<button class="bot-choice ${r.id===selected?'selected':''}" data-pick="${esc(r.id)}"><span class="tag">${r.enabled?'켜짐':'꺼짐'}</span> ${esc(r.name)}<small>${esc(r.keyword)}</small></button>`).join('')}</aside><section class="card">${draft?`
  <div id="botEditor"><div class="card-head"><h2>블록 편집</h2><label class="checkline"><input data-rule="enabled" type="checkbox" ${draft.enabled?'checked':''}> 이 규칙 켜기</label></div>
  <div class="form-grid"><label>규칙 이름<input data-rule="name" value="${esc(draft.name)}" maxlength="80"></label><label>발신 계정<select data-rule="accountId">${accountOptions(draft.accountId)}</select></label><label>반응할 키워드<input data-rule="keyword" value="${esc(draft.keyword)}" maxlength="100"></label><label>인식 방식<select data-rule="match"><option value="contains" ${draft.match==='contains'?'selected':''}>문장에 포함되면</option><option value="exact" ${draft.match==='exact'?'selected':''}>명령 전체가 같으면</option></select></label><label>러너 1명당 하루 횟수 · 0은 무제한<input data-rule="dailyLimit" type="number" min="0" max="1000" value="${draft.dailyLimit}"></label><label>재사용 대기시간 · 초<input data-rule="cooldown" type="number" min="0" max="86400" value="${draft.cooldown}"></label></div>
  <p class="inline-help">등록한 러너가 발신 계정에 보낸 새 멘션에만 반응해요. 하루는 한국 시간 자정에 바뀌어요.</p>
  <div style="margin-top:22px">${draft.blocks.map((b,i)=>`<section class="block" data-kind="${b.type}" data-index="${i}"><div class="block-head"><span class="tag">${String(i+1).padStart(2,'0')}</span>${blockNames[b.type]}<div class="actions"><button data-move="-1" data-index="${i}" aria-label="위로 이동">↑</button><button data-move="1" data-index="${i}" aria-label="아래로 이동">↓</button><button data-remove="${i}" aria-label="블록 삭제">×</button></div></div>${blockFields(b)}</section>`).join('')}</div>
  <button id="addBlock" class="add-block">+ 다음 블록 추가</button><div class="editor-foot"><button id="saveRule" class="primary">규칙 저장</button><button id="copyRule">복제</button><button id="deleteRule" class="danger">삭제</button><span class="counter">${draft.blocks.length} / 30 블록</span></div></div>
  <section class="practice"><div class="card-head"><h2>작은 연습창</h2><button id="resetPractice" class="small">기록 초기화</button></div><p class="inline-help">실제로 게시하지 않아요. 선택한 규칙 하나의 키워드와 블록을 시험하며, 횟수·대기시간 제한은 적용하지 않아요.</p><div class="row" style="margin-top:12px"><input id="practiceText" aria-label="연습 명령" value="${esc(draft.keyword)}"><button id="practiceRun" class="green">보내기</button></div><div id="practiceResult"></div></section>`:empty('새 자동봇을 만들어 첫 블록을 추가해 주세요.')}</section></div>`);
  action('#newRule',newRuleModal);
  action('[data-pick]',(_e,b)=>{if(dirty&&draft&&!confirm('현재 규칙의 저장하지 않은 편집을 버릴까요?'))return;selected=b.dataset.pick;draft=null;simulation=null;dirty=false;render();});
  for(const el of $$('[data-rule], [data-field]'))el.addEventListener('input',()=>{dirty=true;collectDraft();});
  action('[data-move]',(_e,b)=>{collectDraft();const i=Number(b.dataset.index),j=i+Number(b.dataset.move);if(j<0||j>=draft.blocks.length)return;[draft.blocks[i],draft.blocks[j]]=[draft.blocks[j],draft.blocks[i]];dirty=true;render();});
  action('[data-remove]',(_e,b)=>{collectDraft();draft.blocks.splice(Number(b.dataset.remove),1);dirty=true;render();});
  action('#addBlock',()=>{collectDraft();modal(`<h2>다음에 무엇을 할까요?</h2><p>선택하면 맨 아래에 블록이 붙어요.</p><div class="stack">${Object.entries(blockNames).map(([type,name])=>`<button data-block="${type}">${name}</button>`).join('')}</div>`);action('[data-block]',(_e,b)=>{if(draft.blocks.length>=30)throw Error('블록은 최대 30개예요.');draft.blocks.push({type:b.dataset.block,key:'체력',amount:1,text:'{닉네임}, 반가워요.',count:1,sides:100,target:'stat',op:'>=',expression:'{체력} + 5'});dirty=true;close();render();});});
  action('#saveRule',async()=>{collectDraft();validateRule(draft);const i=S.config.rules.findIndex(r=>r.id===draft.id);S.config.rules[i]=structuredClone(draft);await saveConfig();render();});
  action('#copyRule',async()=>{collectDraft();const r={...structuredClone(draft),id:uid(),name:draft.name+' 복사',enabled:false};S.config.rules.push(r);selected=r.id;draft=r;dirty=true;render();});
  action('#deleteRule',async()=>{S.config.rules=S.config.rules.filter(r=>r.id!==selected);await saveConfig();draft=null;selected='';render();});
  action('#practiceRun',()=>{collectDraft();validateRule(draft);const text=$('#practiceText').value;const target=$('#practiceResult');if(!matches(draft,text)){target.innerHTML='<div class="chat"><div class="bubble">키워드가 맞지 않아 반응하지 않아요.</div></div>';return;}simulation??=structuredClone(S.participants[0]||{name:'연습 러너',stats:S.config.fields,inventory:{}});const result=execute(draft,simulation);simulation={...simulation,stats:result.stats,inventory:result.inventory};target.innerHTML=`<div class="chat"><div class="bubble me">${esc(text)}</div>${result.replies.map(r=>`<div class="bubble">${esc(r)}</div>`).join('')}${!result.replies.length?'<div class="bubble">출력 블록이 없어요. 기록 변경만 처리했어요.</div>':''}<small>${esc(result.changes.join(' / ')||'기록 변경 없음')}</small></div>`;});
  action('#resetPractice',()=>{simulation=null;$('#practiceResult').innerHTML='';toast('연습 기록을 초기화했어요.');});
}
function sceneCollect(){
  if($('#storyTitle'))story.title=$('#storyTitle').value;
  if($('#storyStart'))story.start=new Date($('#storyStart').value);
  for(const scene of $$('[data-scene]')){const s=story.scenes[Number(scene.dataset.scene)];for(const el of $$('[data-scene-field]',scene))s[el.dataset.sceneField]=el.type==='number'?Number(el.value):el.value;}
}
function storyPage(app){
  const groups=[...new Set(S.outbox.filter(o=>o.group_id).map(o=>o.group_id))];
  app.insertAdjacentHTML('beforeend',heading('LET THE SCENE UNFOLD','스토리 진행실','계정과 대본을 정하고, 차례대로 이야기를 내보내요.',`<button id="addScene" class="primary">+ 장면 추가</button>`)+`
  <div class="notice">이 버전은 약 1분 단위로 예약을 확인해요. 초 단위 정시 출력은 보장하지 않으며, 앞 장면 전송에 문제가 생기면 뒤 장면도 기다려요. 전체 일시정지 중에는 출력되지 않아요.</div>
  <div class="grid"><section><div class="card" style="margin-bottom:18px"><div class="form-grid"><label>대본 이름<input id="storyTitle" value="${esc(story.title)}"></label><label>시작 시각 · 현재 기기 시간<input id="storyStart" type="datetime-local" value="${inputDate(story.start)}"></label></div></div>
  <div id="scenes">${story.scenes.length?story.scenes.map((s,i)=>`<div class="scene" data-scene="${i}"><span class="scene-number">${i+1}</span><div class="card"><div class="form-grid"><label>발신 계정<select data-scene-field="accountId">${accountOptions(s.accountId)}</select></label><label>${i?'앞 장면과의 간격 · 초':'첫 장면은 시작 시각에 출력'}<input data-scene-field="delay" type="number" value="${s.delay}" min="${i?60:0}" step="60" ${i?'':'disabled'}></label><label class="span2">대본<textarea data-scene-field="text" placeholder="이 장면에 출력할 내용을 적어 주세요.">${esc(s.text)}</textarea></label><label>공개 범위<select data-scene-field="visibility">${[['unlisted','미등재'],['public','공개'],['private','팔로워 전용']].map(([v,t])=>`<option value="${v}" ${s.visibility===v?'selected':''}>${t}</option>`).join('')}</select></label><div class="actions"><button data-scene-up="${i}" class="small">↑</button><button data-scene-delete="${i}" class="small danger">삭제</button></div></div></div></div>`).join(''):empty('장면을 추가해서 대본을 작성해 주세요.')}</div>
  <div class="actions"><button id="storyPreview">전체 미리보기</button><button id="storySchedule" class="green">이 대본 예약 등록</button><button id="storyDownload" class="small">대본 파일 저장</button></div></section>
  <section class="card"><div class="card-head"><h2>예약된 이야기</h2><button id="reloadStory" class="small">새로고침</button></div>${groups.length?groups.map(g=>{const rows=S.outbox.filter(o=>o.group_id===g);return `<div class="card" style="padding:15px;margin-bottom:12px"><strong>${esc(rows[0].title.replace(/ \d+장$/,''))}</strong><div class="story-status">${rows.filter(o=>o.state==='sent').length}개 전송 · ${rows.filter(o=>o.state==='pending').length}개 대기 · ${rows.filter(o=>o.state==='held').length}개 정지</div><div class="actions" style="margin-top:10px"><button data-group="${g}" data-control="pause" class="small">일시정지</button><button data-group="${g}" data-control="resume" class="small">재개</button><button data-group="${g}" data-control="cancel" class="small danger">남은 장면 취소</button></div></div>`;}).join(''):empty('아직 예약된 대본이 없어요.')}<details><summary>최근 출력 대기열과 오류</summary><div class="outbox-list">${S.outbox.map(o=>`<div class="audit-line">${esc(o.title)} · ${esc(({pending:'대기',held:'정지',sent:'전송 완료',review:'확인 필요',cancelled:'취소'})[o.state]||o.state)}<small>${dateTime(o.due)}</small>${o.last_error?`<div class="status-error">${esc(o.last_error)}</div>`:''}</div>`).join('')}</div></details></section></div>`);
  for(const el of $$('[data-scene-field],#storyTitle,#storyStart'))el.addEventListener('change',sceneCollect);
  action('#addScene',()=>{sceneCollect();if(story.scenes.length>=30)throw Error('한 대본은 최대 30장면이에요.');story.scenes.push({accountId:activeAccount()?.id||'',delay:story.scenes.length?60:0,text:'',visibility:'unlisted'});render();});
  action('[data-scene-up]',(_e,b)=>{sceneCollect();const i=Number(b.dataset.sceneUp);if(i)[story.scenes[i],story.scenes[i-1]]=[story.scenes[i-1],story.scenes[i]];render();});
  action('[data-scene-delete]',(_e,b)=>{sceneCollect();story.scenes.splice(Number(b.dataset.sceneDelete),1);render();});
  action('#storyPreview',()=>{sceneCollect();let t=new Date(story.start).getTime();modal(`<h2>${esc(story.title)}</h2><p>한국 시간 기준 예상 시각이에요. 실제 전송은 늦어질 수 있어요.</p>${story.scenes.map((s,i)=>{if(i)t+=s.delay*1000;return `<div class="chat"><small>${dateTime(t)} · ${esc(S.accounts.find(a=>a.id===s.accountId)?.label||'계정 미지정')}</small><div class="bubble">${esc(s.text)}</div></div>`;}).join('')||empty('장면이 없어요.')}`);});
  action('#storySchedule',async()=>{sceneCollect();if(!online)throw Error('실제 대본 예약은 서버 연결 후 사용할 수 있어요. 미리보기로 먼저 확인해 주세요.');const result=await api('/api/story','POST',{...story,start:new Date(story.start).toISOString()});await reload();toast('대본을 예약했어요. 전체 실행 상태도 확인해 주세요.');});
  action('#storyDownload',()=>{sceneCollect();download('curtain-call-story.json',story);});
  action('#reloadStory',async()=>{if(online)await reload();});
  action('[data-control]',async(_e,b)=>{if(!online)return;await api('/api/story/control','POST',{group:b.dataset.group,action:b.dataset.control});await reload();});
}
function kvEditor(map,kind){return `<div data-kv="${kind}">${Object.entries(map).map(([key,value])=>`<div class="kv-row"><input data-key value="${esc(key)}" aria-label="항목 이름"><input data-value type="number" value="${value}" aria-label="수치"><button data-delete-row aria-label="항목 삭제">×</button></div>`).join('')}</div><button data-add-row="${kind}" class="small">+ 항목 추가</button>`;}
function kvBindings(){
  action('[data-delete-row]',(_e,b)=>b.parentElement.remove());
  action('[data-add-row]',(_e,b)=>{const root=$(`[data-kv="${b.dataset.addRow}"]`);const row=document.createElement('div');row.className='kv-row';row.innerHTML='<input data-key aria-label="항목 이름" placeholder="항목 이름"><input data-value type="number" value="0" aria-label="수치"><button data-delete-row aria-label="항목 삭제">×</button>';root.append(row);action('[data-delete-row]',(_e,b)=>b.parentElement.remove(),row);});
}
function kvRead(kind){
  const result=Object.create(null);for(const row of $$(`[data-kv="${kind}"] .kv-row`)){const key=$('[data-key]',row).value.trim(),value=Number($('[data-value]',row).value);if(!cleanKey(key)||Object.hasOwn(result,key))throw Error('항목 이름이 비었거나 중복됐어요.');result[key]=value;}return numericMap(result);
}
function runnerModal(p){
  modal(`<h2>${esc(p.name)}의 기록</h2><p>@${esc(p.acct)} · 운영자가 직접 수정할 수 있어요.</p><div class="stack"><section><h3>능력치</h3>${kvEditor(p.stats,'stats')}</section><section><h3>현재 소지품</h3>${kvEditor(p.inventory,'inventory')}</section><button id="saveRunner" class="primary">변경 기록 남기고 저장</button><details><summary>최근 획득·변경 이력</summary>${S.audit.filter(a=>a.actor_id===p.id).map(a=>`<div class="audit-line">${esc(a.message)}<small>${dateTime(a.created)} · ${esc(a.source)}</small></div>`).join('')||empty('아직 기록이 없어요.')}</details></div>`);
  kvBindings();action('#saveRunner',async()=>{
    const next={...p,stats:kvRead('stats'),inventory:kvRead('inventory')};if(Object.values(next.inventory).some(v=>v<0||!Number.isInteger(v)))throw Error('물건 수량은 0 이상의 정수여야 해요.');
    if(online){await api('/api/participant','PUT',next);await reload();}else{S.participants[S.participants.findIndex(r=>r.id===p.id)]=next;S.audit.unshift({actor_id:p.id,message:'운영자가 연습 기록을 수정했어요.',created:Date.now(),source:'연습 수정'});persist();render();}close();toast('변경 내용을 저장했어요.');
  });
}
function runnersPage(app){
  app.insertAdjacentHTML('beforeend',heading('EVERY CHARACTER HAS A RECORD','러너 기록부','능력치와 가방, 이야기를 거쳐 온 흔적을 함께 보관해요.',`<button id="addRunners" class="primary">+ 러너 등록</button>`)+`
  <div class="row" style="margin-bottom:20px"><input id="runnerSearch" placeholder="닉네임 또는 아이디로 찾기" aria-label="러너 검색"></div><div class="runner-grid" id="runnerCards">${S.participants.map(p=>`<button class="card runner-card" data-runner="${esc(p.id)}" data-search="${esc((p.name+' '+p.acct).toLowerCase())}"><div class="row"><span class="avatar-letter">${esc(Array.from(p.name)[0])}</span><div><strong>${esc(p.name)}</strong><small style="display:block">@${esc(p.acct)}</small></div></div><div class="runner-stats">${Object.entries(p.stats).slice(0,3).map(([k,v])=>`<span>${esc(k)} ${v}</span>`).join('')}<span>물건 ${Object.values(p.inventory).reduce((a,b)=>a+b,0)}개</span></div></button>`).join('')}</div>${S.participants.length?'':empty('운영 계정을 연결한 뒤 러너 아이디를 등록해 주세요.')}`);
  $('#runnerSearch').oninput=e=>{for(const card of $$('[data-runner]'))card.hidden=!card.dataset.search.includes(e.target.value.toLowerCase());};
  action('[data-runner]',(_e,b)=>runnerModal(S.participants.find(p=>p.id===b.dataset.runner)));
  action('#addRunners',()=>{
    modal(`<h2>러너 등록</h2><p>26명 아이디를 한 줄에 하나씩 붙여 넣어도 돼요. 등록한 계정의 멘션만 봇이 처리해요.</p><div class="stack"><label>조회에 사용할 운영 계정<select id="lookupAccount">${accountOptions(activeAccount()?.id)}</select></label><label>아이디 목록<textarea id="runnerNames" placeholder="runner1@planet.moe\nrunner2@planet.moe" rows="7"></textarea></label><button id="importRunners" class="primary">등록하기</button><div id="importResult" class="inline-help"></div></div>`);
    action('#importRunners',async()=>{
      const names=$('#runnerNames').value;if(!online){const lines=names.split('\n').map(s=>s.trim()).filter(Boolean);for(const name of lines)S.participants.push({id:uid(),name:name.replace(/^@/,'').split('@')[0],acct:name.replace(/^@/,''),stats:structuredClone(S.config.fields),inventory:{},revision:0});persist();close();render();toast('연습 러너를 추가했어요. 실제 계정 조회는 하지 않았어요.');return;}
      const result=await api('/api/participants/import','POST',{accountId:$('#lookupAccount').value,names});await reload();$('#importResult').textContent=`${result.added.length}명 등록 · ${result.failed.length}명 실패${result.failed.length?' ('+result.failed.join(', ')+')':''}`;toast('러너 등록 결과를 확인해 주세요.');
    });
  });
}
function eventModal(date){
  const d=date?new Date(date+'T21:00'):new Date();
  modal(`<h2>운영 일정 등록</h2><p>오늘의 운영 화면과 캘린더에 표시해요. 이 버전의 일정 알림은 앱을 열었을 때 표시되며, 푸시 알림은 아직 제공하지 않아요.</p><div class="stack"><label>일정 이름<input id="eventTitle" placeholder="예: 도서관 조사 개방" maxlength="120"></label><label>시작 시각 · 현재 기기 시간<input id="eventAt" type="datetime-local" value="${inputDate(d)}"></label><label>운영 메모<textarea id="eventNote" placeholder="준비물, 진행 담당, 대본 이름 등을 적어 주세요."></textarea></label><button id="saveEvent" class="primary">일정 저장</button></div>`);
  action('#saveEvent',async()=>{const title=$('#eventTitle').value.trim();if(!title)throw Error('일정 이름을 적어 주세요.');const at=new Date($('#eventAt').value).toISOString();S.config.events.push({id:uid(),title,at,note:$('#eventNote').value});await saveConfig();close();render();});
}
function calendarPage(app){
  const year=month.getFullYear(),m=month.getMonth(),first=new Date(year,m,1).getDay(),last=new Date(year,m+1,0).getDate(),cells=[];
  for(let i=0;i<first;i++)cells.push('<td class="blank"></td>');
  for(let d=1;d<=last;d++){const date=`${year}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,events=S.config.events.filter(e=>koreaDay(e.at)===date);cells.push(`<td class="${date===koreaDay(Date.now())?'today':''}" data-date="${date}" tabindex="0" role="button" aria-label="${date} 일정 등록"><span>${d}</span>${events.slice(0,3).map(e=>`<span class="event-dot">${esc(e.title)}</span>`).join('')}${events.length>3?`<small>+${events.length-3}</small>`:''}</td>`);}
  while(cells.length%7)cells.push('<td class="blank"></td>');
  const upcoming=S.config.events.filter(e=>new Date(e.at).getFullYear()===year&&new Date(e.at).getMonth()===m).sort((a,b)=>new Date(a.at)-new Date(b.at));
  app.insertAdjacentHTML('beforeend',heading('A PLACE FOR EVERY DAY','운영 캘린더','개장부터 엔딩까지, 놓치지 않도록 기록해 둬요.',`<button id="newEvent" class="primary">+ 일정 등록</button>`)+`
  <div class="card calendar-wrap"><div class="card-head"><span class="month-title">${year}. ${String(m+1).padStart(2,'0')}</span><div class="actions"><button id="prevMonth" class="small" aria-label="이전 달">←</button><button id="thisMonth" class="small">이번 달</button><button id="nextMonth" class="small" aria-label="다음 달">→</button></div></div><table class="calendar"><thead><tr>${['일','월','화','수','목','금','토'].map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>${Array.from({length:cells.length/7},(_,i)=>'<tr>'+cells.slice(i*7,i*7+7).join('')+'</tr>').join('')}</tbody></table></div>
  <section class="card" style="margin-top:20px"><div class="card-head"><h2>이번 달 일정</h2><small>표시는 한국 시간 기준</small></div>${upcoming.map(e=>`<div class="timeline-item"><span class="time-label">${new Date(e.at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'})}</span><div style="flex:1"><div class="event-name">${esc(e.title)}</div><div class="event-desc">${dateTime(e.at)} · ${esc(e.note||'')}</div></div><button data-delete-event="${esc(e.id)}" class="small danger">삭제</button></div>`).join('')||empty('이번 달에 등록한 일정이 없어요.')}</section>`);
  action('#newEvent',()=>eventModal());action('[data-date]',(_e,b)=>eventModal(b.dataset.date));
  for(const td of $$('[data-date]'))td.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();eventModal(td.dataset.date);}};
  action('#prevMonth',()=>{month=new Date(year,m-1,1);render();});action('#nextMonth',()=>{month=new Date(year,m+1,1);render();});action('#thisMonth',()=>{month=new Date(new Date().getFullYear(),new Date().getMonth(),1);render();});
  action('[data-delete-event]',async(_e,b)=>{S.config.events=S.config.events.filter(e=>e.id!==b.dataset.deleteEvent);await saveConfig();render();});
}
function accountsPage(app){
  app.insertAdjacentHTML('beforeend',heading('ONE ROOM, MANY VOICES','운영 계정','총괄·공지·NPC 계정을 연결하고 편하게 바꿔요.',`<button id="loginMastodon" class="primary">+ planet.moe 계정 연결</button>`)+`
  <div class="notice">초대 링크는 planet.moe의 사람 초대 화면에서 만든 뒤 한 번 등록해 주세요. 이후에는 복사 버튼 한 번으로 나눠줄 수 있어요.</div>
  <div class="grid">${S.accounts.map(a=>`<section class="card account-card" data-account-card="${esc(a.id)}"><div class="row"><span class="avatar-letter">${esc(Array.from(a.label)[0])}</span><div style="flex:1"><label>운영실에서 부를 별명<input data-account-label value="${esc(a.label)}" maxlength="80"></label><small>@${esc(a.acct)}</small></div><span class="tag">${a.active?'자동 확인 켜짐':'자동 확인 꺼짐'}</span></div><div class="actions"><button data-select-account="${esc(a.id)}" class="small">이 계정으로 전환</button><button data-save-account="${esc(a.id)}" class="small">별명 저장</button><button data-toggle-account="${esc(a.id)}" class="small">자동 확인 ${a.active?'끄기':'켜기'}</button></div>${a.error?`<p class="status-error">${esc(a.error)}</p>`:''}<label style="margin-top:18px">나눠줄 초대 링크<input type="url" data-invite value="${esc(S.config.invites[a.id]||'')}" placeholder="https://planet.moe/invite/..."></label><div class="actions"><button data-save-invite="${esc(a.id)}" class="small">링크 저장</button><button data-copy-invite="${esc(a.id)}" class="small green">초대 링크 복사</button><a class="text-link" href="https://planet.moe/invites" target="_blank" rel="noopener noreferrer">초대 관리 ↗</a></div></section>`).join('')}</div>${S.accounts.length?'':empty('계정 연결 버튼으로 로그인해 주세요. 비밀번호는 planet.moe 화면에서만 입력해요.')}
  <section class="card" style="margin-top:20px"><h2>이 계정으로 공지 작성</h2><p class="inline-help">상단에서 고른 계정으로 전송해요. 본문과 발신 계정을 확인하고 예약 버튼을 눌러 주세요.</p><textarea id="quickPost" style="margin-top:13px" placeholder="공지 내용을 입력해 주세요."></textarea><div class="actions" style="margin-top:12px"><select id="quickVisibility" style="width:auto"><option value="unlisted">미등재</option><option value="public">공개</option><option value="private">팔로워 전용</option></select><button id="quickSchedule" class="primary">약 1분 뒤 공지 예약</button></div></section>`);
  action('#loginMastodon',async()=>{if(!online)throw Error('먼저 Cloudflare 서버에 연결해 주세요.');const {url}=await api('/api/oauth/start','POST');location.assign(url);});
  action('[data-select-account]',(_e,b)=>{active=b.dataset.selectAccount;localStorage.setItem('cc.account',active);render();toast('기본 발신 계정을 바꿨어요.');});
  async function updateAccount(a){if(online)await api('/api/account','PUT',a);else persist();}
  action('[data-save-account]',async(_e,b)=>{const a=S.accounts.find(a=>a.id===b.dataset.saveAccount);a.label=$('[data-account-label]',b.closest('[data-account-card]')).value;await updateAccount(a);render();toast('계정 별명을 저장했어요.');});
  action('[data-toggle-account]',async(_e,b)=>{const a=S.accounts.find(a=>a.id===b.dataset.toggleAccount);a.active=a.active?0:1;await updateAccount(a);render();});
  action('[data-save-invite]',async(_e,b)=>{const url=$('[data-invite]',b.closest('[data-account-card]')).value.trim();if(url){const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('https 초대 주소를 입력해 주세요.');}if(url)S.config.invites[b.dataset.saveInvite]=url;else delete S.config.invites[b.dataset.saveInvite];await saveConfig();});
  action('[data-copy-invite]',async(_e,b)=>{const url=S.config.invites[b.dataset.copyInvite];if(!url)throw Error('초대 링크를 먼저 저장해 주세요.');await navigator.clipboard.writeText(url);toast('초대 링크를 복사했어요.');});
  action('#quickSchedule',async()=>{if(!online)throw Error('실제 공지 전송은 서버 연결 후 사용할 수 있어요.');const account=activeAccount();if(!account)throw Error('발신 계정을 선택해 주세요.');const text=$('#quickPost').value;if(!text.trim())throw Error('공지 내용을 입력해 주세요.');if(!confirm(`${account.label} 계정으로 이 공지를 예약할까요?\n\n${text}`))return;await api('/api/story','POST',{title:'운영 공지',start:new Date(Date.now()+60000).toISOString(),scenes:[{accountId:account.id,delay:0,text,visibility:$('#quickVisibility').value}]});await reload();toast('공지를 예약했어요. 전체 실행 상태를 확인해 주세요.');});
}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function settingsPage(app){
  app.insertAdjacentHTML('beforeend',heading('A LITTLE PREPARATION','연결·설정','무료 실행 환경을 연결하고, 커뮤에 맞는 기본값을 정해요.')+`
  <div class="grid"><section class="card"><div class="card-head"><h2>운영실 연결</h2><span class="tag">${online?'연결됨':'연습 중'}</span></div><p>Cloudflare Workers + D1 무료 요금제를 사용하는 구성입니다. 브라우저를 닫아도 Cloudflare가 새 멘션을 확인해요.</p><div class="actions" style="margin-top:17px"><button id="settingsConnect" class="primary">운영 암호로 연결</button><button id="logoutServer">이 기기 연결 해제</button><a class="text-link" href="https://dash.cloudflare.com/" target="_blank" rel="noopener">Cloudflare 열기 ↗</a></div><p class="inline-help">운영 암호를 바꾸면 저장된 계정 토큰을 읽을 수 없게 되어 계정을 다시 연결해야 해요.</p></section>
  <section class="card"><div class="card-head"><h2>하루 처리 상한</h2><span class="tag">무료 사용량 관리</span></div><label>전체 러너의 명령 합계 · 한국 시간 기준<input id="dailyCap" type="number" min="1" max="5000" value="${S.config.dailyCap}"></label><p class="inline-help">상한에 도달하면 새 명령은 대기해요. 재사용 대기 중인 명령은 합계에서 제외돼요. 이 숫자는 Cloudflare의 실제 사용량과 같지 않아요.</p><button id="saveCap" class="small" style="margin-top:13px">상한 저장</button></section>
  <section class="card"><div class="card-head"><h2>새 러너의 기본 능력치</h2></div>${kvEditor(S.config.fields,'defaults')}<div class="actions" style="margin-top:15px"><button id="saveFields" class="primary small">기본값 저장</button></div><p class="inline-help">새로 등록하는 러너에게 적용해요. 이미 등록한 러너는 기록부에서 수정해 주세요.</p></section>
  <section class="card"><div class="card-head"><h2>기록 파일과 확인</h2></div><p>능력치·소지품·설정과 최근 기록을 JSON으로 내려받아요. 계정 토큰과 운영 암호는 포함하지 않아요.</p><div class="actions" style="margin-top:17px"><button id="exportRecords" class="primary small">기록 파일 내려받기</button><button id="manualTick" class="small">새 멘션 확인 요청</button></div><p class="inline-help">이 파일은 최근 기록 중심의 보조 내보내기예요. 전체 복구용 백업은 Cloudflare D1의 Export 기능을 사용해 주세요.</p><details style="margin-top:17px"><summary>현재 버전에서 알아둘 점</summary><ul><li>일정은 앱을 열면 표시해요. 브라우저 푸시는 아직 지원하지 않아요.</li><li>스토리는 분 단위 예약이며, 30초 간격 진행을 보장하지 않아요.</li><li>‘확인 필요’ 출력은 중복 방지를 위해 자동으로 다시 보내지 않아요. 계정에서 실제 게시 여부를 확인해 주세요.</li><li>첫 연결 이전의 멘션은 처리하지 않아요. 등록한 러너의 새 멘션부터 처리해요.</li><li>서버 전체를 운영하는 관리 기능이나 초대 링크 자동 생성은 포함하지 않아요.</li></ul></details></section></div>`);
  action('#settingsConnect',connect);kvBindings();
  action('#logoutServer',()=>{sessionStorage.removeItem('cc.admin');secret='';online=false;S=read('cc.practice.v1',null)||initial();draft=null;selected='';render();toast('이 기기의 연결을 해제했어요. 서버의 봇 실행은 계속될 수 있어요.');});
  action('#saveCap',async()=>{S.config.dailyCap=Number($('#dailyCap').value);await saveConfig();});
  action('#saveFields',async()=>{S.config.fields=kvRead('defaults');await saveConfig();});
  action('#exportRecords',async()=>download('curtain-call-records-'+koreaDay(Date.now())+'.json',online?await api('/api/export'):S));
  action('#manualTick',async()=>{if(!online)throw Error('실제 서버 연결 후 사용할 수 있어요.');await api('/api/tick','POST');await reload();toast('확인을 요청했어요. 일시정지 중이면 처리하지 않아요.');});
}
render();
if(secret)reload().catch(e=>{toast(e.message);});
