import {newId,execute,validateRecipes,validateRecipeReferences,statView,matchesRecipe} from './engine.mjs';
import {esc,actionsHTML,collectActions,actionCommand,variableHTML} from './action-editor.mjs';
const $=(s,r)=>r.querySelector(s),$$=(s,r)=>[...r.querySelectorAll(s)];
let selected='';
const trials=new Map();
export function mountRecipes(root,ctx){
  const c=ctx.config;c.recipes??=[];
  if(!c.recipes.some(r=>r.id===selected))selected=c.recipes[0]?.id||'';
  const effectConfig=()=>({...c,excludedActions:['runRecipe','useItem']});
  const current=()=>c.recipes.find(r=>r.id===selected);
  const trial=r=>{if(!trials.has(r.id))trials.set(r.id,{stats:structuredClone(c.fields),inventory:Object.fromEntries(r.ingredients.map(i=>[i.key,i.amount]))});return trials.get(r.id);};
  function collect(){
    const r=current();if(!r||!$('#recipeForm',root))return;
    for(const el of $$('[data-recipe-prop]',root))r[el.dataset.recipeProp]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
    if($('[data-recipe-words]',root))r.triggerWords=$('[data-recipe-words]',root).value.split(/[,\n]+/).map(w=>w.trim()).filter(Boolean);
    r.ingredients=$$('[data-ingredient-row]',root).map(row=>({key:$('[data-ingredient-key]',row).value.trim(),amount:Number($('[data-ingredient-amount]',row).value),consume:$('[data-ingredient-consume]',row).checked}));
    r.conditions=$$('[data-recipe-condition-row]',root).map(row=>({target:'stat',key:$('[data-recipe-condition-key]',row).value.trim(),op:$('[data-recipe-condition-op]',row).value,amount:Number($('[data-recipe-condition-amount]',row).value)}));
    collectActions($('#recipeEffects',root),r.effects);
  }
  function create(itemName){
    if(c.recipes.length>=60)throw Error('레시피는 최대 60개예요.');
    const base=itemName?itemName+' 조합':'새 레시피';let name=base,n=2;while(c.recipes.some(r=>r.name===name))name=base+' '+n++;
    const r={id:newId(),name,callable:true,keyword:'['+name+']',ingredients:[{key:itemName||c.items?.[0]?.name||'',amount:1,consume:true}],conditions:[],chance:100,consumeOnFail:false,effects:[],successText:'조합에 성공했습니다.',failureText:'조합에 실패했습니다.'};
    c.recipes.push(r);selected=r.id;ctx.onChange();draw();
  }
  function triggerHTML(r,t){return `${r.triggerMode==='all'?`<label>모두 들어가야 할 키워드 · 쉼표로 구분<input data-recipe-words value="${esc((r.triggerWords||[]).join(', '))}" placeholder="예: 돌, 마른 풀" maxlength="2000"></label><button class="small" data-recipe-act="materialWords">재료 이름으로 채우기</button><label class="checkline"><input data-recipe-prop="ignoreSpaces" type="checkbox" ${r.ignoreSpaces!==false?'checked':''}> 띄어쓰기 무시</label><p class="inline-help">적은 키워드가 전부 들어 있어야 인식해요. 순서는 상관없어요. 띄어쓰기를 무시하면 ‘마른 풀’과 ‘마른풀’을 같게 봐요.</p>`:`<label>조합 실행 키워드<input data-recipe-prop="keyword" value="${esc(r.keyword)}" maxlength="100"></label>`}<label>인식을 시험할 문장<input data-recipe-trigger-test value="${esc(t.triggerText||'')}" placeholder="예: 돌과 마른풀로 불을 피운다"></label><p class="notice" id="recipeTriggerStatus" role="status"></p><p class="inline-help">이곳에서는 문장 인식만 확인해요. 실제 조합은 가방의 재료와 능력치 조건도 충족해야 해요.</p>`;}
  function updateTriggerPreview(){const r=current(),text=trial(r).triggerText||'',box=$('#recipeTriggerStatus',root);if(box)box.textContent=!text.trim()?'문장을 입력하면 인식 여부를 바로 보여줘요.':matchesRecipe(r,text)?'✓ 이 문장을 인식해요. 재료와 능력치 조건을 확인한 뒤 조합해요.':'아직 인식하지 않아요. '+(r.triggerMode==='all'?'설정한 키워드가 전부 들어가야 해요.':'실행 키워드가 들어가야 해요.');}
  function draw(){
    const r=current(),t=r&&trial(r);
    root.innerHTML=`<section class="card recipe-registry"><div class="card-head"><h2>조합 레시피</h2><button class="small" data-recipe-act="new">+ 레시피 등록</button></div><p class="inline-help">재료와 능력치 조건을 함께 등록해요. 아이템 단독 사용과 조합은 각각의 키워드로 실행할 수 있어요.</p><div class="recipe-list">${c.recipes.map(recipe=>`<button class="small ${recipe.id===selected?'green':''}" data-recipe-pick="${esc(recipe.id)}">${esc(recipe.name)}<small>${esc(recipe.ingredients.map(i=>i.key+' ×'+i.amount).join(' + '))}</small></button>`).join('')||'<p class="notice">레시피를 등록하면 아이템 설정과 조사 결과에서 불러올 수 있어요.</p>'}</div>${r?`<div id="recipeForm"><div class="form-grid"><label>레시피 이름<input data-recipe-prop="name" value="${esc(r.name)}" maxlength="80"></label><label>인식 방식<select data-recipe-prop="triggerMode"><option value="keyword" ${r.triggerMode!=='all'?'selected':''}>실행 키워드가 들어가면</option><option value="all" ${r.triggerMode==='all'?'selected':''}>여러 키워드가 모두 들어가면</option></select></label></div>${triggerHTML(r,t)}<label class="checkline"><input type="checkbox" data-recipe-prop="callable" ${r.callable?'checked':''}> 러너가 키워드로 직접 조합할 수 있음</label><p class="inline-help">켜면 자동봇이 켜진 운영 계정에 설정한 인식 방식에 맞는 문장을 멘션해서 실행해요. 꺼도 조사·아이템 효과의 ‘등록한 레시피 실행’에서 사용할 수 있어요.</p><section class="scene-stage"><h3>① 필요한 재료</h3><p class="inline-help">소모하지 않는 도구도 넣을 수 있어요. 같은 재료는 한 줄에 수량을 합쳐 주세요.</p><div class="recipe-ingredients">${r.ingredients.map((i,n)=>`<div class="recipe-ingredient-row" data-ingredient-row="${n}"><label>재료 아이템<input data-ingredient-key list="cc-item-names" value="${esc(i.key)}" maxlength="60"></label><label>필요 수량<input data-ingredient-amount type="number" min="1" max="10000" value="${i.amount}"></label><label class="checkline"><input data-ingredient-consume type="checkbox" ${i.consume?'checked':''}> 조합 시 소모</label><button class="small danger" data-ingredient-delete="${n}">재료 삭제</button></div>`).join('')}</div><button class="small" data-recipe-act="addIngredient">+ 재료 추가</button></section><section class="scene-stage"><h3>② 필요한 능력치 · 선택 사항</h3><p class="inline-help">모든 조건을 만족해야 시도해요. 능력치는 조건만 확인하며 소모하지 않아요. 예: 힘 3 이상.</p>${r.conditions.map((condition,n)=>`<div class="recipe-condition-row" data-recipe-condition-row="${n}"><label>필요 능력치<input data-recipe-condition-key list="cc-stat-names" value="${esc(condition.key)}" maxlength="60"></label><label>비교<select data-recipe-condition-op>${[['>=','이상'],['>','초과'],['<=','이하'],['<','미만'],['==','같음']].map(([op,label])=>`<option value="${op}" ${condition.op===op?'selected':''}>${label}</option>`).join('')}</select></label><label>조건 수치<input data-recipe-condition-amount type="number" step="any" value="${condition.amount}"></label><button class="small danger" data-recipe-condition-delete="${n}">조건 삭제</button></div>`).join('')}<button class="small" data-recipe-act="addCondition">+ 능력치 조건 추가</button></section><section class="scene-stage"><h3>③ 성공 확률과 재료 처리</h3><div class="form-grid"><label>조합 성공 확률 · %<input data-recipe-prop="chance" type="number" min="0" max="100" step="any" value="${r.chance}"></label><label class="checkline"><input data-recipe-prop="consumeOnFail" type="checkbox" ${r.consumeOnFail?'checked':''}> 확률로 실패해도 소모 재료를 소모</label></div><p class="inline-help">재료나 능력치가 부족하면 이 설정과 관계없이 아무것도 소모하지 않아요.</p></section><section class="scene-stage"><h3>④ 성공하면 적용할 효과</h3><p class="inline-help">완성품 획득, 능력치 변화, ‘불을 피웠습니다’ 같은 문장을 자유롭게 설정해요. 물건을 만들지 않고 문장만 보내도 돼요.</p><div id="recipeEffects">${actionsHTML(r.effects,effectConfig())}</div><label>효과 적용 후 성공 문장 · 선택 사항<textarea id="recipeSuccess" data-recipe-prop="successText" maxlength="2000">${esc(r.successText)}</textarea></label>${variableHTML(c,'recipeSuccess')}<label>확률로 실패했을 때 문장<textarea data-recipe-prop="failureText" maxlength="2000">${esc(r.failureText)}</textarea></label></section><section class="recipe-trial"><h3>레시피 연습</h3><p class="inline-help">실제 러너 기록에는 영향을 주지 않아요. 아래 시험값을 바꿔 재료 부족과 능력치 조건을 확인해 보세요.</p><details><summary>시험용 능력치·재료 설정</summary><div class="practice-values">${Object.keys(c.fields).map(k=>`<label>${esc(k)}<input data-recipe-test-stat="${esc(k)}" type="number" step="any" value="${t.stats[k]??c.fields[k]}"></label>`).join('')}${[...new Set([...(c.items||[]).map(i=>i.name),...r.ingredients.map(i=>i.key)])].filter(Boolean).map(k=>`<label>${esc(k)} 소지 수량<input data-recipe-test-item="${esc(k)}" type="number" min="0" step="1" value="${t.inventory[k]||0}"></label>`).join('')}</div></details><button class="small green" data-recipe-act="test">이 레시피 시험하기</button><pre class="notice recipe-test-output" id="recipeTrialOutput" hidden aria-live="polite"></pre></section><div class="editor-foot"><button class="primary" data-recipe-act="save">레시피 포함 전체 저장</button><button class="danger" data-recipe-act="delete">이 레시피 삭제</button></div></div>`:''}</section>`;
    if(r)updateTriggerPreview();
  }
  root.oninput=e=>{e.stopPropagation();try{const r=current();if(e.target.matches('[data-recipe-trigger-test]')){trial(r).triggerText=e.target.value;updateTriggerPreview();return;}if(e.target.dataset.recipeTestStat!==undefined)trial(r).stats[e.target.dataset.recipeTestStat]=Number(e.target.value);else if(e.target.dataset.recipeTestItem!==undefined)trial(r).inventory[e.target.dataset.recipeTestItem]=Number(e.target.value);else{collect();ctx.onChange();if(r)updateTriggerPreview();}}catch(error){ctx.onError(error.message);}};
  root.onchange=e=>{e.stopPropagation();if(e.target.matches('[data-recipe-prop="triggerMode"]')){collect();const r=current();if(r.triggerMode==='all'){r.ignoreSpaces??=true;if(!r.triggerWords?.length)r.triggerWords=[...new Set(r.ingredients.map(i=>i.key).filter(Boolean))];}ctx.onChange();draw();}};
  root.onclick=async e=>{
    e.stopPropagation();const b=e.target.closest('button');if(!b||b.disabled)return;e.preventDefault();
    try{
      collect();const r=current(),command=r&&actionCommand(b,r.effects,effectConfig());if(command){if(command==='redraw'){ctx.onChange();draw();}return;}
      if(b.dataset.recipePick){selected=b.dataset.recipePick;draw();return;}
      if(b.dataset.ingredientDelete!==undefined){if(!confirm('이 재료를 레시피에서 삭제할까요?'))return;r.ingredients.splice(Number(b.dataset.ingredientDelete),1);}
      if(b.dataset.recipeConditionDelete!==undefined){if(!confirm('이 능력치 조건을 삭제할까요?'))return;r.conditions.splice(Number(b.dataset.recipeConditionDelete),1);}
      const act=b.dataset.recipeAct;
      if(act==='new'){create();return;}
      if(act==='materialWords'){r.triggerWords=[...new Set(r.ingredients.map(i=>i.key).filter(Boolean))];}
      if(act==='addIngredient'){if(r.ingredients.length>=20)throw Error('재료는 최대 20종류예요.');r.ingredients.push({key:'',amount:1,consume:true});}
      if(act==='addCondition'){if(r.conditions.length>=10)throw Error('능력치 조건은 최대 10개예요.');r.conditions.push({target:'stat',key:Object.keys(c.fields)[0]||'힘',op:'>=',amount:3});}
      if(act==='delete'){const next=c.recipes.filter(recipe=>recipe.id!==r.id);validateRecipeReferences({...c,recipes:next});if(!confirm('이 레시피를 삭제할까요?'))return;c.recipes=next;selected=next[0]?.id||'';trials.delete(r.id);}
      if(act==='save'){validateRecipes(c.recipes);validateRecipeReferences(c);b.disabled=true;await ctx.onSave();return;}
      if(act==='test'){
        validateRecipes([r]);const t=trial(r);if(Object.values(t.inventory).some(n=>!Number.isInteger(n)||n<0))throw Error('시험용 소지 수량은 0 이상의 정수로 적어 주세요.');
        const out=execute({blocks:[{type:'runRecipe',recipeId:r.id}]},{name:'연습 러너',stats:{...c.fields,...t.stats},inventory:t.inventory},{items:c.items,recipes:c.recipes,statMaxes:c.statMaxes});
        const box=$('#recipeTrialOutput',root);box.hidden=false;box.textContent=[...out.replies,...out.changes,'시험 후 능력치\n'+Object.entries(statView({stats:out.stats,inventory:out.inventory},c).stats).map(([k,n])=>k+' '+n).join(' · '),'시험 후 가방\n'+(Object.entries(out.inventory).map(([k,n])=>k+' ×'+n).join(' · ')||'가진 물건 없음')].join('\n\n');return;
      }
      ctx.onChange();draw();
    }catch(error){ctx.onError(error.message);}finally{b.disabled=false;}
  };
  draw();
  return {open(id){collect();selected=id;draw();root.scrollIntoView({block:'start',behavior:'smooth'});},createFor(name){collect();create(name);root.scrollIntoView({block:'start',behavior:'smooth'});}};
}
