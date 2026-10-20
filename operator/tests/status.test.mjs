import test from 'node:test';
import assert from 'node:assert/strict';
import {queueReason,storyGroups,groupStatus} from '../public/status.mjs';
test('queue explains each blocker and groups cancelled work separately from live controls',()=>{
  const time=1000000,row={id:'g:0001',group_id:'g',title:'공지 1장',account_id:'bot',state:'pending',due:time-1,first_attempt:null};
  const s={config:{paused:true},accounts:[{id:'bot',active:1}],runtime:{lastCron:String(time)},outbox:[row]};
  assert.match(queueReason(row,s,time),/전체 일시정지/);s.config.paused=false;s.accounts[0].active=0;assert.match(queueReason(row,s,time),/꺼져/);s.accounts[0].active=1;
  assert.match(queueReason({...row,due:time+1},s,time),/예약 시각을/);assert.match(queueReason(row,s,time),/다음 처리/);s.runtime={};assert.match(queueReason(row,s,time),/신호가 없/);
  s.outbox.push({...row,id:'g:0000',due:time+999999});assert.match(queueReason(row,s,time),/앞 장면/);
  const g=storyGroups([{...row,state:'cancelled'},{...row,id:'g:0002',state:'cancelled'}])[0];assert.equal(groupStatus(g),'취소 완료');assert.equal(g.cancellable,0);assert.equal(g.pausable,0);
});
