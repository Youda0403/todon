import {execute,validateRule,matches} from './engine.mjs';
import {esc,actionsHTML,collectActions,actionCommand,listsHTML} from './action-editor.mjs';
const $=(s,r)=>r.querySelector(s),$$=(s,r)=>[...r.querySelectorAll(s)];
export function mountFlexibleBot(root,ctx){
  const r=ctx.rule,c=ctx.config;
  root.innerHTML=`${listsHTML(c)}<section class="card"><div class="card-head"><h2>자동봇 설정</h2><label class="checkline"><input data-flex-rule="enabled" type="checkbox" ${r.enabled?'checked':''}> 이 규칙 켜기</label></div><div class="form-grid"><label>규칙 이름<input data-flex-rule="name" value="${esc(r.name)}"></label><label>발신 계정<select data-flex-rule="accountId">${ctx.accountOptions(r.accountId)}</select></label><label>반응할 키워드<input data-flex-rule="keyword" value="${esc(r.keyword)}"></label><label>인식 방식<select data-flex-rule="match"><option value="contains" ${r.match==='contains'?'selected':''}>문장에 포함되면</option><option value="exact" ${r.match==='exact'?'selected':''}>명령 전체가 같으면</option></select></label><label>러너당 하루 횟수 · 0은 무제한<input data-flex-rule="dailyLimit" type="number" min="0" max="1000" value="${r.dailyLimit}"></label><label>대기시간 · 초<input data-flex-rule="cooldown" type="number" min="0" max="86400" value="${r.cooldown}"></label></div><div id="flexActions">${actionsHTML(r.blocks,c)}</div><div class="editor-foot"><button data-flex-act="save" class="primary">규칙 저장</button><button data-flex-act="copy">복제</button><button data-flex-act="delete" class="danger">규칙 삭제</button></div></section><section class="card flexible-practice"><h2>결과 연습</h2><p class="inline-help">실제 기록은 바뀌지 않아요. 미리 등록한 능력치 기본값으로 시험해요.</p><div class="practice-reply-row"><input id="flexTest" value="${esc(r.keyword)}" aria-label="연습 명령"><button data-flex-act="test" class="green">시험하기</button></div><div id="flexOutput" aria-live="polite"></div></section>`;
  const collect=()=>{for(const el of $$('[data-flex-rule]',root))r[el.dataset.flexRule]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;collectActions($('#flexActions',root),r.blocks);};
  const redraw=()=>{const y=window.scrollY;mountFlexibleBot(root,ctx);window.scrollTo(0,y);};
  root.oninput=e=>{if(e.target.id==='flexTest')return;try{collect();ctx.onChange();}catch(error){ctx.onError(error.message);}};
  root.onclick=async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;e.preventDefault();try{
    collect();const command=actionCommand(b,r.blocks,c);if(command){if(command==='redraw'){ctx.onChange();redraw();}return;}
    if(b.dataset.flexAct==='save'){validateRule(r);b.disabled=true;await ctx.onSave();}
    if(b.dataset.flexAct==='copy')await ctx.onCopy();
    if(b.dataset.flexAct==='delete'&&confirm('이 자동봇 규칙을 삭제할까요?'))await ctx.onDelete();
    if(b.dataset.flexAct==='test'){validateRule(r);const text=$('#flexTest',root).value;if(!matches(r,text))throw Error('시작 키워드가 맞지 않아요.');const out=execute(r,{name:'연습 러너',stats:structuredClone(c.fields),inventory:{}},{items:c.items||[],statMaxes:c.statMaxes||{}});$('#flexOutput',root).innerHTML=`<pre>${esc([...out.replies,...out.changes].join('\n\n'))}</pre>`;}
  }catch(error){ctx.onError(error.message);}finally{b.disabled=false;}};
}
