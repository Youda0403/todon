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
export function calculate(expression, stats = {}) {
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
  if(i!==tokens.length || !Number.isFinite(result) || Math.abs(result)>1e9) throw Error('계산 결과가 허용 범위를 벗어났어요.');
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
export function validateRule(rule) {
  if(!rule || !cleanKey(rule.id) || !String(rule.name||'').trim() || String(rule.name).length>80)throw Error('봇 이름을 확인해 주세요.');
  if(!rule.keyword || rule.keyword.length>100 || !['exact','contains'].includes(rule.match))throw Error('반응할 키워드를 입력해 주세요.');
  if(!Number.isInteger(rule.dailyLimit)||rule.dailyLimit<0||rule.dailyLimit>1000||!Number.isInteger(rule.cooldown)||rule.cooldown<0||rule.cooldown>86400)throw Error('횟수·대기시간을 확인해 주세요.');
  if(!Array.isArray(rule.blocks)||!rule.blocks.length||rule.blocks.length>30)throw Error('블록은 1~30개까지 넣을 수 있어요.');
  for(const b of rule.blocks){
    if(!['reply','random','roll','calculate','stat','item','guard','status','inventory','history'].includes(b.type))throw Error('지원하지 않는 블록이에요.');
    if(['stat','item','calculate','guard'].includes(b.type)&&!cleanKey(b.key))throw Error('블록의 항목 이름을 확인해 주세요.');
    if(b.type==='calculate')calculate(b.expression,Object.fromEntries([...String(b.expression).matchAll(/\{([^{}]+)\}/g)].map(m=>[m[1],1])));
    if(b.type==='roll'&&(!Number.isInteger(b.count)||b.count<1||b.count>20||!Number.isInteger(b.sides)||b.sides<2||b.sides>1000))throw Error('주사위 개수는 1~20, 면수는 2~1000이에요.');
    if(['stat','item','guard'].includes(b.type)&&(!Number.isFinite(Number(b.amount))||Math.abs(Number(b.amount))>1e6))throw Error('블록 숫자를 확인해 주세요.');
    if(b.type==='item'&&!Number.isInteger(Number(b.amount)))throw Error('물건 수량은 정수여야 해요.');
    if(b.type==='guard'&&!['stat','item','result'].includes(b.target))throw Error('조건 대상을 확인해 주세요.');
    if(b.type==='guard'&&!['>=','<=','==','>','<'].includes(b.op))throw Error('조건 비교를 확인해 주세요.');
    if(['reply','random'].includes(b.type)&&(!String(b.text||'').trim()||b.text.length>4000))throw Error('출력할 문장을 입력해 주세요.');
  }
  return rule;
}
export function execute(rule, actor, {random=Math.random,history=[]}={}) {
  const stats=numericMap(actor.stats), inventory=numericMap(actor.inventory), changes=[], replies=[];
  let result='';
  const format=text=>String(text||'').replace(/\{([^{}]+)\}/g,(_,key)=>key==='닉네임'?actor.name:key==='결과'?String(result):Object.hasOwn(stats,key)?String(stats[key]):'{'+key+'}');
  for(const b of rule.blocks){
    if(b.type==='guard'){
      const a=b.target==='result'?Number(result):Number((b.target==='item'?inventory:stats)[b.key]||0),n=Number(b.amount);
      const ok={'>=':a>=n,'<=':a<=n,'==':a===n,'>':a>n,'<':a<n}[b.op];
      if(!ok)return {stats:numericMap(actor.stats),inventory:numericMap(actor.inventory),changes:[],replies:b.text?[format(b.text)]:[],rejected:true};
    }
    if(b.type==='random'){
      const choices=String(b.text).split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{const m=/^(\d+(?:\.\d+)?)\s*\|\s*(.+)$/.exec(s);return {weight:m?Number(m[1]):1,text:m?m[2]:s};}).filter(c=>c.weight>0);
      const total=choices.reduce((n,c)=>n+c.weight,0); if(!total)throw Error('랜덤 후보를 한 줄에 하나씩 넣어 주세요.');
      let pick=random()*total; result=choices[choices.length-1].text;
      for(const c of choices)if((pick-=c.weight)<0){result=c.text;break;}
    }
    if(b.type==='roll')result=Array.from({length:b.count},()=>1+Math.floor(random()*b.sides)).reduce((a,b)=>a+b,0);
    if(b.type==='calculate'){result=calculate(b.expression,stats);stats[b.key]=result;changes.push(`${b.key} → ${result}`);}
    if(b.type==='stat'||b.type==='item'){
      const map=b.type==='item'?inventory:stats, next=Number(map[b.key]||0)+Number(b.amount);
      if(!Number.isFinite(next)||Math.abs(next)>1e9||b.type==='item'&&next<0)throw Error('수치 범위를 벗어났거나 물건이 부족해요.');
      map[b.key]=next;changes.push(`${b.key} ${Number(b.amount)>=0?'+':''}${Number(b.amount)} → ${next}`);
    }
    if(b.type==='reply')replies.push(format(b.text));
    if(b.type==='status')replies.push(`${actor.name}의 상태\n`+Object.entries(stats).map(([k,v])=>`${k}: ${v}`).join('\n'));
    if(b.type==='inventory')replies.push(`${actor.name}의 가방\n`+(Object.entries(inventory).filter(([,v])=>v>0).map(([k,v])=>`${k} ×${v}`).join('\n')||'아직 가진 물건이 없어요.'));
    if(b.type==='history')replies.push(`${actor.name}의 최근 기록\n`+(history.slice(0,10).map(h=>h.message).join('\n')||'아직 기록이 없어요.'));
  }
  return {stats,inventory,changes,replies,rejected:false};
}
export function example(kind,accountId='') {
  const base={id:newId(),accountId,enabled:false,name:'',keyword:'',match:'contains',dailyLimit:0,cooldown:30,blocks:[]};
  const templates={
    check:{name:'내 상태와 가방 확인',keyword:'확인',blocks:[{type:'status'},{type:'inventory'}]},
    dice:{name:'주사위',keyword:'[주사위]',blocks:[{type:'roll',count:1,sides:100},{type:'reply',text:'{닉네임}의 주사위 결과: {결과}'}]},
    search:{name:'도서관 조사',keyword:'[도서관 조사]',dailyLimit:3,blocks:[{type:'roll',count:1,sides:100},{type:'guard',target:'result',key:'결과',op:'<=',amount:30,text:'먼지 쌓인 책들뿐입니다. (주사위: {결과})'},{type:'item',key:'낡은 쪽지',amount:1},{type:'stat',key:'관찰력',amount:1},{type:'reply',text:'낡은 쪽지를 발견했습니다. 가방에 기록했어요.\n관찰력: {관찰력}'}]},
    item:{name:'회복약 사용',keyword:'[회복약]',blocks:[{type:'guard',target:'item',key:'회복약',op:'>=',amount:1,text:'회복약이 부족합니다.'},{type:'item',key:'회복약',amount:-1},{type:'stat',key:'체력',amount:10},{type:'reply',text:'회복약을 사용했습니다. 현재 체력: {체력}'}]},
    history:{name:'획득·변경 기록',keyword:'[기록]',blocks:[{type:'history'}]}
  };
  return {...base,...structuredClone(templates[kind]||templates.check)};
}
