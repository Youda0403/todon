// Shared by the browser practice room and the Worker. No eval or user JavaScript.
const forbidden = new Set(['__proto__','constructor','prototype']);
export const newId=()=>crypto.randomUUID?.()||'cc-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
export const cleanKey = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 60 && !forbidden.has(s);
export function numericMap(value) {
  const result = Object.create(null);
  for (const [key,n] of Object.entries(value || {})) {
    if (!cleanKey(key) || !Number.isFinite(Number(n)) || Math.abs(Number(n)) > 1e9) throw Error('이름이나 숫자를 확인해 주세요.');
    result[key] = Number(n);
  }
  return result;
}
// Stored stats are permanent values; possession bonuses are derived, never accumulated.
export function validateStatMaxes(maxes={},fields={}){
  const m=numericMap(maxes);
  if(Object.entries(m).some(([k,n])=>!Object.hasOwn(fields,k)||n<0))throw Error('최대치는 등록한 능력치에 0 이상의 숫자로 적어 주세요.');
  return m;
}
export function statView(actor,{items=[],statMaxes={},fields={}}={}){
  const base=numericMap({...fields,...(actor.baseStats||actor.stats||{})}),bonuses=Object.create(null),maxBonuses=Object.create(null),active=[];
  for(const item of items){
    const count=Number(actor.inventory?.[item.name]||0);if(!item.passive||count<=0)continue;
    const times=item.passiveStack==='quantity'?count:1;
    for(const e of item.passiveEffects||[]){
      const delta=e.amount*times,map=e.target==='max'?maxBonuses:bonuses;
      map[e.key]=(map[e.key]||0)+delta;if(!Number.isFinite(map[e.key])||Math.abs(map[e.key])>1e9)throw Error('상시 아이템 보정이 허용 범위를 벗어났어요.');
      active.push({item:item.name,key:e.key,target:e.target||'stat',amount:delta});
    }
  }
  const maxima=Object.fromEntries(Object.entries(statMaxes).map(([k,n])=>[k,Math.max(0,Math.min(1e9,n+(maxBonuses[k]||0)))]));
  const stats=Object.create(null);for(const k of new Set([...Object.keys(base),...Object.keys(bonuses)])){
    const n=(base[k]||0)+(bonuses[k]||0);if(!Number.isFinite(n)||Math.abs(n)>1e9)throw Error('능력치 보정이 허용 범위를 벗어났어요.');stats[k]=Object.hasOwn(maxima,k)?Math.min(n,maxima[k]):n;
  }
  return {stats,baseStats:base,bonuses,maxima,active};
}
export function boundBaseStats(stats,inventory={},config={}){
  const base=numericMap(stats),maxima=statView({stats:base,inventory},config).maxima;
  for(const [k,max] of Object.entries(maxima))if(Object.hasOwn(base,k))base[k]=Math.min(base[k],max);
  return base;
}
export function participantView(actor,config={}){
  const base=boundBaseStats({...config.fields,...(actor.baseStats||actor.stats)},actor.inventory,config),view=statView({stats:base,inventory:actor.inventory},config);
  return {...actor,baseStats:base,stats:view.stats,passiveBonuses:view.bonuses,statMaxes:view.maxima,activePassives:view.active};
}
export function choiceKeywords(choice){
  return [...new Set([choice.keyword,...(choice.keywords||[])].filter(k=>typeof k==='string'&&k.trim()).map(k=>k.trim()))];
}
export function calculate(expression, stats = {}, {validateOnly=false}={}) {
  const source = String(expression).replace(/\{([^{}]+)\}/g, (_,key) => {
    if (!Object.hasOwn(stats,key)) throw Error('없는 능력치예요: ' + key);
    return '(' + Number(stats[key]) + ')';
  });
  if (source.length > 300) throw Error('계산식이 너무 길어요.');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]|\S/g) || [];
  let i=0;
  const atom = () => {
    const t=tokens[i++];
    if (t==='+' || t==='-') return (t==='-'?-1:1)*atom();
    if (t==='(') {const n=sum(); if(tokens[i++]!==')') throw Error('계산식의 괄호를 확인해 주세요.'); return n;}
    if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t||'')) throw Error('숫자, 능력치, 사칙연산만 사용할 수 있어요.');
    return Number(t);
  };
  const product=()=>{let n=atom();while(tokens[i]==='*'||tokens[i]==='/'){const op=tokens[i++],b=atom();n=op==='*'?n*b:n/b;}return n;};
  const sum=()=>{let n=product();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++],b=product();n=op==='+'?n+b:n-b;}return n;};
  const result=sum();
  if(i!==tokens.length || !validateOnly&&(!Number.isFinite(result) || Math.abs(result)>1e9)) throw Error('계산 결과가 허용 범위를 벗어났어요.');
  return Math.round(result*1000)/1000;
}
export function plainText(html) {
  return String(html || '').replace(/<br\s*\/?\s*>|<\/p>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,s)=>{const n=s[0].toLowerCase()==='x'?parseInt(s.slice(1),16):Number(s);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';})
    .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').trim();
}
export function commandText(text, handles=[]) {
  let t=plainText(text);
  // Remove only leading mention tokens, never keywords such as literal @확인.
  while(t.startsWith('@')) {
    const m=/^@([^\s]+)\s+/.exec(t); if(!m)break;
    if(!handles.some(h=>m[1].toLowerCase()===h.toLowerCase()))break;
    t=t.slice(m[0].length).trim();
  }
  return t;
}
export function matches(rule,text) {
  const normalize=value=>normalizeMatchText(value,rule.ignoreSpaces),input=normalize(text);
  if(rule.match==='all')return Array.isArray(rule.keywords)&&rule.keywords.length>0&&rule.keywords.every(word=>normalize(word).length>0&&input.includes(normalize(word)));
  const words=rule.match==='exact'?[rule.keyword]:String(rule.keyword||'').split(/[,\n]+/);
  return words.some(word=>{const keyword=normalize(word).trim();return !!keyword&&(rule.match==='exact'?input.trim()===keyword:input.includes(keyword));});
}
const normalizeMatchText=(value,ignoreSpaces=false)=>{const text=String(value??'').normalize('NFC');return ignoreSpaces?text.replace(/\s+/gu,''):text;};
function validateMatchWords(words,ignoreSpaces){
  if(!Array.isArray(words)||!words.length||words.length>20||words.some(w=>typeof w!=='string'||!w.trim()||w.length>80)||new Set(words.map(w=>normalizeMatchText(w.trim(),ignoreSpaces))).size!==words.length)throw Error('모두 들어가야 할 키워드를 쉼표로 나눠 1~20개 적어 주세요. 같은 키워드는 한 번만 적어 주세요.');
}
export function diceRanges(count=1,sides=100,labels=['어려운 성공','성공','실패','대실패']) {
  if(!Number.isInteger(count)||count<1||count>20||!Number.isInteger(sides)||sides<2||sides>1000)throw Error('주사위 개수는 1~20, 면수는 2~1000이에요.');
  const span=count*sides-count+1,n=Math.min(labels.length,span);
  return Array.from({length:n},(_,i)=>({max:count-1+Math.floor((i+1)*span/n),label:labels[i]}));
}
export const diceBlock=(count=1,sides=100)=>({type:'dice',count,sides,ranges:diceRanges(count,sides),text:'{닉네임} · {주사위식}\n{주사위} / {판정}'});
export function randomChoices(text){
  const choices=String(text||'').split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{const m=/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\|\s*(.*)$/.exec(s);if(m&&!m[2].trim())throw Error('후보 문장을 적어 주세요.');return {weight:m?Number(m[1]):1,text:m?m[2]:s};});
  if(!choices.length||!choices.some(c=>c.weight>0)||choices.some(c=>!Number.isFinite(c.weight)||c.weight<0)||!Number.isFinite(choices.reduce((n,c)=>n+c.weight,0)))throw Error('랜덤 후보와 0보다 큰 뽑힐 비중을 하나 이상 넣어 주세요.');
  return choices;
}
export function validateRule(rule, depth=0) {
  if(depth>3)throw Error('결과 안의 작업은 3단계까지만 연결할 수 있어요.');
  if(!rule || !cleanKey(rule.id) || !String(rule.name||'').trim() || String(rule.name).length>80)throw Error('봇 이름을 확인해 주세요.');
  if(!['exact','contains','all'].includes(rule.match)||rule.match!=='all'&&(!rule.keyword||rule.keyword.length>100))throw Error('반응할 키워드를 입력해 주세요.');
  if(rule.ignoreSpaces!==undefined&&typeof rule.ignoreSpaces!=='boolean')throw Error('띄어쓰기 인식 설정을 확인해 주세요.');
  if(rule.match==='all')validateMatchWords(rule.keywords,rule.ignoreSpaces);
  if(!Number.isInteger(rule.dailyLimit)||rule.dailyLimit<0||rule.dailyLimit>1000||!Number.isInteger(rule.cooldown)||rule.cooldown<0||rule.cooldown>86400)throw Error('횟수·대기시간을 확인해 주세요.');
  if(rule.kind==='dialogue')return validateDialogue(rule);
  if(!Array.isArray(rule.blocks)||!rule.blocks.length||rule.blocks.length>30)throw Error('블록은 1~30개까지 넣을 수 있어요.');
  for(const b of rule.blocks){
    if(!['reply','random','roll','dice','calculate','stat','item','guard','status','inventory','history','gather','recipe','outcome','randomStat','useItem','runRecipe','inspectItem'].includes(b.type))throw Error('지원하지 않는 블록이에요.');
    if(b.type==='outcome'){
      if(!Array.isArray(b.cases)||!b.cases.length||b.cases.length>12||Math.abs(b.cases.reduce((n,c)=>n+c.chance,0)-100)>0.00001)throw Error('확률별 결과의 확률 합계를 100%로 맞춰 주세요.');
      for(const c of b.cases){
        if(typeof c.name!=='string'||!c.name.trim()||c.name.length>80||!Number.isFinite(c.chance)||c.chance<0||c.chance>100||typeof c.text!=='string'||c.text.length>2000||!Array.isArray(c.blocks)||c.blocks.length>10)throw Error('결과 이름·확률·문장·작업을 확인해 주세요.');
        if(c.blocks.length)validateRule({...rule,kind:undefined,blocks:c.blocks},depth+1);
      }
    }
    if(b.type==='randomStat'&&(!Array.isArray(b.keys)||!b.keys.length||b.keys.length>30||b.keys.some(k=>!cleanKey(k))||new Set(b.keys).size!==b.keys.length||!Number.isInteger(b.min)||!Number.isInteger(b.max)||b.min>b.max||Math.abs(b.min)>1e6||Math.abs(b.max)>1e6))throw Error('랜덤으로 바꿀 능력치와 정수 범위를 확인해 주세요.');
    if(b.type==='useItem'&&(!cleanKey(b.key)||!Number.isInteger(b.amount)||b.amount<1||b.amount>20))throw Error('사용할 아이템과 수량을 확인해 주세요.');
    if(b.type==='runRecipe'&&!cleanKey(b.recipeId))throw Error('실행할 레시피를 골라 주세요.');
    if(b.type==='inspectItem'&&!cleanKey(b.key))throw Error('설명을 볼 아이템을 골라 주세요.');
    if(['stat','item','calculate','guard'].includes(b.type)&&!cleanKey(b.key))throw Error('블록의 항목 이름을 확인해 주세요.');
    if(['gather','recipe'].includes(b.type)){
      if(!Number.isFinite(b.chance)||b.chance<0||b.chance>100)throw Error('성공 확률은 0~100%로 적어 주세요.');
      const list=b.type==='gather'?b.loot:b.ingredients;
      if(!Array.isArray(list)||!list.length||list.length>20)throw Error('재료·획득 후보는 1~20개로 정해 주세요.');
      if(new Set(list.map(r=>r.key)).size!==list.length)throw Error('같은 물건은 한 줄에 수량을 합쳐 적어 주세요.');
      for(const r of list){if(!cleanKey(r.key)||!Number.isInteger(r.amount)||r.amount<1||r.amount>10000)throw Error('물건 이름과 수량(1~10000)을 확인해 주세요.');if(b.type==='gather'&&(!Number.isFinite(r.weight)||r.weight<=0||r.weight>10000))throw Error('후보의 비중은 0보다 크고 10000 이하여야 해요.');}
      if(b.type==='recipe'&&(!cleanKey(b.key)||!Number.isInteger(b.amount)||b.amount<1||b.amount>10000||typeof b.consumeOnFail!=='boolean'))throw Error('완성품 이름·수량과 실패 시 재료 처리를 확인해 주세요.');
      for(const k of ['successText','failureText'])if(typeof b[k]!=='string'||!b[k].trim()||b[k].length>2000)throw Error('성공·실패 안내 문장을 적어 주세요.');
    }
    if(b.type==='random')randomChoices(b.text);
    if(b.type==='calculate')calculate(b.expression,Object.fromEntries([...String(b.expression).matchAll(/\{([^{}]+)\}/g)].map(m=>[m[1],1])),{validateOnly:true});
    if(['roll','dice'].includes(b.type)&&(!Number.isInteger(b.count)||b.count<1||b.count>20||!Number.isInteger(b.sides)||b.sides<2||b.sides>1000))throw Error('주사위 개수는 1~20, 면수는 2~1000이에요.');
    if(b.type==='dice'){
      if(!Array.isArray(b.ranges)||!b.ranges.length||b.ranges.length>20)throw Error('판정 구간은 1~20개로 정해 주세요.');
      let previous=b.count-1;
      for(const r of b.ranges){
        if(!Number.isInteger(r.max)||r.max<=previous||r.max>b.count*b.sides)throw Error('판정 구간의 끝 숫자를 작은 순서로 정해 주세요.');
        if(typeof r.label!=='string'||!r.label.trim()||r.label.length>100)throw Error('각 구간에 결과 이름을 적어 주세요.');
        previous=r.max;
      }
      if(previous!==b.count*b.sides)throw Error('마지막 판정 구간은 주사위 최댓값까지 포함해야 해요.');
    }
    if(['stat','item','guard'].includes(b.type)&&(!Number.isFinite(Number(b.amount))||Math.abs(Number(b.amount))>1e6))throw Error('블록 숫자를 확인해 주세요.');
    if(b.type==='item'&&!Number.isInteger(Number(b.amount)))throw Error('물건 수량은 정수여야 해요.');
    if(b.type==='guard'&&!['stat','item','result'].includes(b.target))throw Error('조건 대상을 확인해 주세요.');
    if(b.type==='guard'&&!['>=','<=','==','>','<'].includes(b.op))throw Error('조건 비교를 확인해 주세요.');
    if(['reply','random','dice'].includes(b.type)&&(!String(b.text||'').trim()||b.text.length>4000))throw Error('출력할 문장을 입력해 주세요.');
  }
  return rule;
}
export function execute(rule, actor, {random=Math.random,history=[],diceTotal,items=[],recipes=[],statMaxes={},depth=0,described=new Set()}={}) {
  if(depth>12)throw Error('결과 작업이 너무 깊게 연결되어 있어요.');
  const stats=boundBaseStats(actor.baseStats||actor.stats,actor.inventory,{items,statMaxes}), inventory=numericMap(actor.inventory), changes=[], replies=[],trace=[];
  const view=()=>statView({stats,inventory},{items,statMaxes});
  const setStat=(key,value)=>{const before=view(),target=Object.hasOwn(before.maxima,key)?Math.min(value,before.maxima[key]):value;if(!Number.isFinite(target)||Math.abs(target)>1e9)throw Error('능력치 결과가 허용 범위를 벗어났어요.');if(target!==(before.stats[key]||0)||!Object.hasOwn(stats,key))stats[key]=target-(before.bonuses[key]||0);Object.assign(stats,boundBaseStats(stats,inventory,{items,statMaxes}));return view().stats[key]||0;};
  let result='',diceValue='',verdict='',notation='',itemName='',itemCount=0;
  const format=text=>String(text||'').replace(/\{([^{}]+)\}/g,(_,key)=>key==='획득물건'?itemName:key==='획득수량'?String(itemCount):key==='닉네임'?actor.name:key==='결과'?String(result):key==='주사위'?String(diceValue):key==='판정'?verdict:key==='주사위식'?notation:key.startsWith('물건:')?String(inventory[key.slice(3)]||0):Object.hasOwn(view().stats,key)?String(view().stats[key]):'{'+key+'}');
  const acquired=key=>{const item=items.find(i=>i.name===key);if(item?.description?.trim()&&!described.has(key)){described.add(key);replies.push(key+' · 아이템 설명\n'+item.description.trim());}};
  for(const b of rule.blocks){
    if(['outcome','useItem','runRecipe'].includes(b.type)){
      let blocks,message;
      if(b.type==='outcome'){
        let pick=random()*100,chosen=b.cases.filter(c=>c.chance>0).at(-1);
        for(const c of b.cases)if((pick-=c.chance)<0){chosen=c;break;}
        if(!chosen)throw Error('확률별 결과가 비어 있어요.');
        result=chosen.name;blocks=chosen.blocks;message=chosen.text;
        const award=blocks.find(x=>x.type==='item'&&x.amount>0);itemName=award?.key||'';itemCount=award?.amount||0;
        trace.push('확률 결과: '+chosen.name+' ('+chosen.chance+'%)');
      }else if(b.type==='runRecipe'){
        const recipe=recipes.find(r=>r.id===b.recipeId);if(!recipe)throw Error('등록된 레시피를 찾지 못했어요. 운영자에게 알려 주세요.');
        const missing=recipe.ingredients.filter(r=>(inventory[r.key]||0)<r.amount),failed=recipe.conditions.filter(c=>!conditionMatches({...c,target:'stat'},{stats:view().stats}));
        if(missing.length||failed.length)return {stats:numericMap(actor.baseStats||actor.stats),inventory:numericMap(actor.inventory),changes:[],replies:['조합 조건이 부족해요.\n'+[...missing.map(r=>`${r.key}: ${inventory[r.key]||0} / 필요 ${r.amount}`),...failed.map(c=>`${c.key}: ${view().stats[c.key]||0} / 필요 ${c.amount} ${{'>=':'이상','>':'초과','<=':'이하','<':'미만','==':'같음'}[c.op]}`)].join('\n')],rejected:true,trace:[...trace,'레시피 조건 불충족 · 재료를 소모하지 않음']};
        const chance=recipeChance(recipe,view().stats),success=random()*100<chance.total;trace.push('조합 성공 확률: 기본 '+chance.base+'% + 보너스 '+chance.bonus+'%p → '+chance.total+'%');
        blocks=[...((success||recipe.consumeOnFail)?recipe.ingredients.filter(r=>r.consume!==false).map(r=>({type:'item',key:r.key,amount:-r.amount})):[]),...(success?recipe.effects:[])];
        result=success?'성공':'실패';message=success?recipe.successText:recipe.failureText;trace.push(recipe.name+' · 조합 '+result);
      }else{
        const item=items.find(i=>i.name===b.key&&i.usable);
        if(!item)throw Error('사용 효과가 등록되지 않은 아이템이에요: '+b.key);
        if((inventory[b.key]||0)<b.amount)return {stats:numericMap(actor.stats),inventory:numericMap(actor.inventory),changes:[],replies:[b.key+'이(가) 부족해요.'],rejected:true,trace};
        blocks=[...(item.consume!==false&&!hasAction(item.effects,'runRecipe')?[{type:'item',key:b.key,amount:-b.amount}]:[]),...Array.from({length:b.amount},()=>item.effects).flat()];
        message=item.text||b.key+'을(를) 사용했어요.';
      }
      const child=execute({blocks},{...actor,baseStats:undefined,stats,inventory},{random,history,diceTotal,items,recipes,statMaxes,depth:depth+1,described});
      if(child.rejected)return {...child,stats:numericMap(actor.stats),inventory:numericMap(actor.inventory),changes:[]};
      Object.assign(stats,child.stats);Object.assign(inventory,child.inventory);changes.push(...child.changes);replies.push(...child.replies);trace.push(...child.trace);
      if(child.context){if(child.context.result!=='')result=child.context.result;if(child.context.diceValue!==''){diceValue=child.context.diceValue;verdict=child.context.verdict;notation=child.context.notation;}}
      if(message)replies.push(format(message));
    }
    if(b.type==='randomStat'){
      const k=b.keys[Math.min(b.keys.length-1,Math.floor(random()*b.keys.length))],amount=b.min+Math.floor(random()*(b.max-b.min+1)),before=view().stats[k]||0,next=before+amount;
      if(!Number.isFinite(next)||Math.abs(next)>1e9)throw Error('능력치 결과가 허용 범위를 벗어났어요.');
      const actual=setStat(k,next);result=actual-before;changes.push(`${k} ${actual-before>=0?'+':''}${actual-before} → ${actual}`);trace.push(changes.at(-1));
    }
    if(b.type==='gather'||b.type==='recipe'){
      if(b.type==='recipe'){
        const missing=b.ingredients.filter(r=>(inventory[r.key]||0)<r.amount);
        if(missing.length)return {stats:numericMap(actor.stats),inventory:numericMap(actor.inventory),changes:[],replies:['재료가 부족해요.\n'+missing.map(r=>`${r.key}: ${inventory[r.key]||0} / 필요 ${r.amount}`).join('\n')],rejected:true,trace:[...trace,'재료 부족 · 소모하지 않음']};
      }
      const success=random()*100<b.chance;
      trace.push(`성공 확률 ${b.chance}% → ${success?'성공':'실패'}`);
      const change=(key,amount)=>{const next=(inventory[key]||0)+amount;if(!Number.isSafeInteger(next)||next<0||next>1e9)throw Error('물건 수량의 허용 범위를 벗어났어요.');inventory[key]=next;changes.push(`${key} ${amount>=0?'+':''}${amount} → ${next}`);};
      if(b.type==='recipe'&&(success||b.consumeOnFail))for(const r of b.ingredients)change(r.key,-r.amount);
      itemName='';itemCount=0;
      if(success){
        if(b.type==='gather'){
          let pick=random()*b.loot.reduce((n,r)=>n+r.weight,0),chosen=b.loot.at(-1);
          for(const r of b.loot)if((pick-=r.weight)<0){chosen=r;break;}
          itemName=chosen.key;itemCount=chosen.amount;
        }else{itemName=b.key;itemCount=b.amount;}
        change(itemName,itemCount);
      }
      result=success?`${itemName} ×${itemCount}`:'실패';
      trace.push(b.type==='recipe'?(success||b.consumeOnFail?'필요 재료 소모':'재료 보존'):'성공할 때만 후보 중 한 종류를 획득');
      replies.push(format(success?b.successText:b.failureText));
      if(success)acquired(itemName);
    }
    if(b.type==='guard'){
      const a=b.target==='result'?Number(result):Number((b.target==='item'?inventory:view().stats)[b.key]||0),n=Number(b.amount);
      const ok={'>=':a>=n,'<=':a<=n,'==':a===n,'>':a>n,'<':a<n}[b.op];
      trace.push(`조건: ${b.target==='result'?'직전 결과':b.key} ${a} ${b.op} ${n} → ${ok?'통과':'불충족 · 변경을 모두 취소'}`);
      if(!ok)return {stats:numericMap(actor.stats),inventory:numericMap(actor.inventory),changes:[],replies:b.text?[format(b.text)]:[],rejected:true,trace};
    }
    if(b.type==='random'){
      const choices=randomChoices(b.text).filter(c=>c.weight>0);
      const total=choices.reduce((n,c)=>n+c.weight,0); if(!total)throw Error('랜덤 후보를 한 줄에 하나씩 넣어 주세요.');
      let pick=random()*total; result=choices[choices.length-1].text;
      for(const c of choices)if((pick-=c.weight)<0){result=c.text;break;}
      if(b.emit)replies.push(format(result));
    }
    if(b.type==='roll'||b.type==='dice'){
      const total=diceTotal!==undefined?diceTotal:Array.from({length:b.count},()=>1+Math.floor(random()*b.sides)).reduce((a,b)=>a+b,0);
      if(!Number.isInteger(total)||total<b.count||total>b.count*b.sides)throw Error(`시험할 주사위 값은 ${b.count}~${b.count*b.sides}의 정수로 적어 주세요.`);
      result=diceValue=total;notation=`${b.count}d${b.sides}`;verdict='';
      if(b.type==='dice'){
        const range=b.ranges.find(r=>total<=r.max);
        if(!range)throw Error('주사위 값에 맞는 판정 구간이 없어요.');
        verdict=range.label;replies.push(format(b.text));
      }
    }
    if(b.type==='calculate'){result=setStat(b.key,calculate(b.expression,view().stats));changes.push(`${b.key} → ${result}`);}
    if(b.type==='stat'||b.type==='item'){
      const map=b.type==='item'?inventory:view().stats, before=Number(map[b.key]||0),next=before+Number(b.amount);
      if(!Number.isFinite(next)||Math.abs(next)>1e9||b.type==='item'&&next<0)throw Error('수치 범위를 벗어났거나 물건이 부족해요.');
      if(b.type==='item')inventory[b.key]=next;const actual=b.type==='item'?next:setStat(b.key,next);changes.push(`${b.key} ${actual-before>=0?'+':''}${actual-before} → ${actual}`);
      if(b.type==='item'&&Number(b.amount)>0)acquired(b.key);
    }
    if(b.type==='roll'||b.type==='dice')trace.push(`주사위: ${notation} → ${result}${verdict?' / '+verdict:''}`);
    if(b.type==='random')trace.push('랜덤 선택: '+result);
    if(['calculate','stat','item'].includes(b.type))trace.push(changes.at(-1));
    if(b.type==='reply')replies.push(format(b.text));
    if(b.type==='status')replies.push(`${actor.name}의 상태\n`+Object.entries(view().stats).map(([k,v])=>`${k}: ${v}`).join('\n'));
    if(b.type==='inventory')replies.push(`${actor.name}의 가방\n`+(Object.entries(inventory).filter(([,v])=>v>0).map(([k,v])=>{const description=items.find(i=>i.name===k)?.description?.trim();return `${k} ×${v}`+(description?'\n  '+(description.length>100?description.slice(0,100)+'…':description):'');}).join('\n')||'아직 가진 물건이 없어요.')+(Object.entries(inventory).some(([k,n])=>n>0&&items.some(i=>i.name===k&&i.description?.trim()))?'\n\n[설명 아이템이름]으로 전체 설명을 확인할 수 있어요.':''));
    if(b.type==='inspectItem')replies.push((inventory[b.key]||0)>0?itemDetails(b.key,items):'가방에 있는 아이템만 설명을 확인할 수 있어요.');
    if(b.type==='history')replies.push(`${actor.name}의 최근 기록\n`+(history.slice(0,10).map(h=>h.message).join('\n')||'아직 기록이 없어요.'));
  }
  Object.assign(stats,boundBaseStats(stats,inventory,{items,statMaxes}));
  return {stats,inventory,effectiveStats:view().stats,changes,replies,rejected:false,trace,context:{result,diceValue,verdict,notation,itemName,itemCount}};
}
export function example(kind,accountId='') {
  const base={id:newId(),accountId,enabled:false,name:'',keyword:'',match:'contains',ignoreSpaces:true,dailyLimit:0,cooldown:30,blocks:[]};
  if(kind==='outcome')return {...base,name:'확률별 조사 결과',keyword:'[조사]',blocks:[outcomeExample()]};
  if(kind==='dialogue')return {...base,name:'선택지형 조사',keyword:'조사를 시작한다',cooldown:0,dailyLimit:3,kind:'dialogue',dialogue:dialogueExample()};
  const templates={
    reply:{name:'키워드 답장',keyword:'[안내]',blocks:[{type:'reply',text:'{닉네임}님, 안내 문장을 여기에 적어 주세요.'}]},
    random:{name:'랜덤 답장',keyword:'[운세]',blocks:[{type:'random',emit:true,text:'1 | 좋은 일이 생길 거예요.\n1 | 조심해서 나아가세요.'}]},
    award:{name:'물건 지급',keyword:'[획득]',blocks:[{type:'item',key:'열쇠',amount:1},{type:'reply',text:'열쇠를 받았어요.'},{type:'inventory'}]},
    gather:{name:'숲에서 채집',keyword:'[채집]',dailyLimit:3,cooldown:60,blocks:[{type:'gather',chance:70,loot:[{key:'약초',amount:1,weight:70},{key:'반짝이는 돌',amount:1,weight:30}],successText:'{닉네임}, {획득물건} ×{획득수량}을 찾았어요.',failureText:'이번에는 아무것도 찾지 못했어요.'}]},
    craft:{name:'회복약 제작',keyword:'[회복약 제작]',blocks:[{type:'recipe',chance:100,ingredients:[{key:'약초',amount:2},{key:'물',amount:1}],key:'회복약',amount:1,consumeOnFail:false,successText:'{획득물건} ×{획득수량} 제작 완료!',failureText:'제작에 실패했어요.'}]},
    combine:{name:'재료 조합',keyword:'[조합]',blocks:[{type:'recipe',chance:50,ingredients:[{key:'반짝이는 돌',amount:2},{key:'약초',amount:1}],key:'빛나는 부적',amount:1,consumeOnFail:false,successText:'조합 성공! {획득물건} ×{획득수량}',failureText:'조합에 실패했어요.'}]},
    calculate:{name:'능력치 계산',keyword:'[계산]',blocks:[{type:'calculate',key:'계산값',expression:'{체력} + 5'},{type:'reply',text:'계산 결과: {결과}'}]},

    check:{name:'내 상태와 가방 확인',keyword:'확인',blocks:[{type:'status'},{type:'inventory'}]},
    dice:{name:'주사위·성공 판정',keyword:'[주사위]',blocks:[diceBlock()]},
    search:{name:'도서관 조사',keyword:'[도서관 조사]',dailyLimit:3,blocks:[{type:'roll',count:1,sides:100},{type:'guard',target:'result',key:'결과',op:'<=',amount:30,text:'먼지 쌓인 책들뿐입니다. (주사위: {결과})'},{type:'item',key:'낡은 쪽지',amount:1},{type:'stat',key:'관찰력',amount:1},{type:'reply',text:'낡은 쪽지를 발견했습니다. 가방에 기록했어요.\n관찰력: {관찰력}'}]},
    item:{name:'회복약 사용',keyword:'[회복약]',blocks:[{type:'guard',target:'item',key:'회복약',op:'>=',amount:1,text:'회복약이 부족합니다.'},{type:'item',key:'회복약',amount:-1},{type:'stat',key:'체력',amount:10},{type:'reply',text:'회복약을 사용했습니다. 현재 체력: {체력}'}]},
    history:{name:'획득·변경 기록',keyword:'[기록]',blocks:[{type:'history'}]}
  };
  return {...base,...structuredClone(templates[kind]||templates.check)};
}


