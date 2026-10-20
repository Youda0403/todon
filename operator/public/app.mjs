import {stateNames,queueReason,groupStatus,storyGroups} from './status.mjs';
import {example,execute,validateRule,numericMap,cleanKey,matches,newId,diceBlock,diceRanges,randomChoices} from './engine.mjs';
const $=(s,root=document)=>root.querySelector(s),$$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=newId;
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const initial=()=>({config:{paused:true,rules:[example('check','practice'),example('dice','practice')],fields:{체력:100,관찰력:0,소지금:0},events:[],invites:{},dailyCap:1500,revision:0},accounts:[{id:'practice',label:'연습 계정',acct:'practice@planet.moe',active:1}],participants:[{id:'practice-runner',name:'연습 러너',acct:'runner@planet.moe',stats:{체력:100,관찰력:0,소지금:0},inventory:{회복약:2},revision:0}],audit:[],outbox:[],runtime:{}});
let S=read('cc.practice.v1',null)||initial(),online=false,secret=sessionStorage.getItem('cc.admin')||'',active=localStorage.getItem('cc.account')||'',selected='',draft=null,dirty=false;
let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),story={title:'첫 번째 이야기',start:new Date(Date.now()+600000),scenes:[]};
let simulation=null,toastTimer,botDetail=false;
const pages=[['home','◷','오늘의 운영'],['bots','▧','자동봇 제작소'],['compose','✎','툿·공지 작성'],['story','▷','스토리 진행실'],['runners','♙','러너 기록부'],['calendar','▦','운영 캘린더'],['accounts','◎','운영 계정'],['settings','⚙','연결·설정']];
const route=()=>location.hash.slice(1).split('?')[0]||'home';
const dateTime=t=>new Date(Number(t)||t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const inputDate=t=>{const d=new Date(t);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const scheduleFields=(id,value,legend='예약 시각 · 한국 시간')=>{const iso=new Date(new Date(value).getTime()+9*3600000).toISOString();return `<fieldset class="schedule-fields"><legend>${legend}</legend><label>날짜<input id="${id}Date" type="date" value="${iso.slice(0,10)}"></label><label>시각<input id="${id}Time" type="time" value="${iso.slice(11,16)}"></label></fieldset>`;};
const readSchedule=id=>{const date=$('#'+id+'Date')?.value,time=$('#'+id+'Time')?.value;if(!date||!time)throw Error('날짜와 시각을 모두 골라 주세요.');const d=new Date(date+'T'+time+':00+09:00');if(!Number.isFinite(d.getTime()))throw Error('예약 시각을 확인해 주세요.');return d;};
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
function action(selector,fn,root=document){for(const element of $$(selector,root))element.addEventListener('click',async e=>{e.preventDefault();if(element.disabled)return;element.disabled=true;element.setAttribute('aria-busy','true');try{await fn(e,element);}catch(error){toast(error.message);}finally{element.removeAttribute('aria-busy');element.disabled=false;}});}
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
  $('#connection').textContent=online?(S.config.paused?'연결됨 · 봇 꺼짐':'연결됨 · 봇 켜짐'):'연습 모드';$('#connection').className='pill'+(online&&S.config.paused?' warn':'');
  $('#activeAccount').innerHTML=accountOptions(activeAccount()?.id);$('#connect').textContent=online?'연결 관리':'서버 연결';
  const app=$('#app');app.innerHTML=(!online?'<div class="notice">지금은 연습 모드예요. 계정에 툿을 보내지 않으며, 연습 데이터는 이 브라우저에만 저장돼요.</div>':'');
  if(online)app.insertAdjacentHTML('beforeend','<div id="executionPanel"></div>');
  ({home:homePage,bots:botsPage,compose:composePage,story:storyPage,runners:runnersPage,calendar:calendarPage,accounts:accountsPage,settings:settingsPage}[current]||homePage)(app);
  executionPanel();
}
function executionPanel(){
  const root=$('#executionPanel');if(!root)return;
  const paused=S.config.paused,last=Number(S.runtime.lastCron||0),stale=!last||Date.now()-last>180000,manage=['home','bots'].includes(route());
  root.innerHTML=`<section class="execution-panel compact-run" aria-label="자동봇 실행 상태"><div class="run-summary"><span class="queue-badge ${paused?'paused':''}">자동봇 ${paused?'꺼짐':'켜짐'}</span><span>공지·스토리는 예약별로 실행</span>${manage?`<button id="panelRun" class="small ${paused?'green':''}">${paused?'자동봇 켜기':'자동봇 끄기'}</button>`:'<a href="#bots" class="text-link">봇 설정</a>'}</div>${manage?`<p>이 스위치는 러너 멘션에 답하는 자동봇만 제어해요. 공지나 스토리 예약은 켜지지 않아요.</p><details><summary>자동 처리 상태</summary><p>마지막 자동 확인: ${last?dateTime(last):'아직 없음'}</p>${stale?'<p>자동 실행 신호가 아직 없거나 3분 이상 지났어요. Cloudflare의 Cron 설정을 확인해 주세요.</p>':''}<button id="processNow" class="small" ${paused?'disabled':''}>봇 멘션만 확인</button>${S.runtime.tickError?`<p class="status-error">${esc(S.runtime.tickError)}</p>`:''}</details>`:''}</section>`;
  action('#panelRun',async()=>{await api('/api/bots/control','POST',{paused:!S.config.paused});await refreshStatus();toast(S.config.paused?'자동봇을 껐어요. 공지·스토리 예약 상태는 그대로예요.':'자동봇을 켰어요. 공지·스토리 예약 상태는 그대로예요.');});
  action('#processNow',async()=>{await api('/api/tick','POST');await refreshStatus();toast('봇 멘션만 확인했어요.');});
}
let statusLoading=false;
async function refreshStatus(){
  if(!online||statusLoading)return;statusLoading=true;
  try{const fresh=await api('/api/state');S.outbox=fresh.outbox;S.stories=fresh.stories;S.runtime=fresh.runtime;S.accounts=fresh.accounts;
    // Keep unsaved forms and configuration intact during background refresh.
    if(!dirty)S.config=fresh.config;else {S.config.paused=fresh.config.paused;S.config.executionVersion=fresh.config.executionVersion;}
    $('#connection').textContent=S.config.paused?'연결됨 · 봇 꺼짐':'연결됨 · 봇 켜짐';$('#connection').className='pill'+(S.config.paused?' warn':'');
    executionPanel();renderQueue();
  }finally{statusLoading=false;}
}
setInterval(()=>{if(online&&!document.hidden&&['story','compose','home','bots'].includes(route()))refreshStatus().catch(()=>{const el=$('#queueUpdated');if(el)el.textContent='상태를 불러오지 못했어요. 새로고침해 주세요.';});},15000);
function renderQueue(){
  const root=$('#storyQueue');if(!root)return;
  const groups=(S.stories||storyGroups(S.outbox)).filter(g=>route()!=='compose'||g.group_id.startsWith('notice-')),live=groups.filter(g=>g.pending||g.held||g.review),past=groups.filter(g=>!g.pending&&!g.held&&!g.review);
  const card=g=>{const rows=S.outbox.filter(o=>o.group_id===g.group_id),next=rows.find(o=>['pending','held','review'].includes(o.state));return `<article class="queue-card"><div class="card-head"><strong><small>${g.group_id.startsWith('notice-')?'공지':'스토리'}</small> ${esc(g.title.replace(/ \d+장$/,''))}</strong><span class="queue-badge ${g.review?'error':g.held?'paused':''}">${groupStatus(g)}</span></div><p>${g.sent}개 전송 · ${g.pending}개 대기 · ${g.held}개 정지 · ${g.cancelled}개 취소${g.review?' · '+g.review+'개 확인 필요':''}</p>${next?`<p class="queue-reason">${esc(queueReason(next,S))}</p><small>다음 예정: ${dateTime(next.due)}</small>`:''}${g.pending||g.held||g.review?`<div class="actions queue-actions"><button data-group="${esc(g.group_id)}" data-check-group class="small" ${g.pending?'':'disabled'}>이 예약만 확인</button><button data-group="${esc(g.group_id)}" data-control="pause" class="small" ${g.pausable?'':'disabled'}>일시정지</button><button data-group="${esc(g.group_id)}" data-control="resume" class="small green" ${g.held?'':'disabled'}>재개</button><button data-group="${esc(g.group_id)}" data-control="cancel" class="small danger" ${g.cancellable?'':'disabled'}>남은 장면 취소</button></div><p class="inline-help">${g.review?'전송 결과가 불확실해요. 운영 계정에서 실제 게시 여부를 먼저 확인해 주세요.':g.held?'재개하면 남은 장면을 약 1분 뒤부터 이어서 예약해요.':g.pending&&!g.pausable?'이미 전송을 시도한 장면은 중복 방지를 위해 여기서 취소하지 않아요.':'지금 가능한 버튼만 진하게 표시해요.'}</p>`:''}</article>`;};
  const historyOpen=$('#queueHistory')?.open,errorsOpen=$('#queueDetails')?.open;
  root.innerHTML=`<div class="card-head"><h2>예약 현황</h2><button id="reloadStory" class="small">새로고침</button></div><small id="queueUpdated" aria-live="polite">15초마다 상태 갱신 · ${new Date().toLocaleTimeString('ko-KR')} 확인</small>${live.map(card).join('')||empty('현재 진행 중인 예약이 없어요.')}<details id="queueHistory" ${historyOpen?'open':''}><summary>완료·취소 기록 (${past.length}건)</summary><p class="inline-help">이미 끝난 기록이에요. 다시 실행되지 않으며, 진행 중인 예약과 분리해서 보관해요.</p>${past.map(card).join('')}</details><details id="queueDetails" ${errorsOpen?'open':''}><summary>장면별 상태와 오류</summary><div class="outbox-list">${S.outbox.map(o=>`<div class="audit-line">${esc(o.title)} · ${esc(stateNames[o.state]||o.state)}<small>${dateTime(o.due)} · ${esc(queueReason(o,S))}</small>${o.last_error?`<p class="status-error">${esc(o.last_error)}</p>`:''}</div>`).join('')}</div></details>`;
  action('#reloadStory',refreshStatus);
  action('[data-check-group]',async(_e,b)=>{await api('/api/group/check','POST',{group:b.dataset.group});await refreshStatus();toast('선택한 예약만 확인했어요. 지정 시각이 된 장면부터 처리해요.');},root);
  action('[data-control]',async(_e,b)=>{if(!online)return;await api('/api/story/control','POST',{group:b.dataset.group,action:b.dataset.control});await refreshStatus();toast({pause:'남은 장면을 일시정지했어요.',resume:'남은 장면을 다시 예약했어요.',cancel:'아직 전송하지 않은 장면을 취소했어요.'}[b.dataset.control]);},root);
}
function homePage(app){
  const today=koreaDay(Date.now()),events=S.config.events.filter(e=>koreaDay(e.at)===today).sort((a,b)=>new Date(a.at)-new Date(b.at));
  const used=Number(S.runtime['used:'+today]||0),enabled=S.config.rules.filter(r=>r.enabled).length;
  app.insertAdjacentHTML('beforeend',heading('YOUR COMMUNITY, IN MOTION','오늘의 운영','이야기를 시작하기 전에, 오늘의 흐름을 살펴봐요.')+`
  <section class="hero"><div><div class="eyebrow">${esc(today.replaceAll('-','.'))} · COMMUNITY JOURNAL</div><h2>오늘도, 우리의 이야기가 이어져요.</h2><p>${events.length?`오늘은 ${events.length}개의 일정이 기다리고 있어요.`:'아직 빈 하루예요. 새로운 일정을 채워볼까요?'}<br>${online?'실행 상태를 확인하고, 준비가 끝나면 봇을 켜 주세요.':'봇을 조립하고 연습한 뒤 실제 운영실에 연결할 수 있어요.'}</p><div class="actions" style="margin-top:20px"><a href="#bots"><button class="primary small">자동봇 만들기 ↗</button></a><a href="#calendar"><button class="small">캘린더 보기</button></a></div></div><div class="hero-stamp"><small>OUR STORY</small><strong>${String(S.participants.length).padStart(2,'0')}</strong><small>${online?'RUNNERS':'PRACTICE'}</small></div></section>
  <div class="stats-grid"><div class="stat-card"><small>반응 설정이 켜진 규칙</small><span class="number">${enabled}<small>/ ${S.config.rules.length}개</small></span></div><div class="stat-card"><small>오늘 처리한 명령</small><span class="number">${used}<small>/ ${S.config.dailyCap}</small></span></div><div class="stat-card"><small>기다리는 출력</small><span class="number">${S.outbox.filter(o=>o.state==='pending').length}<small>개</small></span></div></div>
  <div class="grid"><section class="card"><div class="card-head"><h2>오늘의 타임라인</h2><span class="tag">KST</span></div>${timeline(events)}</section><section class="card"><div class="card-head"><h2>최근 기록</h2><a class="text-link" href="#runners">기록부 ↗</a></div>${S.audit.length?S.audit.slice(0,5).map(a=>`<div class="audit-line">${esc(S.participants.find(p=>p.id===a.actor_id)?.name||'러너')} · ${esc(a.message)}<small>${dateTime(a.created)} · ${esc(a.source)}</small></div>`).join(''):empty('능력치와 물건이 바뀌면 여기에 기록돼요.')}</section></div>
  <p class="inline-help" style="margin-top:17px">마지막 자동 확인: ${S.runtime.lastTick?dateTime(S.runtime.lastTick):'아직 없음'} · 무료 구성은 분 단위로 확인하며, 몰릴 때 답글이 늦어질 수 있어요.</p>`);
}
const blockNames={gather:'조사·채집 결과',recipe:'제작·조합 레시피',reply:'답장 보내기',random:'후보 중 랜덤 선택',roll:'주사위 굴리기',dice:'주사위와 범위별 판정',calculate:'계산 결과 저장',stat:'능력치 더하기·빼기',item:'물건 지급·사용',guard:'조건 확인',status:'현재 능력치 출력',inventory:'현재 가방 출력',history:'최근 기록 출력'};
function simpleRuleKind(rule){
  const types=rule.blocks.map(b=>b.type).join(',');
  if(types==='dice')return 'dice';
  if(types==='roll,reply')return 'oldDice';
  if(['status,inventory','status','inventory','history'].includes(types))return 'record';
  return 'steps';
}
function diceFields(b,index){
  let from=b.count;
  return `<div class="dice-settings" data-dice-index="${index}">
    <div class="card-head"><h3>주사위와 판정표</h3><span class="tag">${esc(b.count)}d${esc(b.sides)}</span></div>
    <div class="form-grid"><label>주사위 몇 개?<input data-dice="count" type="number" min="1" max="20" value="${esc(b.count)}"></label><label>몇 면체?<input data-dice="sides" type="number" min="2" max="1000" value="${esc(b.sides)}"></label></div>
    <p class="inline-help">숫자 구간마다 어떤 결과를 보낼지 적어 주세요. 다음 구간의 시작 숫자는 자동으로 이어져요.</p>
    <div class="dice-range-head" aria-hidden="true"><span>시작</span><span>끝 · 이하</span><span>보낼 결과</span><span></span></div>
    <div class="dice-ranges">${b.ranges.map((r,i)=>{const start=from;from=r.max+1;return `<div class="dice-range" data-range-row="${i}"><span data-range-start>${esc(start)} ~</span><input data-range-max type="number" min="${b.count}" max="${b.count*b.sides}" value="${esc(r.max)}" aria-label="${i+1}번째 구간 끝 숫자" ${i===b.ranges.length-1?'readonly':''}><input data-range-label value="${esc(r.label)}" maxlength="100" aria-label="${i+1}번째 구간 결과"><button class="small" data-delete-range="${index}:${i}" aria-label="${i+1}번째 구간 삭제" ${b.ranges.length===1?'disabled':''}>×</button></div>`;}).join('')}</div>
    <div class="actions"><button class="small" data-add-range="${index}">+ 구간 추가</button><button class="small" data-balance-ranges="${index}">범위 균등하게 나누기</button></div>
    <div class="dice-preview"><small>이렇게 답장해요 · 예시</small><pre data-dice-preview></pre></div>
    <details class="dice-message"><summary>답글 문장 꾸미기</summary><p class="inline-help">아래 버튼을 누르면 이름·숫자·판정이 들어갈 자리를 넣을 수 있어요.</p><div class="actions">${[['{닉네임}','러너 이름'],['{주사위식}','1d100 같은 주사위식'],['{주사위}','굴린 숫자'],['{판정}','성공·실패 결과']].map(([token,label])=>`<button class="small" data-dice-token="${token}">${label}</button>`).join('')}</div><label>답글 문장<textarea data-dice-text rows="3">${esc(b.text)}</textarea></label></details>
  </div>`;
}
function refreshDiceFields(){
  for(const root of $$('.dice-settings')){
    const b=draft.blocks[Number(root.dataset.diceIndex)];let from=b.count;
    for(const row of $$('[data-range-row]',root)){const i=Number(row.dataset.rangeRow);$('[data-range-start]',row).textContent=from+' ~';from=b.ranges[i].max+1;}
    const preview=$('[data-dice-preview]',root);
    try{
      validateRule({...draft,name:'미리보기',keyword:'주사위',blocks:[b]});
      const value=Math.max(b.count,Math.min(18,b.count*b.sides));
      preview.textContent=execute({blocks:[b]},{name:'러너',stats:S.config.fields,inventory:{}},{diceTotal:value}).replies.join('\n');
    }catch(error){preview.textContent=error.message;}
  }
}
function simpleFields(kind){
  if(kind==='steps')return stepsFields();
  if(kind==='dice')return diceFields(draft.blocks[0],0);
  if(kind==='oldDice'){
    const b=draft.blocks[0];
    return `<div class="simple-summary"><h3>주사위 숫자를 답장해요</h3><p>성공·실패도 함께 보내고 싶다면 판정표를 추가해 주세요. 1d100은 25 / 50 / 75 / 100 기준이 미리 채워져요.</p><button id="upgradeDice" class="green">성공·실패 판정 추가</button></div><div class="form-grid legacy-dice"><label>주사위 몇 개?<input data-legacy-dice="count" type="number" min="1" max="20" value="${b.count}"></label><label>몇 면체?<input data-legacy-dice="sides" type="number" min="2" max="1000" value="${b.sides}"></label><label class="span2">답글 문장<textarea data-legacy-reply>${esc(draft.blocks[1].text)}</textarea></label></div>`;
  }
  return `<div class="simple-summary"><h3>${draft.blocks[0].type==='history'?'최근 획득·변경 기록을 답장해요':'러너의 기록을 답장해요'}</h3><p>${draft.blocks.map(b=>({status:'현재 능력치',inventory:'가진 물건',history:'최근 획득·변경 기록'})[b.type]).join(' · ')}을 자동으로 불러와 보내요. 위에서 계정과 키워드만 정하면 돼요.</p></div>`;
}
function stepsFields(){
  return `<p class="inline-help">위에서 아래로 차례대로 실행해요. ‘조건 확인’이 안 맞으면 답장을 보내고 끝내며, 이 명령에서 바꾼 기록은 모두 되돌려요. 여러 조건은 모두 맞아야 해요.</p>${draft.blocks.map((b,i)=>`<section class="block task-step" data-kind="${b.type}" data-index="${i}"><div class="block-head"><span class="tag">${i+1}</span>${blockNames[b.type]}<div class="actions"><button data-move="-1" data-index="${i}" aria-label="${i+1}번째 작업 위로" ${i?'':'disabled'}>↑</button><button data-move="1" data-index="${i}" aria-label="${i+1}번째 작업 아래로" ${i<draft.blocks.length-1?'':'disabled'}>↓</button><button data-remove="${i}" aria-label="${i+1}번째 작업 삭제">×</button></div></div>${blockFields(b)}</section>`).join('')}`;
}
function tokenButtons(field){return `<div class="actions token-buttons">${[...(field==='expression'?[]:[['닉네임','러너 이름'],['결과','직전 결과']]),...Object.keys(S.config.fields).map(k=>[k,k])].map(([key,label])=>`<button class="small" data-insert-token="${esc(key)}" data-token-field="${field}">${esc(label)} 넣기</button>`).join('')}</div>`;}
function resourceFields(b){
  const gather=b.type==='gather',list=gather?b.loot:b.ingredients;
  return `<div class="resource-settings"><p class="inline-help">${gather?'성공한 경우에만 아래 후보 중 한 종류를 획득해요. 러너별 하루 횟수와 재사용 대기시간도 함께 설정해 주세요.':'재료가 모두 있어야 시도해요. 성공하면 재료를 소모하고 완성품을 가방에 기록해요.'}</p><label>성공 확률 · %<input data-field="chance" type="number" min="0" max="100" step="any" value="${b.chance}"></label><h3>${gather?'획득 후보':'필요 재료'}</h3><div class="resource-rows">${list.map((r,i)=>`<div class="resource-row"><label>물건 이름<input data-resource-key value="${esc(r.key)}" maxlength="60"></label><label>${gather?'획득 수량':'필요 수량'}<input data-resource-amount type="number" min="1" max="10000" value="${r.amount}"></label>${gather?`<label>뽑힐 비중<input data-resource-weight type="number" min="0.01" max="10000" step="any" value="${r.weight}"></label>`:''}<button data-resource-remove="${i}" aria-label="${i+1}번째 물건 삭제" ${list.length===1?'disabled':''}>×</button></div>`).join('')}</div><button data-resource-add class="small">+ ${gather?'후보':'재료'} 추가</button>${gather?'<p class="inline-help">비중이 같으면 같은 확률이에요. 획득 수량은 해당 후보가 뽑혔을 때 주는 개수예요.</p>':`<div class="form-grid recipe-output"><label>완성품 이름<input data-field="key" value="${esc(b.key)}"></label><label>완성 수량<input data-field="amount" type="number" min="1" max="10000" value="${b.amount}"></label><label class="span2">실패하면 재료는?<select data-recipe-failure><option value="keep" ${!b.consumeOnFail?'selected':''}>모두 돌려주기</option><option value="consume" ${b.consumeOnFail?'selected':''}>필요 수량만큼 소모하기</option></select></label></div>`}<label>성공할 때 답장<textarea data-field="successText">${esc(b.successText)}</textarea></label><p class="inline-help">{획득물건}은 물건 이름, {획득수량}은 개수로 바뀌어요.</p><label>실패할 때 답장<textarea data-field="failureText">${esc(b.failureText)}</textarea></label></div>`;
}
function blockFields(b){
  if(['gather','recipe'].includes(b.type))return resourceFields(b);
  const label=(text,html)=>`<label>${text}${html}</label>`;
  const input=(field,value,type='text',extra='')=>`<input data-field="${field}" type="${type}" value="${esc(value)}" ${extra}>`;
  if(b.type==='reply')return label('보낼 답장',`<textarea data-field="text">${esc(b.text||'')}</textarea>`)+tokenButtons('text');
  if(b.type==='random'&&!botDetail){let choices;try{choices=randomChoices(b.text);}catch{choices=[{weight:1,text:b.text||''}];}const total=choices.reduce((n,c)=>n+c.weight,0);return `<div class="random-options">${choices.map((c,i)=>`<div class="random-option"><label>후보 ${i+1}<input data-choice-text value="${esc(c.text)}"></label><label>뽑힐 비중<input data-choice-weight type="number" min="0" step="any" value="${c.weight}"></label><small data-choice-chance>${total?Math.round(c.weight/total*100):0}%</small><button data-remove-choice="${i}" aria-label="후보 ${i+1} 삭제" ${choices.length===1?'disabled':''}>×</button></div>`).join('')}</div><button data-add-choice class="small">+ 후보 추가</button><p class="inline-help">비중이 같으면 같은 확률이에요. 30과 70으로 적으면 각각 30%, 70%예요.</p><label class="checkline"><input data-field="emit" type="checkbox" ${b.emit?'checked':''}> 선택한 문장을 바로 답장</label>${b.emit?'':'<p class="inline-help">지금은 결과를 고르기만 해요. 다음 답장에 ‘직전 결과 넣기’를 쓰거나 위 항목을 켜 주세요.</p>'}`;}
  if(b.type==='random')return label('후보 · 한 줄에 하나, 비중 | 문장',`<textarea data-field="text">${esc(b.text||'')}</textarea>`)+`<label class="checkline"><input data-field="emit" type="checkbox" ${b.emit?'checked':''}> 선택한 문장을 바로 답장</label>`;
  if(b.type==='roll')return `<div class="form-grid">${label('주사위 개수',input('count',b.count,'number','min="1" max="20"'))}${label('주사위 면수',input('sides',b.sides,'number','min="2" max="1000"'))}</div>`;
  if(b.type==='dice')return diceFields(b,draft.blocks.indexOf(b));
  if(b.type==='calculate')return `<div class="form-grid">${label('결과를 저장할 능력치',input('key',b.key))}${label('계산식 · + 더하기, - 빼기, * 곱하기, / 나누기',input('expression',b.expression))}</div>${tokenButtons('expression')}<p class="inline-help">버튼으로 능력치를 넣고 숫자와 연산을 이어 주세요. 결과는 지정한 능력치에 저장돼요. 예: {체력} + 5</p>`;
  if(b.type==='stat'||b.type==='item')return `<div class="form-grid">${label(b.type==='stat'?'능력치 이름':'물건 이름',input('key',b.key))}${botDetail?label('변경량 · 줄일 때 음수',input('amount',b.amount,'number')):label('어떻게 바꿀까?',`<select data-change-direction><option value="1" ${b.amount>=0?'selected':''}>${b.type==='item'?'지급':'더하기'}</option><option value="-1" ${b.amount<0?'selected':''}>${b.type==='item'?'사용·회수':'빼기'}</option></select>`)+label(b.type==='item'?'몇 개?':'얼마나?',`<input data-change-amount type="number" min="0" step="${b.type==='item'?'1':'any'}" value="${Math.abs(b.amount)}">`)}</div>`;
  if(b.type==='guard')return `<div class="form-grid">${label('확인할 대상',`<select data-field="target"><option value="stat" ${b.target==='stat'?'selected':''}>능력치</option><option value="item" ${b.target==='item'?'selected':''}>물건 수량</option><option value="result" ${b.target==='result'?'selected':''}>직전 주사위·계산 결과</option></select>`)}${b.target==='result'?'<p class="inline-help">바로 앞에서 굴린 주사위나 계산한 숫자를 비교해요.</p>':label('확인할 이름',input('key',b.key))}${label('비교',`<select data-field="op">${['>=','<=','==','>','<'].map(op=>`<option ${b.op===op?'selected':''} value="${esc(op)}">${({'>=':'이상','<=':'이하','==':'같음','>':'초과','<':'미만'})[op]}</option>`).join('')}</select>`)}${label('기준 숫자',input('amount',b.amount,'number'))}<label class="span2">조건에 맞지 않을 때 답글<textarea data-field="text">${esc(b.text||'조건이 맞지 않아요.')}</textarea></label></div><div class="inline-help">조건에 맞지 않으면 앞 작업의 변경도 취소하고 이 규칙을 끝내요. 실패 답장에 쓴 수치는 조건을 검사한 시점의 값이에요.</div>`;
  return '<p class="inline-help">이 러너의 기록을 읽어서 답글로 출력해요.</p>';
}
function collectDraft(){
  const form=$('#botEditor');if(!form||!draft)return;
  for(const el of $$('[data-rule]',form)){const k=el.dataset.rule;draft[k]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}
  for(const block of $$('.block',form)){const b=draft.blocks[Number(block.dataset.index)];for(const el of $$('[data-field]',block))b[el.dataset.field]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
    if($('.resource-rows',block)){b[b.type==='gather'?'loot':'ingredients']=$$('.resource-row',block).map(r=>({key:$('[data-resource-key]',r).value.trim(),amount:Number($('[data-resource-amount]',r).value),...(b.type==='gather'?{weight:Number($('[data-resource-weight]',r).value)}:{})}));if(b.type==='recipe')b.consumeOnFail=$('[data-recipe-failure]',block).value==='consume';}
    if($('[data-change-amount]',block))b.amount=Number($('[data-change-amount]',block).value)*Number($('[data-change-direction]',block).value);
    if($('.random-options',block))b.text=$$('.random-option',block).map(row=>$('[data-choice-weight]',row).value+' | '+$('[data-choice-text]',row).value).join('\n');}
  for(const root of $$('.dice-settings',form)){
    const b=draft.blocks[Number(root.dataset.diceIndex)];
    for(const el of $$('[data-dice]',root))b[el.dataset.dice]=Number(el.value);
    b.ranges=$$('[data-range-row]',root).map(row=>({max:Number($('[data-range-max]',row).value),label:$('[data-range-label]',row).value}));
    b.text=$('[data-dice-text]',root).value;
  }
  for(const el of $$('[data-legacy-dice]',form))draft.blocks[0][el.dataset.legacyDice]=Number(el.value);
  if($('[data-legacy-reply]',form))draft.blocks[1].text=$('[data-legacy-reply]',form).value;
}
function newRuleModal(){
  modal(`<h2>어떤 봇부터 만들까요?</h2><p>하고 싶은 일을 고르면 필요한 설정이 미리 채워져요.</p><div class="stack">${[['reply','키워드 답장','정해 둔 문장을 답장'],['random','랜덤 답장','후보 문장과 뽑힐 비중만 입력'],['gather','조사·채집','성공 확률과 획득 재료를 설정'],['craft','제작','필요 재료를 소모해서 완성품 만들기'],['combine','조합 시도','조합 확률과 실패 시 재료 처리 설정'],['calculate','능력치 계산','능력치와 숫자로 계산 후 저장'],['dice','주사위·성공 판정','1d100 숫자와 어려운 성공 / 성공 / 실패 / 대실패를 함께 답장'],['check','내 상태·가방 확인','키워드를 받으면 러너의 능력치와 가진 물건을 답장'],['history','최근 획득·변경 기록','러너의 최근 기록을 자동으로 불러와 답장'],['search','확률로 단서를 얻는 조사봇','성공 조건과 획득 물건을 입력'],['item','물건 사용과 체력 회복','소지품 조건과 능력치 변경을 입력']].map(([kind,title,desc])=>`<button class="template-choice" data-template="${kind}"><strong>${title} ↗</strong><small>${desc}</small></button>`).join('')}</div>`);
  action('[data-template]',(_e,b)=>{const r=example(b.dataset.template,activeAccount()?.id||'');S.config.rules.push(r);selected=r.id;draft=structuredClone(r);simulation=null;botDetail=false;dirty=true;close();render();});
}
function botsPage(app){
  if(!selected&&S.config.rules.length)selected=S.config.rules[0].id;
  const current=S.config.rules.find(r=>r.id===selected);if(current&&(!draft||draft.id!==selected))draft=structuredClone(current);
  const kind=draft?simpleRuleKind(draft):'',simple=!!kind&&!botDetail;
  app.insertAdjacentHTML('beforeend',heading('MAKE IT YOURS','자동봇 제작소','하고 싶은 일을 고르고, 계정과 키워드를 정하면 돼요.',`<button id="newRule" class="primary">+ 새 자동봇</button>`)+`
  <div class="bot-layout"><aside class="bot-list">${S.config.rules.map(r=>`<button class="bot-choice ${r.id===selected?'selected':''}" data-pick="${esc(r.id)}"><span class="tag">${r.enabled?'켜짐':'꺼짐'}</span> ${esc(r.name)}<small>${esc(r.keyword)}</small></button>`).join('')}</aside><section class="card">${draft?`
  <div id="botEditor"><div class="card-head bot-editor-head"><h2>${simple?'간단 설정':'세부 편집'}</h2><div class="actions">${kind?`<button id="toggleBotDetail" class="small">${simple?'원본 설정 보기':'간단 설정으로'}</button>`:''}<label class="checkline"><input data-rule="enabled" type="checkbox" ${draft.enabled?'checked':''}> 이 규칙 켜기</label></div></div>
  <div class="form-grid"><label>봇 설정 이름<input data-rule="name" value="${esc(draft.name)}" maxlength="80"></label><label>어느 계정이 답할까?<select data-rule="accountId">${accountOptions(draft.accountId)}</select></label><label class="span2">어떤 말을 받으면 답할까?<input data-rule="keyword" value="${esc(draft.keyword)}" maxlength="100"></label></div>
  <details class="bot-limits"><summary>키워드 인식·횟수·대기시간 설정</summary><div class="form-grid"><label>인식 방식<select data-rule="match"><option value="contains" ${draft.match==='contains'?'selected':''}>문장에 포함되면</option><option value="exact" ${draft.match==='exact'?'selected':''}>명령 전체가 같으면</option></select></label><label>러너 1명당 하루 횟수 · 0은 무제한<input data-rule="dailyLimit" type="number" min="0" max="1000" value="${draft.dailyLimit}"></label><label>재사용 대기시간 · 초<input data-rule="cooldown" type="number" min="0" max="86400" value="${draft.cooldown}"></label></div></details>
  <p class="inline-help">등록한 러너가 발신 계정에 보낸 새 멘션에만 반응해요. 하루는 한국 시간 자정에 바뀌어요.</p>
  ${draft.blocks.some(b=>b.type==='item'&&b.amount>0)&&!draft.blocks.some(b=>['guard','gather','recipe'].includes(b.type))?'<p class="notice">이 규칙은 키워드만 입력해도 물건을 줘요. 조사·채집 또는 제작·조합 조건을 추가하거나, 운영자 지급은 러너 기록부에서 직접 수정해 주세요.</p>':''}<div style="margin-top:22px">${simple?simpleFields(kind):draft.blocks.map((b,i)=>`<section class="block" data-kind="${b.type}" data-index="${i}"><div class="block-head"><span class="tag">${String(i+1).padStart(2,'0')}</span>${blockNames[b.type]}<div class="actions"><button data-move="-1" data-index="${i}" aria-label="위로 이동">↑</button><button data-move="1" data-index="${i}" aria-label="아래로 이동">↓</button><button data-remove="${i}" aria-label="블록 삭제">×</button></div></div>${blockFields(b)}</section>`).join('')}</div>
  ${simple&&kind!=='steps'?'<button id="extendRule" class="add-block">+ 조건이나 다른 작업 함께 설정</button>':'<button id="addBlock" class="add-block">+ 할 일 추가</button>'}<div class="editor-foot"><button id="saveRule" class="primary">규칙 저장</button><button id="copyRule">복제</button><button id="deleteRule" class="danger">삭제</button>${simple?'':`<span class="counter">${draft.blocks.length} / 30 작업</span>`}</div></div>
  <section class="practice"><div class="card-head"><h2>작은 연습창</h2><button id="resetPractice" class="small">기록 초기화</button></div><p class="inline-help">저장 전에도 시험할 수 있어요. 실제 툿과 러너 기록에는 영향을 주지 않아요. 횟수·대기시간은 시험하지 않아요.</p>${draft.blocks.filter(b=>['dice','roll'].includes(b.type)).length===1?`<label class="dice-test-value">시험할 주사위 값 · 비우면 무작위<input id="practiceDice" type="number" min="${draft.blocks.find(b=>['dice','roll'].includes(b.type)).count}" max="${draft.blocks.find(b=>['dice','roll'].includes(b.type)).count*draft.blocks.find(b=>['dice','roll'].includes(b.type)).sides}" placeholder="예: 25, 26, 50, 51"></label>`:''}<div class="row" style="margin-top:12px"><input id="practiceText" aria-label="연습 명령" value="${esc(draft.keyword)}"><button id="practiceRun" class="green">시험하기</button></div><details style="margin-top:12px"><summary>시험할 능력치·물건 설정</summary><p class="inline-help">실제 기록과 별개인 시험용 시작값이에요. 변경 후 다음 시험부터 새로 적용돼요.</p><h3>능력치</h3>${kvEditor(simulation?.stats||S.participants[0]?.stats||S.config.fields,'practiceStats')}<h3>물건</h3>${kvEditor(simulation?.inventory||S.participants[0]?.inventory||{},'practiceItems')}</details><div id="practiceResult" aria-live="polite"></div></section>`:empty('새 자동봇에서 하고 싶은 일을 골라 주세요.')}</section></div>`);
  action('#newRule',newRuleModal);
  action('[data-pick]',(_e,b)=>{if(dirty&&draft&&!confirm('현재 규칙의 저장하지 않은 편집을 버릴까요?'))return;selected=b.dataset.pick;draft=null;simulation=null;botDetail=false;dirty=false;render();});
  for(const el of $$('[data-rule], [data-field], [data-dice], [data-range-max], [data-range-label], [data-dice-text], [data-legacy-dice], [data-legacy-reply], [data-change-amount], [data-change-direction], [data-choice-text], [data-choice-weight], [data-resource-key], [data-resource-amount], [data-resource-weight], [data-recipe-failure]'))el.addEventListener('input',()=>{dirty=true;collectDraft();refreshDiceFields();});
  action('#toggleBotDetail',()=>{collectDraft();botDetail=!botDetail;render();});
  action('#upgradeDice',()=>{collectDraft();draft.blocks=[diceBlock(draft.blocks[0].count,draft.blocks[0].sides)];dirty=true;render();toast('판정표를 추가했어요. 숫자와 결과를 함께 답장해요.');});
  for(const el of $$('[data-dice]'))el.addEventListener('change',()=>{
    try{collectDraft();const b=draft.blocks[Number(el.closest('.dice-settings').dataset.diceIndex)];b.ranges=diceRanges(b.count,b.sides,b.ranges.map(r=>r.label));dirty=true;render();toast('판정표를 새 주사위 범위에 맞췄어요.');}catch(error){toast(error.message);}
  });
  action('[data-balance-ranges]',(_e,button)=>{collectDraft();const b=draft.blocks[Number(button.dataset.balanceRanges)];b.ranges=diceRanges(b.count,b.sides,b.ranges.map(r=>r.label));dirty=true;render();});
  action('[data-add-range]',(_e,button)=>{
    collectDraft();const b=draft.blocks[Number(button.dataset.addRange)];if(b.ranges.length>=20)throw Error('판정 구간은 최대 20개예요.');
    const i=b.ranges.findIndex((r,i)=>r.max-(i?b.ranges[i-1].max:b.count-1)>1);if(i<0)throw Error('더 나눌 수 있는 주사위 값이 없어요.');
    const before=i?b.ranges[i-1].max:b.count-1,r=b.ranges[i];b.ranges.splice(i,1,{max:Math.floor((before+r.max)/2),label:r.label},{max:r.max,label:'새 결과'});dirty=true;render();
  });
  action('[data-delete-range]',(_e,button)=>{collectDraft();const [index,row]=button.dataset.deleteRange.split(':').map(Number),b=draft.blocks[index];if(b.ranges.length<2)return;b.ranges.splice(row,1);b.ranges.at(-1).max=b.count*b.sides;dirty=true;render();});
  action('[data-dice-token]',(_e,button)=>{const text=$('[data-dice-text]',button.closest('.dice-settings'));text.setRangeText(button.dataset.diceToken,text.selectionStart,text.selectionEnd,'end');text.focus();dirty=true;collectDraft();refreshDiceFields();});
  refreshDiceFields();
  action('#extendRule',()=>{collectDraft();botDetail=true;render();$('#addBlock')?.click();});
  action('[data-insert-token]',(_e,b)=>{const root=b.closest('.block'),input=$(`[data-field="${b.dataset.tokenField}"]`,root);const key=b.dataset.insertToken;input.setRangeText('{'+key+'}',input.selectionStart,input.selectionEnd,'end');input.focus();collectDraft();dirty=true;});
  action('[data-resource-add]',(_e,button)=>{collectDraft();const b=draft.blocks[Number(button.closest('.block').dataset.index)],list=b[b.type==='gather'?'loot':'ingredients'];if(list.length>=20)throw Error('최대 20종까지 추가할 수 있어요.');list.push({key:'새 물건 '+(list.length+1),amount:1,...(b.type==='gather'?{weight:1}:{})});dirty=true;render();});
  action('[data-resource-remove]',(_e,button)=>{collectDraft();const b=draft.blocks[Number(button.closest('.block').dataset.index)];b[b.type==='gather'?'loot':'ingredients'].splice(Number(button.dataset.resourceRemove),1);dirty=true;render();});
  action('[data-add-choice]',(_e,b)=>{collectDraft();draft.blocks[Number(b.closest('.block').dataset.index)].text+='\n1 | 새 후보';dirty=true;render();});
  action('[data-remove-choice]',(_e,b)=>{collectDraft();const block=draft.blocks[Number(b.closest('.block').dataset.index)];const choices=randomChoices(block.text);choices.splice(Number(b.dataset.removeChoice),1);block.text=choices.map(c=>c.weight+' | '+c.text).join('\n');dirty=true;render();});
  for(const el of $$('[data-field="target"]'))el.addEventListener('change',()=>{collectDraft();render();});
  for(const el of $$('[data-choice-weight]'))el.addEventListener('input',()=>{const root=el.closest('.random-options'),rows=$$('.random-option',root),total=rows.reduce((n,r)=>n+Number($('[data-choice-weight]',r).value),0);for(const r of rows)$('[data-choice-chance]',r).textContent=(total?Math.round(Number($('[data-choice-weight]',r).value)/total*100):0)+'%';});
  action('[data-move]',(_e,b)=>{collectDraft();const i=Number(b.dataset.index),j=i+Number(b.dataset.move);if(j<0||j>=draft.blocks.length)return;[draft.blocks[i],draft.blocks[j]]=[draft.blocks[j],draft.blocks[i]];dirty=true;render();});
  action('[data-remove]',(_e,b)=>{collectDraft();draft.blocks.splice(Number(b.dataset.remove),1);dirty=true;render();});
  action('#addBlock',()=>{collectDraft();modal(`<h2>어떤 일을 추가할까요?</h2><p>아래에 입력칸이 추가돼요. 위에서 아래로 실행해요.</p><div class="stack">${Object.entries(blockNames).map(([type,name])=>`<button data-block="${type}">${name}</button>`).join('')}</div>`);action('[data-block]',(_e,b)=>{if(draft.blocks.length>=30)throw Error('한 규칙에는 최대 30개 작업을 넣을 수 있어요.');draft.blocks.push(['gather','recipe'].includes(b.dataset.block)?example(b.dataset.block==='recipe'?'craft':'gather').blocks[0]:b.dataset.block==='dice'?diceBlock():{type:b.dataset.block,key:b.dataset.block==='calculate'?'계산값':b.dataset.block==='item'?'열쇠':'체력',amount:1,text:b.dataset.block==='guard'?'조건이 맞지 않아요.':b.dataset.block==='random'?'1 | 첫 번째 문장\n1 | 두 번째 문장':'{닉네임}, 반가워요.',emit:b.dataset.block==='random',count:1,sides:100,target:'stat',op:'>=',expression:'{체력} + 5'});dirty=true;botDetail=false;close();render();});});
  action('#saveRule',async()=>{collectDraft();validateRule(draft);const i=S.config.rules.findIndex(r=>r.id===draft.id);S.config.rules[i]=structuredClone(draft);await saveConfig();render();});
  action('#copyRule',async()=>{collectDraft();const r={...structuredClone(draft),id:uid(),name:draft.name+' 복사',enabled:false};S.config.rules.push(r);selected=r.id;draft=r;dirty=true;render();});
  action('#deleteRule',async()=>{S.config.rules=S.config.rules.filter(r=>r.id!==selected);await saveConfig();draft=null;selected='';render();});
  kvBindings();
  action('#practiceRun',()=>{collectDraft();validateRule(draft);const text=$('#practiceText').value;const target=$('#practiceResult');if(!matches(draft,text)){target.innerHTML='<div class="chat"><div class="bubble">키워드가 맞지 않아 반응하지 않아요.</div></div>';return;}simulation={name:'연습 러너',stats:kvRead('practiceStats'),inventory:kvRead('practiceItems')};if(Object.values(simulation.inventory).some(v=>v<0||!Number.isInteger(v)))throw Error('시험용 물건 수량은 0 이상의 정수로 적어 주세요.');const value=$('#practiceDice')?.value;const result=execute(draft,simulation,{...(value?{diceTotal:Number(value)}:{}),history:S.audit.filter(a=>a.actor_id===S.participants[0]?.id)});simulation={...simulation,stats:result.stats,inventory:result.inventory};target.innerHTML=`<div class="chat"><div class="bubble me">${esc(text)}</div>${result.replies.map(r=>`<div class="bubble">${esc(r)}</div>`).join('')}${!result.replies.length?`<div class="bubble">${result.rejected?'조건이 맞지 않아 멈췄어요. 실패 답장을 설정하면 안내할 수 있어요.':result.changes.length?'답장 없이 기록만 변경했어요.':'답장이나 기록 변경이 없어요. 답장 작업을 추가해 주세요.'}</div>`:''}<small>${esc(result.changes.join(' / ')||'기록 변경 없음')}</small><details open><summary>어떻게 처리됐나요?</summary>${(result.trace||[]).map(t=>`<p>${esc(t)}</p>`).join('')}<p>시험 후 능력치: ${esc(JSON.stringify(result.stats))}</p><p>시험 후 물건: ${esc(JSON.stringify(result.inventory))}</p><p>다시 시험하면 위 시험용 시작값부터 실행해요.</p></details></div>`;});
  action('#resetPractice',()=>{simulation=null;render();toast('시험용 시작값을 초기화했어요.');});
}
function sceneCollect(){
  if($('#storyTitle'))story.title=$('#storyTitle').value;
  if($('#storyStartDate')?.value&&$('#storyStartTime')?.value)story.start=readSchedule('storyStart');
  for(const scene of $$('[data-scene]')){const s=story.scenes[Number(scene.dataset.scene)];for(const el of $$('[data-scene-field]',scene))s[el.dataset.sceneField]=el.type==='number'?Number(el.value):el.value;}
}
function storyPage(app){
    app.insertAdjacentHTML('beforeend',heading('LET THE SCENE UNFOLD','스토리 진행실','계정과 대본을 정하고, 차례대로 이야기를 내보내요.',`<button id="addScene" class="primary">+ 장면 추가</button>`)+`
  <div class="notice">이 버전은 약 1분 단위로 예약을 확인해요. 초 단위 정시 출력은 보장하지 않으며, 앞 장면 전송에 문제가 생기면 뒤 장면도 기다려요. 이 대본을 예약하면 지정 시각부터 자동으로 진행돼요. 다른 대본이나 자동봇의 스위치는 바뀌지 않아요.</div>
  <div class="grid"><section><div class="card" style="margin-bottom:18px"><div class="form-grid"><label>대본 이름<input id="storyTitle" value="${esc(story.title)}"></label>${scheduleFields('storyStart',story.start,'첫 장면 시각 · 한국 시간')}</div></div>
  <div id="scenes">${story.scenes.length?story.scenes.map((s,i)=>`<div class="scene" data-scene="${i}"><span class="scene-number">${i+1}</span><div class="card"><div class="form-grid"><label>발신 계정<select data-scene-field="accountId">${accountOptions(s.accountId)}</select></label><label>${i?'앞 장면과의 간격 · 초':'첫 장면은 시작 시각에 출력'}<input data-scene-field="delay" type="number" value="${s.delay}" min="${i?60:0}" step="60" ${i?'':'disabled'}></label><label class="span2">대본<textarea data-scene-field="text" placeholder="이 장면에 출력할 내용을 적어 주세요.">${esc(s.text)}</textarea></label><label>공개 범위<select data-scene-field="visibility">${[['private','팔로워 전용'],['unlisted','미등재'],['public','공개']].map(([v,t])=>`<option value="${v}" ${s.visibility===v?'selected':''}>${t}</option>`).join('')}</select></label><div class="actions"><button data-scene-up="${i}" class="small">↑</button><button data-scene-delete="${i}" class="small danger">삭제</button></div></div></div></div>`).join(''):empty('장면을 추가해서 대본을 작성해 주세요.')}</div>
  <div class="actions"><button id="storyPreview">전체 미리보기</button><button id="storySchedule" class="green" ${story.scenes.length?'':'disabled'}>이 대본 예약 등록</button><button id="storyDownload" class="small">대본 파일 저장</button></div></section>
  <section class="card" id="storyQueue"></section></div>`);
  renderQueue();
  for(const el of $$('[data-scene-field],#storyTitle,#storyStartDate,#storyStartTime'))el.addEventListener('change',sceneCollect);
  action('#addScene',()=>{sceneCollect();if(story.scenes.length>=30)throw Error('한 대본은 최대 30장면이에요.');story.scenes.push({accountId:activeAccount()?.id||'',delay:story.scenes.length?60:0,text:'',visibility:'private'});render();});
  action('[data-scene-up]',(_e,b)=>{sceneCollect();const i=Number(b.dataset.sceneUp);if(i)[story.scenes[i],story.scenes[i-1]]=[story.scenes[i-1],story.scenes[i]];render();});
  action('[data-scene-delete]',(_e,b)=>{sceneCollect();story.scenes.splice(Number(b.dataset.sceneDelete),1);render();});
  action('#storyPreview',()=>{sceneCollect();let t=new Date(story.start).getTime();modal(`<h2>${esc(story.title)}</h2><p>한국 시간 기준 예상 시각이에요. 실제 전송은 늦어질 수 있어요.</p>${story.scenes.map((s,i)=>{if(i)t+=s.delay*1000;return `<div class="chat"><small>${dateTime(t)} · ${esc(S.accounts.find(a=>a.id===s.accountId)?.label||'계정 미지정')}</small><div class="bubble">${esc(s.text)}</div></div>`;}).join('')||empty('장면이 없어요.')}`);});
  action('#storySchedule',async()=>{sceneCollect();if(!online)throw Error('실제 대본 예약은 서버 연결 후 사용할 수 있어요. 미리보기로 먼저 확인해 주세요.');const result=await api('/api/story','POST',{...story,start:new Date(story.start).toISOString()});await reload();toast('이 대본을 예약했어요. 지정 시각부터 분 단위로 확인해 차례대로 보내요.');});
  action('#storyDownload',()=>{sceneCollect();download('curtain-call-story.json',story);});
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
  const d=date?new Date(date+'T21:00:00+09:00'):new Date();
  modal(`<h2>운영 일정 등록</h2><p>오늘의 운영 화면과 캘린더에 표시해요. 이 버전의 일정 알림은 앱을 열었을 때 표시되며, 푸시 알림은 아직 제공하지 않아요.</p><div class="stack"><label>일정 이름<input id="eventTitle" placeholder="예: 도서관 조사 개방" maxlength="120"></label>${scheduleFields('eventAt',d,'일정 시작 · 한국 시간')}<label>운영 메모<textarea id="eventNote" placeholder="준비물, 진행 담당, 대본 이름 등을 적어 주세요."></textarea></label><button id="saveEvent" class="primary">일정 저장</button></div>`);
  action('#saveEvent',async()=>{const title=$('#eventTitle').value.trim();if(!title)throw Error('일정 이름을 적어 주세요.');const at=readSchedule('eventAt').toISOString();S.config.events.push({id:uid(),title,at,note:$('#eventNote').value});await saveConfig();close();render();});
}
function calendarPage(app){
  const year=month.getFullYear(),m=month.getMonth(),first=new Date(year,m,1).getDay(),last=new Date(year,m+1,0).getDate(),cells=[];
  for(let i=0;i<first;i++)cells.push('<td class="blank"></td>');
  for(let d=1;d<=last;d++){const date=`${year}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,events=S.config.events.filter(e=>koreaDay(e.at)===date);cells.push(`<td class="${date===koreaDay(Date.now())?'today':''}" data-date="${date}" tabindex="0" role="button" aria-label="${date} 일정 등록"><span>${d}</span>${events.slice(0,3).map(e=>`<span class="event-dot">${esc(e.title)}</span>`).join('')}${events.length>3?`<small>+${events.length-3}</small>`:''}</td>`);}
  while(cells.length%7)cells.push('<td class="blank"></td>');
  const upcoming=S.config.events.filter(e=>new Date(e.at).getFullYear()===year&&new Date(e.at).getMonth()===m).sort((a,b)=>new Date(a.at)-new Date(b.at));
  app.insertAdjacentHTML('beforeend',heading('A PLACE FOR EVERY DAY','운영 캘린더','개장부터 엔딩까지, 놓치지 않도록 기록해 둬요.',`<button id="newEvent" class="primary">+ 일정 등록</button>`)+`
  <div class="card calendar-wrap"><div class="calendar-heading"><button id="prevMonth" class="small" aria-label="이전 달">←</button><h2 class="month-title"><span>${year}년</span> <strong>${m+1}월</strong></h2><button id="nextMonth" class="small" aria-label="다음 달">→</button></div><button id="thisMonth" class="small calendar-today">이번 달</button><table class="calendar"><thead><tr>${['일','월','화','수','목','금','토'].map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>${Array.from({length:cells.length/7},(_,i)=>'<tr>'+cells.slice(i*7,i*7+7).join('')+'</tr>').join('')}</tbody></table></div>
  <section class="card" style="margin-top:20px"><div class="card-head"><h2>이번 달 일정</h2><small>표시는 한국 시간 기준</small></div>${upcoming.map(e=>`<div class="timeline-item"><span class="time-label">${new Date(e.at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'})}</span><div style="flex:1"><div class="event-name">${esc(e.title)}</div><div class="event-desc">${dateTime(e.at)} · ${esc(e.note||'')}</div></div><button data-delete-event="${esc(e.id)}" class="small danger">삭제</button></div>`).join('')||empty('이번 달에 등록한 일정이 없어요.')}</section>`);
  action('#newEvent',()=>eventModal());action('[data-date]',(_e,b)=>eventModal(b.dataset.date));
  for(const td of $$('[data-date]'))td.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();eventModal(td.dataset.date);}};
  action('#prevMonth',()=>{month=new Date(year,m-1,1);render();});action('#nextMonth',()=>{month=new Date(year,m+1,1);render();});action('#thisMonth',()=>{month=new Date(new Date().getFullYear(),new Date().getMonth(),1);render();});
  action('[data-delete-event]',async(_e,b)=>{S.config.events=S.config.events.filter(e=>e.id!==b.dataset.deleteEvent);await saveConfig();render();});
}
function accountsPage(app){
  app.insertAdjacentHTML('beforeend',heading('ONE ROOM, MANY VOICES','운영 계정','총괄·공지·NPC 계정을 연결하고 편하게 바꿔요.',`<button id="loginMastodon" class="primary">+ planet.moe 계정 연결</button>`)+`
  <div class="notice">초대 링크는 planet.moe의 사람 초대 화면에서 만든 뒤 한 번 등록해 주세요. 이후에는 복사 버튼 한 번으로 나눠줄 수 있어요.</div>
  <div class="grid">${S.accounts.map(a=>`<section class="card account-card" data-account-card="${esc(a.id)}"><div class="row"><span class="avatar-letter">${esc(Array.from(a.label)[0])}</span><div style="flex:1"><label>운영실에서 부를 별명<input data-account-label value="${esc(a.label)}" maxlength="80"></label><small>@${esc(a.acct)}</small></div><span class="tag">${a.active?'봇 멘션 확인 켜짐':'봇 멘션 확인 꺼짐'}</span></div><div class="actions"><button data-select-account="${esc(a.id)}" class="small">이 계정으로 전환</button><button data-save-account="${esc(a.id)}" class="small">별명 저장</button><button data-toggle-account="${esc(a.id)}" class="small">봇 멘션 확인 ${a.active?'끄기':'켜기'}</button></div>${a.error?`<p class="status-error">${esc(a.error)}</p>`:''}<label style="margin-top:18px">나눠줄 초대 링크<input type="url" data-invite value="${esc(S.config.invites[a.id]||'')}" placeholder="https://planet.moe/invite/..."></label><div class="actions"><button data-save-invite="${esc(a.id)}" class="small">링크 저장</button><button data-copy-invite="${esc(a.id)}" class="small green">초대 링크 복사</button><a class="text-link" href="https://planet.moe/invites" target="_blank" rel="noopener noreferrer">초대 관리 ↗</a></div></section>`).join('')}</div>${S.accounts.length?'':empty('계정 연결 버튼으로 로그인해 주세요. 비밀번호는 planet.moe 화면에서만 입력해요.')}
  <p class="notice">툿과 공지는 <a href="#compose" class="text-link">툿·공지 작성</a>에서 지금 보내거나 시각을 지정해 예약해요.</p>`);
  action('#loginMastodon',async()=>{if(!online)throw Error('먼저 Cloudflare 서버에 연결해 주세요.');const {url}=await api('/api/oauth/start','POST');location.assign(url);});
  action('[data-select-account]',(_e,b)=>{active=b.dataset.selectAccount;localStorage.setItem('cc.account',active);render();toast('기본 발신 계정을 바꿨어요.');});
  async function updateAccount(a){if(online)await api('/api/account','PUT',a);else persist();}
  action('[data-save-account]',async(_e,b)=>{const a=S.accounts.find(a=>a.id===b.dataset.saveAccount);a.label=$('[data-account-label]',b.closest('[data-account-card]')).value;await updateAccount(a);render();toast('계정 별명을 저장했어요.');});
  action('[data-toggle-account]',async(_e,b)=>{const a=S.accounts.find(a=>a.id===b.dataset.toggleAccount);a.active=a.active?0:1;await updateAccount(a);render();});
  action('[data-save-invite]',async(_e,b)=>{const url=$('[data-invite]',b.closest('[data-account-card]')).value.trim();if(url){const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('https 초대 주소를 입력해 주세요.');}if(url)S.config.invites[b.dataset.saveInvite]=url;else delete S.config.invites[b.dataset.saveInvite];await saveConfig();});
  action('[data-copy-invite]',async(_e,b)=>{const url=S.config.invites[b.dataset.copyInvite];if(!url)throw Error('초대 링크를 먼저 저장해 주세요.');await navigator.clipboard.writeText(url);toast('초대 링크를 복사했어요.');});

}
let noticeDraft={text:'',accountId:'',visibility:'private',mode:'now',at:new Date(Date.now()+600000)},noticeAttempt=null;
function collectNotice(){if(!$('#noticeText'))return;noticeDraft.text=$('#noticeText').value;noticeDraft.accountId=$('#noticeAccount').value;noticeDraft.visibility=$('#noticeVisibility').value;noticeDraft.mode=$('#noticeMode').value;if($('#noticeAtDate')?.value&&$('#noticeAtTime')?.value)noticeDraft.at=readSchedule('noticeAt');}
function composePage(app){
  noticeDraft.accountId ||= activeAccount()?.id||'';
  app.insertAdjacentHTML('beforeend',heading('OPERATOR WORKSPACE','툿·공지 작성','계정과 공개 범위를 확인하고, 지금 보내거나 시각을 정해 예약해요.')+`<div class="operator-workspace"><section class="card"><div class="form-grid"><label>발신 계정<select id="noticeAccount">${accountOptions(noticeDraft.accountId)}</select></label><label>공개 범위<select id="noticeVisibility">${[['private','팔로워 전용'],['unlisted','미등재'],['public','공개']].map(([v,t])=>`<option value="${v}" ${noticeDraft.visibility===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="span2">본문<textarea id="noticeText" rows="7" placeholder="이 계정으로 올릴 툿이나 공지를 적어 주세요.">${esc(noticeDraft.text)}</textarea></label><label class="span2">언제 보낼까?<select id="noticeMode"><option value="now" ${noticeDraft.mode==='now'?'selected':''}>지금 보내기</option><option value="scheduled" ${noticeDraft.mode==='scheduled'?'selected':''}>날짜·시각 지정</option></select></label><div id="noticeTime" class="span2" ${noticeDraft.mode==='now'?'hidden':''}>${scheduleFields('noticeAt',noticeDraft.at)}</div></div><p id="noticeTiming" class="notice timing-copy">${noticeDraft.mode==='now'?'버튼을 누르면 이 글 하나를 바로 전송 요청해요.':'선택한 시각 이후 첫 자동 확인 때 보내요. 보통 1분 안팎의 차이가 있고, 오류나 혼잡 시 더 늦어질 수 있어요.'}</p><button id="sendNotice" class="primary">${noticeDraft.mode==='now'?'지금 이 글 보내기':'이 시각에 예약하기'}</button><p class="inline-help">이 버튼은 다른 공지·스토리나 자동봇을 켜지 않아요.</p><p id="noticeResult" role="status"></p></section><aside class="card runner-review"><h2>러너 검토</h2><p class="inline-help">작성 중에도 러너의 능력치와 소지품을 열어볼 수 있어요.</p><input id="reviewSearch" placeholder="러너 이름·아이디 검색" aria-label="검토할 러너 검색"><div class="review-list">${S.participants.map(p=>`<button data-review-runner="${esc(p.id)}" data-search="${esc((p.name+' '+p.acct).toLowerCase())}"><strong>${esc(p.name)}</strong><small>@${esc(p.acct)}</small><span>${esc(Object.entries(p.stats).slice(0,3).map(([k,v])=>k+' '+v).join(' · '))}</span></button>`).join('')||empty('러너 기록부에서 러너를 등록해 주세요.')}</div></aside></div><section class="card composer-queue" id="storyQueue"></section>`);
  renderQueue();
  for(const el of $$('#noticeText,#noticeAccount,#noticeVisibility,#noticeAtDate,#noticeAtTime'))el.addEventListener('input',collectNotice);
  $('#noticeMode').onchange=()=>{collectNotice();$('#noticeTime').hidden=noticeDraft.mode==='now';$('#sendNotice').textContent=noticeDraft.mode==='now'?'지금 이 글 보내기':'이 시각에 예약하기';$('#noticeTiming').textContent=noticeDraft.mode==='now'?'버튼을 누르면 이 글 하나를 바로 전송 요청해요.':'선택한 시각 이후 첫 자동 확인 때 보내요. 보통 1분 안팎의 차이가 있고, 오류나 혼잡 시 더 늦어질 수 있어요.';};
  $('#reviewSearch').oninput=e=>{for(const b of $$('[data-review-runner]'))b.hidden=!b.dataset.search.includes(e.target.value.toLowerCase());};
  action('[data-review-runner]',(_e,b)=>{collectNotice();runnerModal(S.participants.find(p=>p.id===b.dataset.reviewRunner));});
  action('#sendNotice',async()=>{
    collectNotice();if(!online)throw Error('실제 글 전송은 서버 연결 후 사용할 수 있어요.');if(!noticeDraft.text.trim())throw Error('보낼 본문을 적어 주세요.');
    const data={accountId:noticeDraft.accountId,text:noticeDraft.text,visibility:noticeDraft.visibility,...(noticeDraft.mode==='scheduled'?{at:noticeDraft.at.toISOString()}: {})},signature=JSON.stringify(data);
    if(!noticeAttempt||noticeAttempt.signature!==signature)noticeAttempt={signature,id:uid()};
    const result=await api('/api/announcement','POST',{...data,requestId:noticeAttempt.id});
    noticeDraft.text='';$('#noticeText').value='';noticeAttempt=null;
    $('#noticeResult').textContent=result.state==='sent'?'전송 완료. 선택한 계정에 게시했어요.':result.state==='review'?'게시 여부 확인이 필요해요. 아래 예약 현황을 확인해 주세요.':data.at?dateTime(result.due)+'부터 전송하도록 예약했어요.':'전송을 완료하지 못해 대기열에 보관했어요. 아래 오류와 재시도 시각을 확인해 주세요.';
    await refreshStatus();
  });
}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function settingsPage(app){
  app.insertAdjacentHTML('beforeend',heading('A LITTLE PREPARATION','연결·설정','무료 실행 환경을 연결하고, 커뮤에 맞는 기본값을 정해요.')+`
  <div class="grid"><section class="card"><div class="card-head"><h2>운영실 연결</h2><span class="tag">${online?'연결됨':'연습 중'}</span></div><p>Cloudflare Workers + D1 무료 요금제를 사용하는 구성입니다. 브라우저를 닫아도 Cloudflare가 새 멘션을 확인해요.</p><div class="actions" style="margin-top:17px"><button id="settingsConnect" class="primary">운영 암호로 연결</button><button id="logoutServer">이 기기 연결 해제</button><a class="text-link" href="https://dash.cloudflare.com/" target="_blank" rel="noopener">Cloudflare 열기 ↗</a></div><p class="inline-help">운영 암호를 바꾸면 저장된 계정 토큰을 읽을 수 없게 되어 계정을 다시 연결해야 해요.</p></section>
  <section class="card"><div class="card-head"><h2>하루 처리 상한</h2><span class="tag">무료 사용량 관리</span></div><label>전체 러너의 명령 합계 · 한국 시간 기준<input id="dailyCap" type="number" min="1" max="5000" value="${S.config.dailyCap}"></label><p class="inline-help">상한에 도달하면 새 명령은 대기해요. 재사용 대기 중인 명령은 합계에서 제외돼요. 이 숫자는 Cloudflare의 실제 사용량과 같지 않아요.</p><button id="saveCap" class="small" style="margin-top:13px">상한 저장</button></section>
  <section class="card"><div class="card-head"><h2>새 러너의 기본 능력치</h2></div>${kvEditor(S.config.fields,'defaults')}<div class="actions" style="margin-top:15px"><button id="saveFields" class="primary small">기본값 저장</button></div><p class="inline-help">새로 등록하는 러너에게 적용해요. 이미 등록한 러너는 기록부에서 수정해 주세요.</p></section>
  <section class="card"><div class="card-head"><h2>기록 파일과 확인</h2></div><p>능력치·소지품·설정과 최근 기록을 JSON으로 내려받아요. 계정 토큰과 운영 암호는 포함하지 않아요.</p><div class="actions" style="margin-top:17px"><button id="exportRecords" class="primary small">기록 파일 내려받기</button><button id="manualTick" class="small">봇 멘션만 확인</button></div><p class="inline-help">이 파일은 최근 기록 중심의 보조 내보내기예요. 전체 복구용 백업은 Cloudflare D1의 Export 기능을 사용해 주세요.</p><details style="margin-top:17px"><summary>현재 버전에서 알아둘 점</summary><ul><li>일정은 앱을 열면 표시해요. 브라우저 푸시는 아직 지원하지 않아요.</li><li>스토리는 분 단위 예약이며, 30초 간격 진행을 보장하지 않아요.</li><li>‘확인 필요’ 출력은 중복 방지를 위해 자동으로 다시 보내지 않아요. 계정에서 실제 게시 여부를 확인해 주세요.</li><li>첫 연결 이전의 멘션은 처리하지 않아요. 등록한 러너의 새 멘션부터 처리해요.</li><li>서버 전체를 운영하는 관리 기능이나 초대 링크 자동 생성은 포함하지 않아요.</li></ul></details></section></div>`);
  action('#settingsConnect',connect);kvBindings();
  action('#logoutServer',()=>{sessionStorage.removeItem('cc.admin');secret='';online=false;S=read('cc.practice.v1',null)||initial();draft=null;selected='';render();toast('이 기기의 연결을 해제했어요. 서버의 봇 실행은 계속될 수 있어요.');});
  action('#saveCap',async()=>{S.config.dailyCap=Number($('#dailyCap').value);await saveConfig();});
  action('#saveFields',async()=>{S.config.fields=kvRead('defaults');await saveConfig();});
  action('#exportRecords',async()=>download('curtain-call-records-'+koreaDay(Date.now())+'.json',online?await api('/api/export'):S));
  action('#manualTick',async()=>{if(!online)throw Error('실제 서버 연결 후 사용할 수 있어요.');await api('/api/tick','POST');await reload();toast('자동봇 멘션만 확인했어요. 봇이 꺼져 있으면 처리하지 않아요.');});
}
render();
if(secret)reload().catch(e=>{toast(e.message);});
