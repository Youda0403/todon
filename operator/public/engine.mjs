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
  const keyword=String(rule.keyword||'').trim();
  return !!keyword && (rule.match==='exact'?text.trim()===keyword:text.includes(keyword));
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
export function validateRule(rule) {
  if(!rule || !cleanKey(rule.id) || !String(rule.name||'').trim() || String(rule.name).length>80)throw Error('봇 이름을 확인해 주세요.');
  if(!rule.keyword || rule.keyword.length>100 || !['exact','contains'].includes(rule.match))throw Error('반응할 키워드를 입력해 주세요.');
  if(!Number.isInteger(rule.dailyLimit)||rule.dailyLimit<0||rule.dailyLimit>1000||!Number.isInteger(rule.cooldown)||rule.cooldown<0||rule.cooldown>86400)throw Error('횟수·대기시간을 확인해 주세요.');
  if(!Array.isArray(rule.blocks)||!rule.blocks.length||rule.blocks.length>30)throw Error('블록은 1~30개까지 넣을 수 있어요.');
  for(const b of rule.blocks){
    if(!['reply','random','roll','dice','calculate','stat','item','guard','status','inventory','history','gather','recipe'].includes(b.type))throw Error('지원하지 않는 블록이에요.');
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
export function execute(rule, actor, {random=Math.random,history=[],diceTotal}={}) {
  const stats=numericMap(actor.stats), inventory=numericMap(actor.inventory), changes=[], replies=[],trace=[];
  let result='',diceValue='',verdict='',notation='',itemName='',itemCount=0;
  const format=text=>String(text||'').replace(/\{([^{}]+)\}/g,(_,key)=>key==='획득물건'?itemName:key==='획득수량'?String(itemCount):key==='닉네임'?actor.name:key==='결과'?String(result):key==='주사위'?String(diceValue):key==='판정'?verdict:key==='주사위식'?notation:Object.hasOwn(stats,key)?String(stats[key]):'{'+key+'}');
  for(const b of rule.blocks){
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
    }
    if(b.type==='guard'){
      const a=b.target==='result'?Number(result):Number((b.target==='item'?inventory:stats)[b.key]||0),n=Number(b.amount);
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
    if(b.type==='calculate'){result=calculate(b.expression,stats);stats[b.key]=result;changes.push(`${b.key} → ${result}`);}
    if(b.type==='stat'||b.type==='item'){
      const map=b.type==='item'?inventory:stats, next=Number(map[b.key]||0)+Number(b.amount);
      if(!Number.isFinite(next)||Math.abs(next)>1e9||b.type==='item'&&next<0)throw Error('수치 범위를 벗어났거나 물건이 부족해요.');
      map[b.key]=next;changes.push(`${b.key} ${Number(b.amount)>=0?'+':''}${Number(b.amount)} → ${next}`);
    }
    if(b.type==='roll'||b.type==='dice')trace.push(`주사위: ${notation} → ${result}${verdict?' / '+verdict:''}`);
    if(b.type==='random')trace.push('랜덤 선택: '+result);
    if(['calculate','stat','item'].includes(b.type))trace.push(changes.at(-1));
    if(b.type==='reply')replies.push(format(b.text));
    if(b.type==='status')replies.push(`${actor.name}의 상태\n`+Object.entries(stats).map(([k,v])=>`${k}: ${v}`).join('\n'));
    if(b.type==='inventory')replies.push(`${actor.name}의 가방\n`+(Object.entries(inventory).filter(([,v])=>v>0).map(([k,v])=>`${k} ×${v}`).join('\n')||'아직 가진 물건이 없어요.'));
    if(b.type==='history')replies.push(`${actor.name}의 최근 기록\n`+(history.slice(0,10).map(h=>h.message).join('\n')||'아직 기록이 없어요.'));
  }
  return {stats,inventory,changes,replies,rejected:false,trace};
}
export function example(kind,accountId='') {
  const base={id:newId(),accountId,enabled:false,name:'',keyword:'',match:'contains',dailyLimit:0,cooldown:30,blocks:[]};
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