// A single active investigation per runner and sending account; scene effects run once per run.
export function dialogueExample(){
  return {start:'start',endKeyword:'조사 종료',scenes:[
    {id:'start',title:'조사 시작',text:'조사를 시작했습니다. 어디로 가시겠습니까?',end:false,actions:[],choices:[{keyword:'숲',next:'forest'},{keyword:'동굴',next:'cave'},{keyword:'바다',next:'sea'}]},
    {id:'forest',title:'숲',text:'숲에 도착했습니다. 어디부터 조사해볼까요?',end:false,actions:[],choices:[{keyword:'나무',next:'tree'},{keyword:'풀숲',next:'grass'},{keyword:'벌집',next:'hive'}]},
    {id:'cave',title:'동굴',text:'동굴 벽에 낡은 표식이 있습니다. 오늘의 조사를 마칩니다.',end:true,actions:[],choices:[]},
    {id:'sea',title:'바다',text:'파도가 밀려옵니다. 바닷가를 살펴보고 조사를 마칩니다.',end:true,actions:[],choices:[]},
    {id:'tree',title:'나무 조사',text:'나무껍질 사이에서 작은 흔적을 발견했습니다. 조사를 마칩니다.',end:true,actions:[],choices:[]},
    {id:'grass',title:'풀숲 조사',text:'풀숲을 살피니 약초가 자라고 있습니다. 조사를 마칩니다.',end:true,actions:[{type:'item',key:'약초',amount:1}],choices:[]},
    {id:'hive',title:'벌집 조사',text:'벌들이 윙윙거립니다. 조심히 물러나 조사를 마칩니다.',end:true,actions:[],choices:[]}
  ]};
}
export function validateDialogue(rule){
  const d=rule.dialogue;
  if(!d||!Array.isArray(d.scenes)||!d.scenes.length||d.scenes.length>60)throw Error('조사 장면은 1~60개로 만들어 주세요.');
  const ids=new Set(d.scenes.map(s=>s.id));
  if(ids.size!==d.scenes.length||d.scenes.some(s=>!cleanKey(s.id))||!ids.has(d.start))throw Error('장면 이름과 시작 장면을 확인해 주세요.');
  const controls=[d.endKeyword].filter(Boolean);
  if(controls.some(k=>typeof k!=='string'||!k.trim()||k.length>100||matches(rule,k)))throw Error('종료 명령과 시작 키워드가 겹치지 않게 적어 주세요.');
  for(const scene of d.scenes){
    if(typeof scene.title!=='string'||!scene.title.trim()||scene.title.length>80||typeof scene.text!=='string'||scene.text.length>1500||typeof scene.end!=='boolean')throw Error('장면 이름을 적고, 이야기는 비워두거나 1500자 이내로 적어 주세요.');
    if(scene.endText!==undefined&&(typeof scene.endText!=='string'||scene.endText.length>1500))throw Error('종료 문장은 1500자 이내로 적어 주세요.');
    if(!Array.isArray(scene.actions)||scene.actions.length>10)throw Error('장면 결과는 최대 10개까지 추가할 수 있어요.');
    if(scene.actions.length)validateRule({...rule,kind:undefined,dialogue:undefined,blocks:scene.actions});
    if(!Array.isArray(scene.choices)||scene.choices.length>9||!scene.end&&!scene.choices.length)throw Error('이어지는 장면에는 선택지 1~9개가 필요해요. 마지막 장면이면 ‘여기서 조사 끝내기’를 켜 주세요.');
    if(scene.end)continue;
    if(new Set(scene.choices.map(c=>c.keyword?.trim())).size!==scene.choices.length)throw Error(scene.title+': 선택지 키워드가 중복됐어요.');
    for(const c of scene.choices){
      if(typeof c.keyword!=='string'||!c.keyword.trim()||c.keyword!==c.keyword.trim()||c.keyword.length>80||/^\d+(?:번)?$/.test(c.keyword)||controls.some(k=>c.keyword.includes(k)||k.includes(c.keyword))||matches(rule,c.keyword))throw Error(scene.title+': 선택지 키워드는 번호·시작·종료 명령과 겹치지 않게 적어 주세요.');
      if(c.keywords!==undefined&&(!Array.isArray(c.keywords)||c.keywords.length>12||c.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>80||/^\d+(?:번)?$/.test(k)||controls.some(control=>k.includes(control)||control.includes(k))||matches(rule,k))))throw Error(scene.title+': 인식 키워드는 쉼표로 나눠 최대 12개까지, 번호·시작·종료 명령과 겹치지 않게 적어 주세요.');
      validateConditions(c.conditions||[]);
      if(!ids.has(c.next))throw Error(scene.title+': 각 선택지에 다음 장면을 골라 주세요.');
    }
  }
  return rule;
}
export function conditionMatches(c,actor){
  const value=Number((c.target==='item'?actor.inventory:actor.stats)?.[c.key]||0),n=Number(c.amount);
  return {'>=':value>=n,'<=':value<=n,'==':value===n,'>':value>n,'<':value<n}[c.op]===true;
}
export function validateConditions(list){
  if(!Array.isArray(list)||list.length>10||list.some(c=>!['stat','item'].includes(c.target)||!cleanKey(c.key)||!['>=','<=','==','>','<'].includes(c.op)||!Number.isFinite(c.amount)||Math.abs(c.amount)>1e9))throw Error('선택지 표시 조건의 항목과 수치를 확인해 주세요.');
}
export function availableChoices(scene,actor={stats:{},inventory:{}}){return !scene||scene.end?[]:scene.choices.filter(c=>(c.conditions||[]).every(condition=>conditionMatches(condition,actor)));}
export function dialogueChoices(scene,text,actor){
  const choices=availableChoices(scene,actor),numbered=/^(\d+)(?:번)?[.!。]?\s*$/.exec(text.trim());
  if(numbered)return choices[Number(numbered[1])-1]?[choices[Number(numbered[1])-1]]:[];
  return choices.filter(c=>choiceKeywords(c).some(k=>text.includes(k)));
}
export function formatMessage(text,actor,context={}){const special={닉네임:actor.name,결과:context.result??'',주사위:context.diceValue??'',판정:context.verdict??'',주사위식:context.notation??''};return String(text||'').replace(/\{([^{}]+)\}/g,(_,k)=>Object.hasOwn(special,k)?String(special[k]):k.startsWith('물건:')?String(actor.inventory?.[k.slice(3)]||0):Object.hasOwn(actor.stats||{},k)?String(actor.stats[k]):'{'+k+'}');}
export function dialoguePrompt(rule,scene,actor,context={}){
  const text=formatMessage(scene.text,actor).trim(),choices=availableChoices(scene,actor);
  const tail=scene.end?(scene.endText??rule.dialogue.endText??'조사가 끝났어요.'):choices.length?choices.map((c,i)=>`${i+1}. ${c.keyword}`).join('\n')+'\n\n선택지 단어나 번호로 답해 주세요.':'지금 고를 수 있는 선택지가 없어요. 필요한 소지품이나 능력치를 확인해 주세요.';
  return [text,formatMessage(tail,actor,context)].filter(Boolean).join('\n\n');
}
export function selectBotRule(rules,text,session,actor){
  const info=rules.find(r=>r.blocks?.[0]?.type==='inspectItem'&&matches(r,text));if(info)return info;
  const current=session&&rules.find(r=>r.id===session.ruleId&&r.kind==='dialogue');
  if(current&&['active','paused'].includes(session.status)){
    const d=current.dialogue,scene=d.scenes.find(s=>s.id===session.sceneId);
    if(text.trim()===d.endKeyword||matches(current,text)||dialogueChoices(scene,text,actor).length)return current;
    const other=rules.find(r=>matches(r,text));if(other&&other.kind!=='dialogue')return other;
    return current;
  }
  return rules.find(r=>r.kind==='dialogue'&&matches(r,text))||rules.find(r=>matches(r,text));
}
export function advanceDialogue(rule,actor,text,previous=null,options={}){
  const d=rule.dialogue,session=previous?.ruleId===rule.id?structuredClone(previous):null;
  const out={stats:numericMap(actor.stats),inventory:numericMap(actor.inventory),changes:[],replies:[],trace:[],rejected:false,session,started:false};
  const effectiveActor={...actor,stats:statView(actor,options).stats};
  const current=session&&d.scenes.find(s=>s.id===session.sceneId);
  const respond=(message,scene=current)=>{out.replies=[message,...(scene?[dialoguePrompt(rule,scene,effectiveActor)]:[])].filter(Boolean);return out;};
  const live=session&&['active','paused'].includes(session.status);
  if(live&&!current){out.session={...session,status:'ended'};return respond('진행하던 장면이 수정되었어요. 시작 키워드로 새 조사를 시작해 주세요.',null);}
  if(live&&text.trim()===d.endKeyword){out.session.status='ended';return respond('조사를 종료했어요. 다시 시작하려면 '+rule.keyword+' 키워드를 보내 주세요.',null);}
  if(live)out.session.status='active';
  if(live&&matches(rule,text))return respond('현재 조사 장면을 다시 보여드릴게요.');
  let target;
  if(!live){
    if(!matches(rule,text))return respond('진행 중인 조사가 없어요. '+rule.keyword+' 키워드로 시작해 주세요.',null);
    target=d.scenes.find(s=>s.id===d.start);
  }else{
    const choices=dialogueChoices(current,text,effectiveActor);
    if(choices.length!==1)return respond(choices.length?'여러 선택지가 함께 들어 있어요. 하나만 골라 주세요.':'지금 장면의 선택지 중 하나를 골라 주세요.');
    target=d.scenes.find(s=>s.id===choices[0].next);
  }
  if(!target)throw Error('다음 조사 장면을 찾지 못했어요. 운영자에게 알려 주세요.');
  const visited=live?session.visited||[]:[];
  const effect=visited.includes(target.id)?{...out,replies:[],trace:['이미 방문한 장면 · 결과를 다시 적용하지 않음']}:execute({blocks:target.actions},actor,options);
  if(effect.rejected){out.rejected=true;out.replies=[...effect.replies,...(current?[dialoguePrompt(rule,current,effectiveActor)]:[])];out.trace=effect.trace;return out;}
  Object.assign(out,{stats:effect.stats,inventory:effect.inventory,changes:effect.changes,trace:[...effect.trace,'장면 이동: '+target.title],started:!live});
  out.session={ruleId:rule.id,sceneId:target.id,status:target.end?'ended':'active',visited:[...new Set([...visited,target.id])]};
  const after={...actor,baseStats:undefined,stats:statView({stats:effect.stats,inventory:effect.inventory},options).stats,inventory:effect.inventory};
  const menu=dialoguePrompt(rule,{...target,text:''},after,effect.context).trim();
  out.replies=[formatMessage(target.text,effectiveActor).trim(),...effect.replies,...(effect.changes.length?['기록 변경: '+effect.changes.join(' · ')]:[]),menu].filter(Boolean);
  return out;
}


