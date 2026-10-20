import {execute,validateRule,numericMap,commandText,matches,cleanKey} from '../public/engine.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const err=(text,status=400)=>Object.assign(Error(text),{status});
const now=()=>Date.now();
const day=(time=now())=>new Date(time+9*3600000).toISOString().slice(0,10);
const host=env=>env.MASTODON_HOST||'planet.moe';
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const id=()=>crypto.randomUUID();
// Count statements (including batch members) against the D1 Free 50-query limit.
function budgetDB(raw){
  let used=0;
  const count=n=>{if(used+n>49)throw err('이번 실행의 무료 처리 한도에 도달했어요. 다음 실행에서 이어서 처리해요.',503);used+=n;};
  const wrap=stmt=>({raw:stmt,bind(...args){return wrap(stmt.bind(...args));},first(...args){count(1);return stmt.first(...args);},all(){count(1);return stmt.all();},run(){count(1);return stmt.run();}});
  return {prepare:sql=>wrap(raw.prepare(sql)),batch(stmts){count(stmts.length);return raw.batch(stmts.map(s=>s.raw));},remaining:()=>49-used};
}
function assert(value,text){if(!value)throw err(text);}
async function readBody(request){
  const text=await request.text();if(text.length>200000)throw err('한 번에 저장할 수 있는 크기를 넘었어요.',413);
  try{return JSON.parse(text);}catch{throw err('입력 형식을 확인해 주세요.');}
}
async function key(env){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.ADMIN_KEY));
  return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt']);
}
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function encrypt(value,env){const iv=crypto.getRandomValues(new Uint8Array(12));const result=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),new TextEncoder().encode(JSON.stringify(value)));return base64(iv)+'.'+base64(new Uint8Array(result));}
async function decrypt(value,env){const [a,b]=value.split('.');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(a)},await key(env),bytes(b))));}
async function authorized(request,env){
  if(!env.ADMIN_KEY||env.ADMIN_KEY.length<24)throw err('Cloudflare의 ADMIN_KEY 비밀값을 24자 이상으로 먼저 설정해 주세요.',503);
  const provided=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  const enc=new TextEncoder(),[a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(provided)),crypto.subtle.digest('SHA-256',enc.encode(env.ADMIN_KEY))]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  if(diff)throw err('운영 암호를 확인해 주세요.',401);
}
async function mastodon(env,token,path,{method='GET',body,idem}={}){
  assert(path.startsWith('/api/')||path.startsWith('/oauth/'),'서버 경로가 올바르지 않아요.');
  const headers={};if(token)headers.Authorization='Bearer '+token;if(idem)headers['Idempotency-Key']=idem;
  if(body)headers['Content-Type']='application/json';
  let response;
  // Workers supports manual/follow only. Handle redirects here so credentials stay on this host.
  try{response=await fetch('https://'+host(env)+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw Object.assign(err('마스토돈 응답을 확인하지 못했어요. 전송 결과를 확인해 주세요.',502),{ambiguous:method==='POST'});}
  if(response.status>=300&&response.status<400)throw err('마스토돈 API가 다른 주소로 이동을 요청했어요. 서버 주소를 확인해 주세요.',502);
  if(!response.ok){const e=err(response.status===429?'서버 요청 제한으로 잠시 기다리고 있어요.':`마스토돈 요청 실패 (${response.status})`,response.status);e.retryAfter=Number(response.headers.get('Retry-After'))||60;throw e;}
  return {data:await response.json(),headers:response.headers};
}
async function settings(db){const r=await one(db,'SELECT * FROM settings WHERE id=1');if(!r)throw err('schema.sql로 기록 저장소를 초기화해 주세요.',503);return {...JSON.parse(r.value),revision:r.revision};}
async function acquire(db,name='work'){
  const owner=id();const row=await one(db,'INSERT INTO locks(name,owner,expires) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires<? RETURNING owner',name,owner,now()+180000,now());
  if(!row||row.owner!==owner)throw err('봇이 기록을 처리하고 있어요. 잠시 후 다시 눌러 주세요.',409);
  return ()=>run(db,'DELETE FROM locks WHERE name=? AND owner=?',name,owner);
}
async function locked(db,fn){const release=await acquire(db);try{return await fn();}finally{await release();}}
const actorView=r=>({...r,stats:JSON.parse(r.stats),inventory:JSON.parse(r.inventory)});
// One-time migration preserves the previous stop state without tying future stories to bots.
async function migrateExecution(db,c){
  if(c.executionVersion===2)return c;
  const next={...c,executionVersion:2};delete next.revision;
  const qs=[];
  if(c.paused)qs.push(statement(db,`UPDATE outbox SET state=CASE WHEN first_attempt IS NULL THEN 'held' ELSE 'review' END,last_error=CASE WHEN first_attempt IS NULL THEN last_error ELSE '기존 전체 정지 상태를 유지했어요. 실제 게시 여부를 확인해 주세요.' END WHERE group_id<>'' AND state='pending'`));
  qs.push(statement(db,'UPDATE settings SET value=?,revision=revision+1 WHERE id=1',JSON.stringify(next)));
  await db.batch(qs);return {...next,revision:c.revision+1};
}
async function ensureExecution(db){
  const c=await settings(db);if(c.executionVersion!==2)await locked(db,async()=>migrateExecution(db,await settings(db)));
}
async function state(db){
  const [config,accounts,participants,audit,outbox,runtime,stories]=await Promise.all([
    settings(db),all(db,'SELECT id,label,acct,active,error,max_chars FROM accounts'),all(db,'SELECT * FROM participants ORDER BY name'),
    all(db,'SELECT * FROM audit ORDER BY id DESC LIMIT 100'),all(db,`SELECT id,title,state,due,last_error,group_id,account_id,first_attempt FROM outbox WHERE state NOT IN ('sent','cancelled') OR id IN (SELECT id FROM outbox WHERE state IN ('sent','cancelled') ORDER BY due DESC LIMIT 100) ORDER BY due,id`),all(db,'SELECT * FROM runtime'),all(db,`SELECT group_id,MIN(title) AS title,MIN(due) AS due,COUNT(*) AS total,
    SUM(state='pending') AS pending,SUM(state='held') AS held,SUM(state='sent') AS sent,SUM(state='cancelled') AS cancelled,SUM(state='review') AS review,
    SUM(state='pending' AND first_attempt IS NULL) AS pausable,SUM(state IN ('pending','held') AND first_attempt IS NULL) AS cancellable
    FROM outbox WHERE group_id<>'' GROUP BY group_id ORDER BY MIN(due) DESC`)]);
  return {config,accounts,participants:participants.map(actorView),audit,outbox,stories,runtime:Object.fromEntries(runtime.map(r=>[r.key,r.value]))};
}
function validateConfig(c){
  assert(typeof c.paused==='boolean'&&Array.isArray(c.rules)&&c.rules.length<=60,'설정을 확인해 주세요. 규칙은 최대 60개예요.');
  c.fields=numericMap(c.fields);assert(Object.keys(c.fields).length<=30,'능력치는 최대 30개예요.');
  for(const rule of c.rules)validateRule(rule);
  assert(new Set(c.rules.map(r=>r.id)).size===c.rules.length,'규칙 ID가 중복됐어요.');
  assert(Number.isInteger(c.dailyCap)&&c.dailyCap>=1&&c.dailyCap<=5000,'전체 명령 상한은 1~5000으로 설정해 주세요.');
  assert(Array.isArray(c.events)&&c.events.length<=300,'일정은 최대 300개예요.');
  for(const e of c.events)assert(cleanKey(e.id)&&String(e.title||'').length>0&&String(e.title).length<=120&&Number.isFinite(Date.parse(e.at)),'일정의 제목과 시간을 확인해 주세요.');
  for(const url of Object.values(c.invites||{})){try{const u=new URL(url);assert(u.protocol==='https:','초대 링크는 https 주소여야 해요.');}catch{throw err('초대 링크 주소를 확인해 주세요.');}}
  return c;
}
async function startOAuth(request,env){
  const origin=new URL(request.url).origin,redirect=origin+'/oauth/callback',scope='read:accounts read:notifications write:statuses';
  const {data:app}=await mastodon(env,null,'/api/v1/apps',{method:'POST',body:{client_name:'커뮤 운영실',redirect_uris:redirect,scopes:scope,website:origin}});
  const state=id()+id();await run(env.DB,'DELETE FROM oauth WHERE expires<?',now());
  await run(env.DB,'INSERT INTO oauth(state,payload,expires) VALUES(?,?,?)',state,await encrypt({client_id:app.client_id,client_secret:app.client_secret,redirect,scope},env),now()+600000);
  return json({url:'https://'+host(env)+'/oauth/authorize?'+new URLSearchParams({client_id:app.client_id,redirect_uri:redirect,response_type:'code',scope,state,force_login:'true'})});
}
async function finishOAuth(request,env){
  assert(env.ADMIN_KEY&&env.ADMIN_KEY.length>=24,'운영 암호를 먼저 설정해 주세요.');
  const u=new URL(request.url),s=u.searchParams.get('state'),code=u.searchParams.get('code');assert(s&&code,'로그인을 승인하지 않았거나 인증 코드가 없어요.');
  const row=await one(env.DB,'DELETE FROM oauth WHERE state=? AND expires>? RETURNING payload',s,now());assert(row,'로그인 시간이 만료되었어요. 다시 시작해 주세요.');
  const app=await decrypt(row.payload,env);
  const {data:tok}=await mastodon(env,null,'/oauth/token',{method:'POST',body:{grant_type:'authorization_code',code,client_id:app.client_id,client_secret:app.client_secret,redirect_uri:app.redirect}});
  const {data:me}=await mastodon(env,tok.access_token,'/api/v1/accounts/verify_credentials');
  const {data:latest}=await mastodon(env,tok.access_token,'/api/v1/notifications?types%5B%5D=mention&limit=1');
  let max=500;try{const {data:info}=await mastodon(env,null,'/api/v2/instance');max=info.configuration?.statuses?.max_characters||500;}catch{}
  const sealedToken=await encrypt(tok.access_token,env);
  await locked(env.DB,()=>run(env.DB,'INSERT INTO accounts(id,label,acct,token,cursor,max_chars) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,acct=excluded.acct,token=excluded.token,error=\'\',max_chars=excluded.max_chars',String(me.id),me.display_name||me.username,me.acct.includes('@')?me.acct:me.acct+'@'+host(env),sealedToken,latest[0]?.id||'',max));
  return Response.redirect(u.origin+'/?connected=1#accounts',303);
}
async function addParticipants(body,env){
  const a=await one(env.DB,'SELECT * FROM accounts WHERE id=?',body.accountId);assert(a,'조회에 사용할 운영 계정을 선택해 주세요.');
  const names=String(body.names||'').split(/[\n,]+/).map(s=>s.trim().replace(/^@/,'')).filter(Boolean);assert(names.length&&names.length<=30,'계정을 한 줄에 하나씩, 최대 30명까지 입력해 주세요.');
  const token=await decrypt(a.token,env),config=await settings(env.DB),added=[],failed=[];
  for(const name of names){try{
    assert(!/\s/.test(name)&&name.length<150,'아이디 형식을 확인해 주세요.');
    const {data:p}=await mastodon(env,token,'/api/v1/accounts/lookup?acct='+encodeURIComponent(name));
    await run(env.DB,'INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET acct=excluded.acct,name=excluded.name',String(p.id),p.acct.includes('@')?p.acct:p.acct+'@'+host(env),p.display_name||p.username,JSON.stringify(config.fields));added.push(name);
  }catch{failed.push(name);}}
  return json({added,failed});
}
function splitReply(text,max,prefix=''){
  const room=max-Array.from(prefix).length-2;assert(room>=30,'계정 글자 수 제한이 너무 작아요.');
  const parts=[],chars=Array.from(text);for(let i=0;i<chars.length;i+=room)parts.push(prefix+chars.slice(i,i+room).join(''));
  assert(parts.length<=5,'출력할 답글이 너무 길어요. 5개 이내로 줄여 주세요.');return parts;
}
async function processJob(job,account,config,env){
  const payload=JSON.parse(job.payload),text=commandText(payload.text,[account.acct,account.acct.split('@')[0]]);
  const rule=config.rules.find(r=>r.enabled&&r.accountId===account.id&&matches(r,text));
  if(!rule){await run(env.DB,"UPDATE jobs SET state='ignored' WHERE id=?",job.id);return;}
  const d=day(),actorRow=await one(env.DB,"SELECT p.*,u.count AS use_count,u.last_at AS use_last_at,(SELECT value FROM runtime WHERE key=?) AS used,(SELECT json_group_array(json_object('message',message)) FROM (SELECT message FROM audit WHERE actor_id=p.id ORDER BY id DESC LIMIT 10)) AS history_json FROM participants p LEFT JOIN usage u ON u.actor_id=p.id AND u.rule_id=? AND u.day=? WHERE p.id=?",'used:'+d,rule.id,d,job.actor_id);
  if(!actorRow||config.paused){await run(env.DB,"UPDATE jobs SET state='ignored' WHERE id=?",job.id);return;}
  const actor=actorView(actorRow);
  if(actorRow.use_last_at&&now()-actorRow.use_last_at<rule.cooldown*1000){await run(env.DB,"UPDATE jobs SET state='cooldown' WHERE id=?",job.id);return;}
  const used=Number(actorRow.used||0);
  if(used>=config.dailyCap)return;
  let output;
  if(rule.dailyLimit>0&&actorRow.use_count>=rule.dailyLimit)output={stats:actor.stats,inventory:actor.inventory,changes:[],replies:['오늘 사용할 수 있는 횟수를 모두 사용했어요.'],limited:true};
  else output=execute(rule,actor,{history:JSON.parse(actorRow.history_json||'[]')});
  const queries=[statement(env.DB,'UPDATE participants SET stats=?,inventory=?,revision=revision+1 WHERE id=?',JSON.stringify(output.stats),JSON.stringify(output.inventory),actor.id),statement(env.DB,"UPDATE jobs SET state='done' WHERE id=?",job.id),statement(env.DB,'INSERT INTO runtime(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','used:'+d,String(used+1))];
  queries.push(statement(env.DB,'INSERT INTO usage(rule_id,actor_id,day,count,last_at) VALUES(?,?,?,?,?) ON CONFLICT(rule_id,actor_id,day) DO UPDATE SET count=count+excluded.count,last_at=excluded.last_at',rule.id,actor.id,d,output.limited?0:1,now()));
  if(output.changes.length)queries.push(statement(env.DB,'INSERT INTO audit(actor_id,created,message,source) VALUES(?,?,?,?)',actor.id,now(),output.changes.join(' / '),rule.name));
  const combined=output.replies.join('\n\n');
  if(combined){
    const parts=splitReply(combined,account.max_chars,'@'+actor.acct+' ');
    parts.forEach((text,i)=>queries.push(statement(env.DB,'INSERT OR IGNORE INTO outbox(id,account_id,body,due,title) VALUES(?,?,?,?,?)',job.id+':'+i,account.id,JSON.stringify({status:text,in_reply_to_id:payload.statusId,visibility:payload.visibility==='direct'?'direct':'private'}),now(),rule.name)));
  }
  await env.DB.batch(queries);
}
function nextPage(headers,env){
  const match=/<([^>]+)>;\s*rel="next"/.exec(headers.get('Link')||'');if(!match)return '';
  const u=new URL(match[1]);if(u.hostname!==host(env)||u.pathname!=='/api/v1/notifications')return '';return u.pathname+u.search;
}
async function pollAccount(a,env,connectedIds){
  const scan=a.scan?JSON.parse(a.scan):null;
  const path=scan?.next||'/api/v1/notifications?types%5B%5D=mention&limit=10'+(a.cursor?'&since_id='+encodeURIComponent(a.cursor):'');
  const {data:list,headers}=await mastodon(env,await decrypt(a.token,env),path);
  const rows=list.filter(n=>n.type==='mention'&&n.status&&!connectedIds.has(String(n.account.id))).map(n=>statement(env.DB,'INSERT OR IGNORE INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)',a.id+':'+n.id,a.id,String(n.account.id),JSON.stringify({text:n.status.content,statusId:n.status.id,visibility:n.status.visibility}),Date.parse(n.created_at)||now()));
  const newest=scan?.newest||list[0]?.id||a.cursor;
  const next=list.length?nextPage(headers,env):'';
  rows.push(next?statement(env.DB,'UPDATE accounts SET scan=?,error=\'\' WHERE id=?',JSON.stringify({next,newest}),a.id):statement(env.DB,'UPDATE accounts SET cursor=?,scan=\'\',error=\'\' WHERE id=?',newest,a.id));
  await env.DB.batch(rows);
}
async function sendOutbox(env,limit=4,{bots=true,group=null,onlyBots=false}={}){
  const rows=await all(env.DB,"SELECT o.*,a.token,a.active FROM outbox o JOIN accounts a ON a.id=o.account_id WHERE o.state='pending' AND o.due<=? AND ((o.group_id='' AND a.active=1 AND ?=1) OR (o.group_id<>'' AND ?=0)) AND (? IS NULL OR o.group_id=?) AND (o.group_id='' OR NOT EXISTS (SELECT 1 FROM outbox earlier WHERE earlier.group_id=o.group_id AND earlier.state NOT IN ('sent','cancelled') AND earlier.id<o.id)) ORDER BY o.due,o.id LIMIT ?",now(),bots?1:0,onlyBots?1:0,group,group,limit);
  for(const o of rows){
    if(env.DB.remaining&&env.DB.remaining()<6)break;
    // Mastodon only retains Idempotency-Key for one hour. Stop uncertain older retries.
    if(o.first_attempt&&now()-o.first_attempt>3300000){await run(env.DB,"UPDATE outbox SET state='review',last_error='최초 전송 후 55분이 지나 중복 방지를 위해 자동 재전송을 멈췄어요. 계정에서 게시 여부를 확인해 주세요.' WHERE id=?",o.id);continue;}
    await run(env.DB,'UPDATE outbox SET attempts=attempts+1,first_attempt=COALESCE(first_attempt,?) WHERE id=?',now(),o.id);
    try{
      const {data:posted}=await mastodon(env,await decrypt(o.token,env),'/api/v1/statuses',{method:'POST',body:JSON.parse(o.body),idem:'ops-'+o.id});
      await run(env.DB,"UPDATE outbox SET state='sent',posted_id=?,last_error='' WHERE id=?",posted.id,o.id);
    }catch(e){
      const retry=e.status===429||e.status>=500||e.ambiguous;
      const state=retry&&o.attempts<5?'pending':'review';
      await run(env.DB,'UPDATE outbox SET state=?,due=?,last_error=? WHERE id=?',state,now()+Math.max(e.retryAfter||0,Math.min(900,60*2**o.attempts))*1000,e.message,o.id);
    }
  }
}
export async function tick(env,{scheduled=false,onlyBots=false}={}){
  if(!env.DB||!env.ADMIN_KEY||env.ADMIN_KEY.length<24)return;
  env={...env,DB:budgetDB(env.DB)};
  let release;try{release=await acquire(env.DB);}catch(e){if(e.status===409)return;throw e;}
  try{
    const config=await migrateExecution(env.DB,await settings(env.DB));await run(env.DB,"INSERT INTO runtime(key,value) VALUES('lastTick',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(now()));
    if(scheduled)await run(env.DB,"INSERT INTO runtime(key,value) VALUES('lastCron',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(now()));
    // Posting a notice never enables bots or other story groups.
    await sendOutbox(env,3,{bots:!config.paused,onlyBots});
    if(!config.paused){
    const accounts=await all(env.DB,'SELECT * FROM accounts WHERE active=1 ORDER BY id');
    const offset=Number((await one(env.DB,"SELECT value FROM runtime WHERE key='pollOffset'"))?.value||0);
    for(let i=0;i<Math.min(1,accounts.length);i++){
      const a=accounts[(offset+i)%accounts.length];
      try{await pollAccount(a,env,new Set(accounts.map(a=>a.id)));}catch(e){await run(env.DB,'UPDATE accounts SET error=? WHERE id=?',e.message,a.id);}
    }
    await run(env.DB,"INSERT INTO runtime(key,value) VALUES('pollOffset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(offset+1));
    const jobs=await all(env.DB,"SELECT j.* FROM jobs j JOIN accounts a ON a.id=j.account_id WHERE j.state='pending' AND a.scan='' AND a.active=1 ORDER BY j.created,j.id LIMIT 6");
    for(const job of jobs){if(env.DB.remaining()<16)break;const a=accounts.find(a=>a.id===job.account_id);if(!a)continue;try{await processJob(job,a,config,env);}catch(e){await run(env.DB,"UPDATE jobs SET state='error',error=? WHERE id=?",e.message,job.id);await run(env.DB,'UPDATE accounts SET error=? WHERE id=?',e.message,a.id);}}
    }
    await sendOutbox(env,6,{bots:!config.paused,onlyBots});
    await run(env.DB,"INSERT INTO runtime(key,value) VALUES('tickError','') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  }catch(e){
    if(env.DB.remaining()>=2)await run(env.DB,"INSERT INTO runtime(key,value) VALUES('tickError',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",e.status?e.message:'처리 중 오류가 발생했어요. 잠시 후 다시 확인해 주세요.');
    throw e;
  }finally{await release();}
}
async function apiRoute(request,env,url){
  await authorized(request,env);assert(env.DB,'DB라는 이름으로 D1 저장소를 연결해 주세요.');
  await ensureExecution(env.DB);
  const path=url.pathname,method=request.method;
  if(path==='/api/state'&&method==='GET')return json(await state(env.DB));
  if(path==='/api/oauth/start'&&method==='POST')return startOAuth(request,env);
  if(path==='/api/participants/import'&&method==='POST')return addParticipants(await readBody(request),env);
  if(path==='/api/config'&&method==='PUT'){
    let c;try{c=validateConfig(await readBody(request));}catch(e){throw err(e.message);}
    c.executionVersion=2;
    return locked(env.DB,async()=>{
      const existing=await settings(env.DB);if(c.revision!==existing.revision)throw err('다른 화면에서 설정이 바뀌었어요. 새로 불러온 뒤 수정해 주세요.',409);
      const accountIds=new Set((await all(env.DB,'SELECT id FROM accounts')).map(a=>a.id));
      for(const r of c.rules)assert(!r.enabled||accountIds.has(r.accountId),'켜진 규칙에 발신 계정을 지정해 주세요.');
      delete c.revision;await run(env.DB,'UPDATE settings SET value=?,revision=revision+1 WHERE id=1',JSON.stringify(c));return json({ok:true,revision:existing.revision+1});
    });
  }
  if(path==='/api/participant'&&method==='PUT'){
    const b=await readBody(request);return locked(env.DB,async()=>{
      const current=await one(env.DB,'SELECT * FROM participants WHERE id=?',b.id);assert(current,'등록된 러너가 아니에요.');if(b.revision!==current.revision)throw err('러너 기록이 바뀌었어요. 새로 불러와 주세요.',409);
      const stats=numericMap(b.stats),inventory=numericMap(b.inventory);assert(Object.values(inventory).every(v=>v>=0&&Number.isInteger(v)),'물건 수량은 0 이상의 정수여야 해요.');assert(Object.keys(stats).length<=30&&Object.keys(inventory).length<=200,'기록 항목이 너무 많아요.');
      const before=actorView(current),changes=[];for(const [label,old,value] of [['능력치',before.stats,stats],['물건',before.inventory,inventory]])for(const k of new Set([...Object.keys(old),...Object.keys(value)]))if(old[k]!==value[k])changes.push(`${label} ${k}: ${old[k]??0} → ${value[k]??0}`);
      const sqls=[statement(env.DB,'UPDATE participants SET stats=?,inventory=?,revision=revision+1 WHERE id=?',JSON.stringify(stats),JSON.stringify(inventory),b.id)];
      if(changes.length)sqls.push(statement(env.DB,'INSERT INTO audit(actor_id,created,message,source) VALUES(?,?,?,?)',b.id,now(),changes.join(' / '),'운영자 수정'));await env.DB.batch(sqls);return json({ok:true});
    });
  }
  if(path==='/api/account'&&method==='PUT'){
    const b=await readBody(request);return locked(env.DB,async()=>{assert(String(b.label||'').trim()&&b.label.length<=80,'계정 별명을 입력해 주세요.');await run(env.DB,'UPDATE accounts SET label=?,active=? WHERE id=?',b.label,b.active?1:0,b.id);return json({ok:true});});
  }
  if(path==='/api/bots/control'&&method==='POST'){
    const b=await readBody(request);assert(typeof b.paused==='boolean','자동봇 실행 상태를 확인해 주세요.');
    return locked(env.DB,async()=>{const c=await settings(env.DB);c.paused=b.paused;delete c.revision;await run(env.DB,'UPDATE settings SET value=?,revision=revision+1 WHERE id=1',JSON.stringify(c));return json({ok:true});});
  }
  if(path==='/api/announcement'&&method==='POST'){
    const b=await readBody(request);assert(typeof b.requestId==='string'&&/^[a-zA-Z0-9-]{16,60}$/.test(b.requestId),'전송 요청 번호를 확인해 주세요.');
    return locked(env.DB,async()=>{
      const a=await one(env.DB,'SELECT id,max_chars FROM accounts WHERE id=?',b.accountId);assert(a,'발신 계정을 선택해 주세요.');
      assert(typeof b.text==='string'&&b.text.trim()&&Array.from(b.text).length<=a.max_chars,'본문과 글자 수를 확인해 주세요.');
      const visibility=b.visibility||'private';assert(['private','unlisted','public'].includes(visibility),'공개 범위를 확인해 주세요.');
      const group='notice-'+b.requestId,body=JSON.stringify({status:b.text,visibility});
      const previous=await one(env.DB,'SELECT * FROM outbox WHERE id=?',group+':0000');
      if(previous)assert(previous.account_id===a.id&&previous.body===body,'이미 사용한 요청 번호예요. 본문을 확인하고 새 요청으로 보내 주세요.');
      else{
        const due=b.at?Date.parse(b.at):now();assert(Number.isFinite(due)&&(!b.at||due>now()+30000),'예약 시각은 현재보다 30초 이상 뒤로 정해 주세요.');
        await run(env.DB,'INSERT INTO outbox(id,account_id,body,due,group_id,title) VALUES(?,?,?,?,?,?)',group+':0000',a.id,body,due,group,'운영 공지');
      }
      if(!b.at)await sendOutbox(env,1,{bots:false,group});
      const row=await one(env.DB,'SELECT state,due,last_error,posted_id FROM outbox WHERE id=?',group+':0000');
      return json({ok:true,group,...row});
    });
  }
  if(path==='/api/group/check'&&method==='POST'){
    const b=await readBody(request);assert(typeof b.group==='string'&&b.group,'예약을 선택해 주세요.');
    return locked(env.DB,async()=>{await sendOutbox(env,1,{bots:false,group:b.group});return json({ok:true});});
  }
  if(path==='/api/story'&&method==='POST'){
    const b=await readBody(request);assert(Array.isArray(b.scenes)&&b.scenes.length&&b.scenes.length<=30,'한 대본은 1~30장면까지 등록할 수 있어요.');
    return locked(env.DB,async()=>{
      const group=id(),accounts=await all(env.DB,'SELECT id,max_chars FROM accounts'),sqls=[];
      let due=Date.parse(b.start);assert(Number.isFinite(due)&&due>now()+30000,'시작 시각을 지금보다 30초 이상 뒤로 정해 주세요.');
      for(const [i,s] of b.scenes.entries()){
        const account=accounts.find(a=>a.id===s.accountId);assert(account,'장면마다 발신 계정을 선택해 주세요.');assert(Number.isInteger(s.delay)&&s.delay>=(i?60:0)&&s.delay<=86400,'장면 간격은 첫 장면 이후 최소 60초로 정해 주세요.');if(i)due+=s.delay*1000;
        assert(String(s.text||'').trim()&&Array.from(s.text).length<=account.max_chars,'장면 본문 또는 글자 수를 확인해 주세요.');s.visibility=s.visibility||'private';assert(['public','unlisted','private'].includes(s.visibility),'공개 범위를 확인해 주세요.');
        sqls.push(statement(env.DB,'INSERT INTO outbox(id,account_id,body,due,group_id,title) VALUES(?,?,?,?,?,?)',group+':'+String(i).padStart(4,'0'),s.accountId,JSON.stringify({status:s.text,visibility:s.visibility}),due,group,String(b.title||'스토리 진행').slice(0,100)+' '+(i+1)+'장'));
      }
      await env.DB.batch(sqls);return json({ok:true,group});
    });
  }
  if(path==='/api/story/control'&&method==='POST'){
    const b=await readBody(request);assert(['pause','resume','cancel'].includes(b.action),'진행 명령을 확인해 주세요.');return locked(env.DB,async()=>{
      const allowed=await one(env.DB,"SELECT COUNT(*) AS n FROM outbox WHERE group_id=? AND first_attempt IS NULL AND ((?='pause' AND state='pending') OR (?='resume' AND state='held') OR (?='cancel' AND state IN ('pending','held')))",b.group,b.action,b.action,b.action);
      assert(allowed.n>0,'지금 이 동작을 할 수 있는 장면이 없어요. 목록을 새로고침해 주세요.');
      if(b.action==='pause')await run(env.DB,"UPDATE outbox SET state='held' WHERE group_id=? AND state='pending' AND first_attempt IS NULL",b.group);
      if(b.action==='cancel')await run(env.DB,"UPDATE outbox SET state='cancelled' WHERE group_id=? AND state IN ('held','pending') AND first_attempt IS NULL",b.group);
      if(b.action==='resume'){
        const first=await one(env.DB,"SELECT MIN(due) AS due FROM outbox WHERE group_id=? AND state='held'",b.group);const shift=Math.max(0,now()+60000-Number(first?.due||now()));
        await run(env.DB,"UPDATE outbox SET state='pending',due=due+? WHERE group_id=? AND state='held'",shift,b.group);
      }return json({ok:true});
    });
  }
  if(path==='/api/tick'&&method==='POST'){await tick(env,{onlyBots:true});return json({ok:true});}
  if(path==='/api/export'&&method==='GET'){
    const snapshot=await state(env.DB);return json({...snapshot,exportedAt:new Date().toISOString(),jobs:await all(env.DB,'SELECT id,account_id,actor_id,created,state,error FROM jobs ORDER BY created DESC LIMIT 1000'),note:'마스토돈 토큰과 운영 암호는 포함하지 않습니다. 게시 대기열은 요약이며 전체 재해 복구 백업이 아닙니다. 전체 백업은 Cloudflare D1 Export를 사용하세요.'});
  }
  throw err('지원하지 않는 요청이에요.',404);
}
export default {
  async fetch(request,env){
    const u=new URL(request.url);
    try{
      if(u.pathname==='/oauth/callback')return await finishOAuth(request,env);
      if(u.pathname.startsWith('/api/'))return await apiRoute(request,env,u);
      const response=await env.ASSETS.fetch(request),headers=new Headers(response.headers);
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers});
    }catch(e){return json({error:e.status?e.message:'처리하지 못했어요. DB 초기화와 설정을 확인해 주세요.'},e.status||500);}
  },
  async scheduled(_event,env,ctx){ctx.waitUntil(tick(env,{scheduled:true}));}
};
