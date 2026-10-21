import {newId,numericMap,validateCatalog,execute} from './engine.mjs';
import {esc,actionsHTML,collectActions,actionCommand,listsHTML,variableHTML} from './action-editor.mjs';
const $=(s,r)=>r.querySelector(s),$$=(s,r)=>[...r.querySelectorAll(s)];
let selected='';
export function mountCatalog(root,ctx){
  const c=ctx.config;c.items??=[];if(!c.items.some(i=>i.id===selected))selected=c.items[0]?.id||'';
  const item=c.items.find(i=>i.id===selected);
  root.innerHTML=`${listsHTML(c)}<p class="notice">여기에 등록한 능력치와 아이템을 조사·확률 결과에서 불러올 수 있어요. 능력치 이름은 HP, 행운, 조사횟수처럼 자유롭게 정할 수 있어요.</p><div class="catalog-grid"><section class="card"><h2>능력치·숫자 변수</h2><p class="inline-help">기본값은 새 러너 또는 아직 그 항목이 없는 러너에게 적용돼요. 이미 기록된 수치는 유지돼요.</p><div class="catalog-stat-list">${Object.entries(c.fields).map(([k,n])=>`<div class="catalog-stat-row"><strong>${esc(k)}</strong><label>기본값<input data-catalog-stat="${esc(k)}" type="number" value="${n}" step="any"></label><button data-catalog-stat-delete="${esc(k)}" class="small danger">삭제</button></div>`).join('')}</div><div class="form-grid"><label>새 능력치·변수 이름<input id="newStatName" placeholder="예: HP, 행운" maxlength="60"></label><label>기본 수치<input id="newStatValue" type="number" value="0" step="any"></label></div><button data-catalog-act="addStat" class="small">+ 능력치·변수 등록</button></section><section class="card"><h2>아이템 목록</h2><div class="catalog-item-list">${c.items.map(i=>`<button data-item-pick="${i.id}" class="small ${i.id===selected?'green':''}">${esc(i.name)}${i.usable?' · 사용 가능':''}</button>`).join('')||'<p class="inline-help">획득할 재료나 사용할 아이템을 먼저 등록해 주세요.</p>'}</div><div class="action-add"><label>새 아이템 이름<input id="newItemName" maxlength="60" placeholder="예: 열쇠, 회복약"></label><button data-catalog-act="addItem" class="small">+ 아이템 등록</button></div></section></div>${item?`<section class="card catalog-item-editor"><div class="card-head"><h2>${esc(item.name)} 설정</h2><button data-catalog-act="deleteItem" class="small danger">이 아이템 삭제</button></div><label>설명<textarea data-item-prop="description" maxlength="1000">${esc(item.description)}</textarea></label><label class="checkline"><input type="checkbox" data-item-prop="usable" ${item.usable?'checked':''}> 러너가 사용할 수 있는 아이템</label>${item.usable?`<div class="form-grid"><label>사용 키워드<input data-item-prop="keyword" value="${esc(item.keyword)}" maxlength="100"></label><label class="checkline"><input data-item-prop="consume" type="checkbox" ${item.consume!==false?'checked':''}> 사용하면 아이템 1개 소모</label></div><p class="inline-help">등록된 러너가 자동봇이 켜진 운영 계정에 이 키워드를 멘션하면 사용해요. 수량을 먼저 확인하고 사용 효과와 소모를 함께 기록해요.</p><h3>사용할 때 적용할 효과</h3><div id="itemEffects">${actionsHTML(item.effects,c)}</div><label>사용 효과 적용 후 답장<textarea id="itemUseMessage" data-item-prop="text">${esc(item.text)}</textarea></label>${variableHTML(c,'itemUseMessage')}<button data-catalog-act="tryItem" class="small">사용 효과 시험해 보기</button><div id="itemUsePreview" class="notice" hidden></div>`:'<p class="inline-help">사용을 켜면 HP 회복, 능력치 상승, 랜덤 결과 같은 효과를 설정할 수 있어요.</p>'}</section>`:''}<div class="catalog-save"><button data-catalog-act="save" class="primary">아이템·능력치 목록 저장</button></div>`;
  const collect=()=>{
    for(const el of $$('[data-catalog-stat]',root))c.fields[el.dataset.catalogStat]=Number(el.value);
    if(item){for(const el of $$('[data-item-prop]',root))item[el.dataset.itemProp]=el.type==='checkbox'?el.checked:el.value;if($('#itemEffects',root))collectActions($('#itemEffects',root),item.effects);}
  };
  const redraw=()=>{const y=window.scrollY;mountCatalog(root,ctx);window.scrollTo(0,y);};
  root.oninput=e=>{if(['newStatName','newStatValue','newItemName'].includes(e.target.id))return;try{collect();ctx.onChange();}catch(error){ctx.onError(error.message);}};
  root.onchange=e=>{if(e.target.matches('[data-item-prop="usable"]')){collect();ctx.onChange();redraw();}};
  root.onclick=async e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;e.preventDefault();try{
      collect();const command=actionCommand(b,item?.effects||[],c);if(command){if(command==='redraw'){ctx.onChange();redraw();}return;}
      if(b.dataset.itemPick){selected=b.dataset.itemPick;redraw();return;}
      if(b.dataset.catalogStatDelete!==undefined){if(!confirm('이 능력치를 등록 목록에서 삭제할까요? 기존 러너의 기록은 보관돼요.'))return;delete c.fields[b.dataset.catalogStatDelete];ctx.onChange();redraw();return;}
      const act=b.dataset.catalogAct;
      if(act==='addStat'){const name=$('#newStatName',root).value.trim();if(!name)throw Error('능력치 이름을 적어 주세요.');if(Object.hasOwn(c.fields,name))throw Error('이미 등록된 이름이에요.');c.fields=numericMap({...c.fields,[name]:Number($('#newStatValue',root).value)});}
      if(act==='addItem'){const name=$('#newItemName',root).value.trim();if(!name)throw Error('아이템 이름을 적어 주세요.');if(c.items.some(i=>i.name===name))throw Error('이미 등록된 아이템이에요.');const i={id:newId(),name,description:'',usable:false,consume:true,keyword:'['+name+' 사용]',effects:[],text:name+'을(를) 사용했습니다.'};c.items.push(i);selected=i.id;}
      if(act==='deleteItem'){if(!confirm('이 아이템의 등록과 사용 설정을 삭제할까요? 러너가 가진 수량은 보관되지만 이 아이템의 사용 키워드는 꺼져요.'))return;c.items=c.items.filter(i=>i.id!==item.id);}
      if(act==='save'){numericMap(c.fields);validateCatalog(c.items);b.disabled=true;await ctx.onSave(c);return;}
      if(act==='tryItem'){validateCatalog(c.items);const out=execute({blocks:[{type:'useItem',key:item.name,amount:1}]},{name:'연습 러너',stats:structuredClone(c.fields),inventory:{[item.name]:1}},{items:c.items});const preview=$('#itemUsePreview',root);preview.hidden=false;preview.textContent=[...out.replies,...out.changes].join('\n');return;}
      ctx.onChange();redraw();
    }catch(error){ctx.onError(error.message);}finally{b.disabled=false;}
  };
}