export function outcomeExample(stat='체력') {return {type:'outcome',cases:[{name:'약초 발견',chance:25,text:'약초를 발견했습니다.',blocks:[{type:'item',key:'약초',amount:1}]},{name:'돌 발견',chance:25,text:'돌을 발견했습니다.',blocks:[{type:'item',key:'돌',amount:1}]},{name:'실패',chance:50,text:'조사에 실패했습니다. 현재 '+stat+': {'+stat+'}',blocks:[{type:'stat',key:stat,amount:-5}]}]};}

export function upgradeActions(blocks){
  for(let i=0;i<blocks.length;i++){
    const b=blocks[i];
    if(b.type==='gather'){
      const total=b.loot.reduce((n,r)=>n+r.weight,0),cases=b.loot.map(r=>({name:r.key+' 획득',chance:b.chance*r.weight/total,text:b.successText,blocks:[{type:'item',key:r.key,amount:r.amount}]}));
      if(b.chance<100)cases.push({name:'실패',chance:100-b.chance,text:b.failureText,blocks:[]});
      blocks[i]={type:'outcome',cases};
    }else if(b.type==='outcome')for(const c of b.cases)upgradeActions(c.blocks);
  }
  return blocks;
}
export function validateCatalog(items=[]){
  if(!Array.isArray(items)||items.length>200||new Set(items.map(i=>i.name)).size!==items.length||new Set(items.map(i=>i.id)).size!==items.length)throw Error('아이템은 이름이 겹치지 않게 최대 200개까지 등록해 주세요.');
  const used=new Set();
  const hasUse=blocks=>blocks.some(b=>b.type==='useItem'||b.type==='outcome'&&b.cases.some(c=>hasUse(c.blocks)));
  for(const i of items){
    if(!cleanKey(i.id)||!cleanKey(i.name)||typeof i.usable!=='boolean'||typeof i.description!=='string'||i.description.length>1000||typeof i.text!=='string'||i.text.length>2000||!Array.isArray(i.effects)||i.effects.length>10)throw Error('아이템 이름·설명·사용 효과를 확인해 주세요.');
    if(i.passive!==undefined&&typeof i.passive!=='boolean')throw Error('상시 발동 설정을 확인해 주세요.');
    if(i.passiveStack!==undefined&&!['once','quantity'].includes(i.passiveStack))throw Error('상시 효과 중첩 방식을 확인해 주세요.');
    if(i.passiveEffects!==undefined&&(!Array.isArray(i.passiveEffects)||i.passiveEffects.length>20||i.passiveEffects.some(e=>!cleanKey(e.key)||!['stat','max'].includes(e.target)||!Number.isFinite(e.amount)||Math.abs(e.amount)>1e6)))throw Error('상시 보정의 대상 능력치와 수치를 확인해 주세요.');
    if(i.passive&&!i.passiveEffects?.length)throw Error('상시 발동 아이템에는 보정을 하나 이상 추가해 주세요.');
    if(i.usable){const words=String(i.keyword||'').split(/[,\n]+/).map(w=>w.trim());validateMatchWords(words,true);for(const word of words){const key=word.normalize('NFC').replace(/\s+/gu,'');if(used.has(key))throw Error('다른 아이템과 겹치는 사용 키워드가 있어요: '+word);used.add(key);}}
    if(hasUse(i.effects))throw Error('아이템 사용 효과에서 다른 아이템 사용을 다시 실행할 수 없어요. 획득·소모 작업으로 설정해 주세요.');
    if(i.effects.length)validateRule({id:'catalog',name:i.name,keyword:'사용',match:'exact',dailyLimit:0,cooldown:0,blocks:i.effects});
  }
  return items;
}
export function itemUseRules(items,accountId){return (items||[]).filter(i=>i.usable).map(i=>({id:'use-'+i.id,name:i.name+' 사용',accountId,enabled:true,keyword:i.keyword,match:'contains',ignoreSpaces:true,dailyLimit:0,cooldown:0,blocks:[{type:'useItem',key:i.name,amount:1}]}));}

