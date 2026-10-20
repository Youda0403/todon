// Shared, testable descriptions of the queue. No credentials or network calls.
export const stateNames={pending:'예약 대기',held:'일시정지',sent:'전송 완료',review:'게시 여부 확인 필요',cancelled:'취소 완료'};
export function queueReason(row,state,time=Date.now()){
  if(row.state!=='pending')return stateNames[row.state]||row.state;
  if(state.config.paused)return '전체 일시정지 중 · 전체 실행을 눌러 주세요';
  const a=state.accounts.find(a=>a.id===row.account_id);
  if(!a)return '발신 계정 연결이 필요해요';
  if(!a.active)return '발신 계정의 자동 확인이 꺼져 있어요 · 운영 계정에서 켜 주세요';
  if(row.last_error)return '재시도 대기 · '+row.last_error;
  const earlier=state.outbox.find(o=>o.group_id===row.group_id&&row.group_id&&!['sent','cancelled'].includes(o.state)&&o.id<row.id);
  if(earlier)return '앞 장면이 끝나기를 기다리고 있어요';
  if(row.due>time)return '예약 시각을 기다리고 있어요';
  const last=Number(state.runtime.lastCron||0);
  if(!last||time-last>180000)return '예약 시각이 됐지만 자동 실행 신호가 없어요 · 지금 확인을 눌러 주세요';
  return '예약 시각 도착 · 다음 처리 차례를 기다리고 있어요';
}
export function groupStatus(g){
  if(g.review)return '확인 필요';
  if(g.held)return g.pending?'일부 일시정지':'일시정지';
  if(g.pending)return '예약 중';
  return g.cancelled===g.total?'취소 완료':g.cancelled?'종료 · 일부 취소':'전송 완료';
}
export function storyGroups(rows){
  const groups=new Map();
  for(const o of rows){if(!o.group_id)continue;let g=groups.get(o.group_id);if(!g){g={group_id:o.group_id,title:o.title,due:o.due,total:0,pending:0,held:0,sent:0,cancelled:0,review:0,pausable:0,cancellable:0};groups.set(o.group_id,g);}g.total++;g[o.state]=(g[o.state]||0)+1;g.due=Math.min(g.due,o.due);if(!o.first_attempt){if(o.state==='pending')g.pausable++;if(['pending','held'].includes(o.state))g.cancellable++;}}
  return [...groups.values()];
}
