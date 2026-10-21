import {newId,diceBlock,diceRanges,outcomeExample,upgradeActions} from './engine.mjs';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=(s,r)=>r.querySelector(s),$$=(s,r)=>[...r.querySelectorAll(s)];
export const actionNames={outcome:'확률별 결과 나누기',item:'아이템 획득·소모',stat:'능력치·변수 더하기/빼기',randomStat:'랜덤 능력치 변화',calculate:'계산식으로 수치 정하기',reply:'문장 보내기',useItem:'등록한 아이템 사용',guard:'진행 조건 검사',dice:'주사위·판정',status:'현재 능력치 안내',inventory:'현재 소지품 안내',history:'최근 기록 안내'};
export const getPath=(list,path)=>path?path.split('/').reduce((v,k)=>v[k],list):list;
export const listsHTML=c=>`<datalist id="cc-item-names">${(c.items||[]).map(i=>`<option value="${esc(i.name)}">`).join('')}</datalist><datalist id="cc-stat-names">${Object.keys(c.fields||{}).map(k=>`<option value="${esc(k)}">`).join('')}</datalist>`;
export function variableHTML(c,id,results=true){return `<div class="variable-insert"><select aria-label="넣을 변수" data-variable-picker><option value="{닉네임}">러너 이름</option>${Object.keys(c.fields||{}).map(k=>`<option value="{${esc(k)}}">${esc(k)} 수치</option>`).join('')}${(c.items||[]).map(i=>`<option value="{물건:${esc(i.name)}}">${esc(i.name)} 소지 수량</option>`).join('')}${results?'<option value="{결과}">직전 결과</option><option value="{주사위}">주사위 숫자</option><option value="{판정}">주사위 판정</option>':''}</select><button data-insert-for="${esc(id)}" class="small" type="button">변수 넣기</button></div>`;}
const textField=(label,key,value,c,path)=>{const id='msg-'+path.replaceAll('/','-')+'-'+key;return `<label>${label}<textarea id="${id}" data-effect-prop="${key}">${esc(value)}</textarea></label>${variableHTML(c,id)}`;};
const input=(label,key,value,type='text',extra='')=>`<label>${label}<input data-effect-prop="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const keyInput=(label,key,value,item=false)=>input(label,key,value,'text',`list="cc-${item?'item':'stat'}-names" maxlength="60"`);
export function defaultAction(type,c){
  const stat=Object.keys(c.fields||{})[0]||'HP',item=c.items?.[0]?.name||'약초';
  if(type==='outcome')return outcomeExample(stat);
  if(type==='randomStat')return {type,keys:[stat],min:1,max:3};
  if(type==='calculate')return {type,key:stat,expression:'{'+stat+'} + 1'};
  if(type==='reply')return {type,text:'{닉네임}님, 결과를 확인해 주세요.'};
  if(type==='dice')return diceBlock();
  if(type==='guard')return {type,target:'item',key:item,op:'>=',amount:1,text:'필요한 아이템이 없습니다.'};
  if(type==='useItem')return {type,key:item,amount:1};
  if(['status','inventory','history'].includes(type))return {type};
  return {type,key:type==='item'?item:stat,amount:1};
}
export function actionsHTML(blocks,c,path='',level=0){
  upgradeActions(blocks);
  return `<div class="action-list" data-action-list="${path}">${blocks.map((b,i)=>{const p=path?path+'/'+i:String(i);return `<section class="effect-card" data-effect-path="${p}"><div class="effect-heading"><strong>${i+1}. ${esc(actionNames[b.type]||b.type)}</strong><div class="actions"><button class="small" data-action-op="up" data-list="${path}" data-index="${i}" aria-label="작업 ${i+1} 위로" ${i?'':'disabled'}>↑</button><button class="small danger" data-action-op="delete" data-list="${path}" data-index="${i}">작업 삭제</button></div></div>${actionFields(b,c,p,level)}</section>`;}).join('')}<div class="action-add"><select aria-label="추가할 작업">${Object.entries(actionNames).filter(([t])=>level<2||t!=='outcome').map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select><button class="small" data-action-op="add" data-list="${path}">+ 작업 추가</button></div></div>`;
}
function actionFields(b,c,path,level){
  if(b.type==='outcome')return `<p class="inline-help">아래 결과 중 하나를 뽑고, 그 결과 안의 작업만 실행해요. 한 결과에 아이템 여러 개와 능력치 변화를 함께 넣을 수 있어요.</p><p class="probability-total" data-probability-total>확률 합계 ${b.cases.reduce((n,r)=>n+r.chance,0)}% / 100%</p>${b.cases.map((r,j)=>{const p=path+'/cases/'+j;return `<section class="outcome-case" data-case-path="${p}"><div class="form-grid">${input('결과 이름','name',r.name)}${input('이 결과가 나올 확률 · %','chance',r.chance,'number','min="0" max="100" step="any"')}</div><h4>이 결과일 때 할 일</h4>${actionsHTML(r.blocks,c,p+'/blocks',level+1)}<div class="outcome-message">${textField('작업을 적용한 뒤 보내는 문장','text',r.text,c,p)}<p class="inline-help">문장 속 수치는 위 작업을 적용한 뒤의 값이에요. 예: HP를 5 깎은 뒤 ‘현재 HP: {HP}’를 보낼 수 있어요.</p></div><button class="small danger" data-action-op="deleteCase" data-path="${path}" data-index="${j}" ${b.cases.length===1?'disabled':''}>이 확률 결과 삭제</button></section>`;}).join('')}<button class="small" data-action-op="addCase" data-path="${path}">+ 확률 결과 추가</button>`;
  if(['stat','item','useItem'].includes(b.type))return `<div class="form-grid">${keyInput(b.type==='stat'?'능력치·변수':'아이템','key',b.key,b.type!=='stat')}${input(b.type==='useItem'?'사용 개수':'변경량 · 감소는 음수','amount',b.amount,'number',b.type==='stat'?'step="any"':'step="1"')}</div><p class="inline-help">${b.type==='useItem'?'아이템 목록에 등록한 사용 효과를 실행해요.':'미리 등록한 목록에서 이름을 고르거나 입력할 수 있어요.'} <a href="#catalog" class="text-link">목록 관리</a></p>`;
  if(b.type==='randomStat')return `<p class="inline-help">체크한 능력치 중 하나를 골라 아래 범위의 정수만큼 바꿔요. 특정 능력치의 상승량만 랜덤으로 하려면 하나만 체크해 주세요.</p><div class="stat-picks">${[...new Set([...Object.keys(c.fields||{}),...b.keys])].map(k=>`<label class="checkline"><input type="checkbox" data-random-key="${esc(k)}" ${b.keys.includes(k)?'checked':''}> ${esc(k)}</label>`).join('')}</div><div class="form-grid">${input('최소 변화량','min',b.min,'number','step="1"')}${input('최대 변화량','max',b.max,'number','step="1"')}</div>`;
  if(b.type==='calculate')return keyInput('결과를 저장할 능력치·변수','key',b.key)+textField('계산식 · 예: {HP} - 5','expression',b.expression,c,path);
  if(b.type==='reply')return textField('보낼 문장','text',b.text,c,path);
  if(b.type==='guard')return `<div class="form-grid"><label>검사할 대상<select data-effect-prop="target">${[['item','아이템 수량'],['stat','능력치·변수'],['result','직전 주사위·계산 결과']].map(([v,t])=>`<option value="${v}" ${b.target===v?'selected':''}>${t}</option>`).join('')}</select></label>${keyInput('항목 이름','key',b.key,b.target==='item')}<label>비교<select data-effect-prop="op">${[['>=','이상'],['<=','이하'],['==','같음'],['>','초과'],['<','미만']].map(([v,t])=>`<option value="${v}" ${v===b.op?'selected':''}>${t}</option>`).join('')}</select></label>${input('기준 수치','amount',b.amount,'number','step="any"')}</div>${textField('조건이 맞지 않을 때 안내','text',b.text,c,path)}`;
  if(b.type==='dice'||b.type==='roll')return `<div class="form-grid">${input('주사위 개수','count',b.count,'number','min="1" max="20"')}${input('주사위 면수','sides',b.sides,'number','min="2" max="1000"')}</div>${b.type==='dice'?`<div class="dice-case-rows">${b.ranges.map((r,j)=>`<div><label>${j+1}구간 끝 · 이하<input data-dice-max type="number" value="${r.max}"></label><label>판정 이름<input data-dice-label value="${esc(r.label)}"></label></div>`).join('')}</div>${textField('주사위 답장','text',b.text,c,path)}`:''}`;
  if(['status','inventory','history'].includes(b.type))return '<p class="inline-help">현재 러너의 기록을 읽어서 답장해요.</p>';
  return '<p class="inline-help">기존 작업 설정을 유지하고 있어요.</p>';
}
export function collectActions(root,blocks){
  for(const section of $$('[data-effect-path]',root)){
    const b=getPath(blocks,section.dataset.effectPath),oldCount=b.count,oldSides=b.sides;
    for(const f of $$('[data-effect-prop]',section).filter(f=>f.closest('[data-effect-path]')===section&&f.closest('[data-case-path]')===section.closest('[data-case-path]'))) {
      b[f.dataset.effectProp]=f.type==='number'?Number(f.value):f.value;
    }
    if(b.type==='randomStat')b.keys=$$('[data-random-key]',section).filter(f=>f.checked).map(f=>f.dataset.randomKey);
    if(b.type==='dice'){
      b.ranges=$$('[data-dice-max]',section).map((f,i)=>({max:Number(f.value),label:$$('[data-dice-label]',section)[i].value}));
      if((oldCount!==b.count||oldSides!==b.sides)&&Number.isInteger(b.count)&&b.count>=1&&b.count<=20&&Number.isInteger(b.sides)&&b.sides>=2&&b.sides<=1000){b.ranges=diceRanges(b.count,b.sides,b.ranges.map(r=>r.label));$('.dice-case-rows',section).innerHTML=b.ranges.map((r,i)=>`<div><label>${i+1}구간 끝 · 이하<input data-dice-max type="number" value="${r.max}"></label><label>판정 이름<input data-dice-label value="${esc(r.label)}"></label></div>`).join('');}
    }
  }
  for(const section of $$('[data-case-path]',root)){
    const r=getPath(blocks,section.dataset.casePath);
    for(const f of $$('[data-effect-prop]',section).filter(f=>f.closest('[data-case-path]')===section&&f.closest('[data-effect-path]')===section.closest('[data-effect-path]')))r[f.dataset.effectProp]=f.type==='number'?Number(f.value):f.value;
  }
  for(const section of $$('[data-effect-path]',root)){
    const b=getPath(blocks,section.dataset.effectPath);if(b.type==='outcome')$('[data-probability-total]',section).textContent='확률 합계 '+b.cases.reduce((n,c)=>n+c.chance,0)+'% / 100%';
  }
}
export function actionCommand(button,blocks,c){
  if(button.dataset.insertFor){const target=document.getElementById(button.dataset.insertFor),value=$('[data-variable-picker]',button.parentElement).value;target.setRangeText(value,target.selectionStart,target.selectionEnd,'end');target.dispatchEvent(new Event('input',{bubbles:true}));target.focus({preventScroll:true});return 'insert';}
  const op=button.dataset.actionOp;if(!op)return false;
  if(op==='add'){const list=getPath(blocks,button.dataset.list);if(list.length>=10)throw Error('작업은 최대 10개까지 추가해 주세요.');list.push(defaultAction($('select',button.parentElement).value,c));}
  if(op==='delete'){if(!confirm('이 작업을 삭제할까요? 안에 있는 확률별 결과도 함께 삭제돼요.'))return 'cancel';getPath(blocks,button.dataset.list).splice(Number(button.dataset.index),1);}
  if(op==='up'){const list=getPath(blocks,button.dataset.list),i=Number(button.dataset.index);[list[i-1],list[i]]=[list[i],list[i-1]];}
  if(op==='addCase'){const b=getPath(blocks,button.dataset.path);if(b.cases.length>=12)throw Error('확률 결과는 최대 12개예요.');b.cases.push({name:'새 결과',chance:0,text:'',blocks:[]});}
  if(op==='deleteCase'){if(!confirm('이 확률 결과와 그 안의 작업을 삭제할까요?'))return 'cancel';getPath(blocks,button.dataset.path).cases.splice(Number(button.dataset.index),1);}
  return 'redraw';
}