export function hasAction(blocks,type){return (blocks||[]).some(b=>b.type===type||b.type==='outcome'&&b.cases.some(c=>hasAction(c.blocks,type)));}
export function actionReferences(blocks){return (blocks||[]).flatMap(b=>b.type==='runRecipe'?[b.recipeId]:b.type==='outcome'?b.cases.flatMap(c=>actionReferences(c.blocks)):[]);}
export function validateRecipes(recipes=[]){
  if(!Array.isArray(recipes)||recipes.length>60)throw Error('레시피는 최대 60개까지 등록할 수 있어요.');
  const ids=new Set(),names=new Set(),keywords=new Set();
  for(const r of recipes){
    if(!cleanKey(r.id)||ids.has(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>80||names.has(r.name)||typeof r.callable!=='boolean')throw Error('레시피 이름과 실행 설정을 확인해 주세요. 같은 이름은 한 번만 등록해 주세요.');
    ids.add(r.id);names.add(r.name);
    if(r.triggerMode!==undefined&&!['keyword','all'].includes(r.triggerMode)||r.ignoreSpaces!==undefined&&typeof r.ignoreSpaces!=='boolean')throw Error('레시피의 인식 방식과 띄어쓰기 설정을 확인해 주세요.');
    if(typeof r.keyword!=='string'||r.keyword.length>100||r.callable&&r.triggerMode!=='all'&&!r.keyword.trim())throw Error('직접 실행할 레시피에는 키워드를 적어 주세요.');
    if(r.triggerMode==='all')validateMatchWords(r.triggerWords,r.ignoreSpaces);
    const triggerKey=(r.triggerMode==='all'?'all:'+r.triggerWords.map(w=>normalizeMatchText(w.trim(),r.ignoreSpaces)).sort().join('\u0000'):'keyword:'+normalizeMatchText(r.keyword.trim(),r.ignoreSpaces))+':'+!!r.ignoreSpaces;
    if(r.callable&&keywords.has(triggerKey))throw Error('같은 인식 조건을 쓰는 레시피가 있어요. 키워드를 다르게 설정해 주세요.');
    if(r.callable)keywords.add(triggerKey);
    if(!Array.isArray(r.ingredients)||!r.ingredients.length||r.ingredients.length>20||new Set(r.ingredients.map(i=>i.key)).size!==r.ingredients.length||r.ingredients.some(i=>!cleanKey(i.key)||!Number.isInteger(i.amount)||i.amount<1||i.amount>10000||typeof i.consume!=='boolean'))throw Error(r.name+': 재료와 필요 수량, 소모 여부를 확인해 주세요.');
    validateConditions(r.conditions);if(r.conditions.some(c=>c.target!=='stat'))throw Error('능력치 조건에는 능력치를 골라 주세요.');
    if(!Number.isFinite(r.chance)||r.chance<0||r.chance>100||typeof r.consumeOnFail!=='boolean'||typeof r.successText!=='string'||r.successText.length>2000||typeof r.failureText!=='string'||!r.failureText.trim()||r.failureText.length>2000||!Array.isArray(r.effects)||r.effects.length>10)throw Error(r.name+': 확률과 결과 문장·효과를 확인해 주세요.');
    if(r.chanceBonuses!==undefined&&(!Array.isArray(r.chanceBonuses)||r.chanceBonuses.length>10||r.chanceBonuses.some(b=>!cleanKey(b.key)||!Number.isFinite(b.amount)||Math.abs(b.amount)>1e9||!Number.isFinite(b.bonus)||b.bonus<0||b.bonus>100)))throw Error(r.name+': 확률 보너스는 능력치·기준 수치·추가 확률(0~100)을 확인해 주세요.');
    if(hasAction(r.effects,'runRecipe')||hasAction(r.effects,'useItem'))throw Error('레시피 결과에는 아이템 획득·능력치 변화·문장을 직접 설정해 주세요. 다른 레시피나 아이템 사용을 다시 실행할 수는 없어요.');
    if(r.effects.length)validateRule({id:r.id,name:r.name,keyword:'검증',match:'exact',dailyLimit:0,cooldown:0,blocks:r.effects});
  }
  return recipes;
}
export function validateRecipeReferences(config){
  const ids=new Set((config.recipes||[]).map(r=>r.id));
  const lists=[...(config.items||[]).map(i=>i.effects),...(config.rules||[]).flatMap(r=>r.kind==='dialogue'?r.dialogue.scenes.map(s=>s.actions):[r.blocks])];
  if(lists.some(blocks=>actionReferences(blocks).some(id=>!ids.has(id))))throw Error('삭제되었거나 선택하지 않은 레시피를 실행하는 작업이 있어요. 해당 작업에서 레시피를 다시 골라 주세요.');
}
const recipeTrigger=r=>({keyword:r.keyword,match:r.triggerMode==='all'?'all':'contains',keywords:r.triggerWords,ignoreSpaces:r.ignoreSpaces===true});
export function matchesRecipe(recipe,text){return matches(recipeTrigger(recipe),text);}
export function recipeRules(recipes,accountId){return (recipes||[]).filter(r=>r.callable).map(r=>({id:'craft-'+r.id,name:r.name,accountId,enabled:true,...recipeTrigger(r),dailyLimit:0,cooldown:0,blocks:[{type:'runRecipe',recipeId:r.id}]}));}
export function itemDetails(name,items=[]){const item=items.find(i=>i.name===name);return name+' · 아이템 설명\n'+(item?.description?.trim()||'등록된 설명이 없어요.')+(item?.usable?'\n\n사용 키워드: '+item.keyword:'');}
export function itemInfoRules(items,accountId){return (items||[]).map(i=>({id:'info-'+i.id,name:i.name+' 설명',accountId,enabled:true,keyword:'[설명 '+i.name+']',match:'exact',dailyLimit:0,cooldown:0,blocks:[{type:'inspectItem',key:i.name}]}));}

// Use effective stats before consuming ingredients (including passive modifiers).
export function recipeChance(recipe,stats={}){
 const matched=(recipe.chanceBonuses||[]).filter(b=>(stats[b.key]||0)>=b.amount);
 const bonus=matched.reduce((sum,b)=>sum+b.bonus,0);
 return {base:recipe.chance,bonus,total:Math.min(100,Math.max(0,recipe.chance+bonus)),matched};
}
