import test from 'node:test';
import assert from 'node:assert/strict';
import {example,validateRule,advanceDialogue,selectBotRule} from '../public/engine.mjs';
const actor=()=>({name:'러너',stats:{체력:50},inventory:{}});
const move=(r,p,text)=>{const out=advanceDialogue(r,p.actor,text,p.session);return {actor:{...p.actor,stats:out.stats,inventory:out.inventory},session:out.session,out};};
test('investigation follows only the current scene, accepts natural keywords and numbers, and keeps runners separate',()=>{
  const r=example('dialogue');validateRule(r);
  let a={actor:actor(),session:null},b={actor:actor(),session:null};
  a=move(r,a,'조사를 시작한다.');b=move(r,b,'조사를 시작한다.');
  assert.equal(a.session.sceneId,'start');assert.equal(a.out.started,true);assert.match(a.out.replies.join('\n'),/1\. 숲/);
  a=move(r,a,'벌집');assert.equal(a.session.sceneId,'start');assert.match(a.out.replies[0],/선택지/);
  a=move(r,a,'숲과 동굴');assert.equal(a.session.sceneId,'start');assert.match(a.out.replies[0],/여러 선택지/);
  a=move(r,a,'숲으로 갑니다.');assert.equal(a.session.sceneId,'forest');assert.equal(a.out.started,false);
  b=move(r,b,'3번');assert.equal(b.session.sceneId,'sea');assert.equal(b.session.status,'ended');assert.equal(a.session.sceneId,'forest');
  a=move(r,a,'풀숲을 살펴봅니다.');assert.equal(a.session.sceneId,'grass');assert.equal(a.actor.inventory.약초,1);assert.equal(b.actor.inventory.약초,undefined);
  a=move(r,a,'풀숲');assert.equal(a.actor.inventory.약초,1);assert.equal(a.out.started,false);
});
test('stop, resume, repeating start and revisiting a scene cannot repeat its effects',()=>{
  const r=example('dialogue');r.dialogue.scenes.find(s=>s.id==='forest').actions=[{type:'item',key:'지도',amount:1}];
  const tree=r.dialogue.scenes.find(s=>s.id==='tree');tree.end=false;tree.choices=[{keyword:'돌아가기',next:'forest'}];validateRule(r);
  let p={actor:actor(),session:null};
  for(const text of [r.keyword,'숲',r.dialogue.stopKeyword])p=move(r,p,text);
  assert.equal(p.session.status,'paused');assert.equal(p.actor.inventory.지도,1);
  p=move(r,p,'나무');assert.equal(p.session.status,'paused');assert.equal(p.session.sceneId,'forest');
  p=move(r,p,r.keyword);assert.equal(p.session.status,'paused');assert.equal(p.out.started,false);
  p=move(r,p,r.dialogue.resumeKeyword);assert.equal(p.session.status,'active');assert.equal(p.actor.inventory.지도,1);
  for(const text of ['나무','돌아가기',r.dialogue.resumeKeyword,r.keyword])p=move(r,p,text);
  assert.equal(p.actor.inventory.지도,1);assert.equal(p.session.sceneId,'forest');
  p=move(r,p,r.dialogue.endKeyword);assert.equal(p.session.status,'ended');
  p=move(r,p,r.keyword);assert.equal(p.out.started,true);p=move(r,p,'숲');assert.equal(p.actor.inventory.지도,2);
});
test('failed entry conditions roll back all effects and leave the runner in the previous scene',()=>{
  const r=example('dialogue'),forest=r.dialogue.scenes.find(s=>s.id==='forest');
  forest.actions=[{type:'item',key:'지도',amount:1},{type:'guard',target:'item',key:'열쇠',op:'>=',amount:1,text:'열쇠가 필요해요.'}];validateRule(r);
  let p=move(r,{actor:actor(),session:null},r.keyword);p=move(r,p,'숲');
  assert.equal(p.out.rejected,true);assert.equal(p.session.sceneId,'start');assert.equal(p.actor.inventory.지도,undefined);
  assert.match(p.out.replies[0],/열쇠/);assert.ok(!p.session.visited.includes('forest'));
  p.actor.inventory.열쇠=1;p=move(r,p,'숲');assert.equal(p.session.sceneId,'forest');assert.equal(p.actor.inventory.지도,1);
});
test('ordinary commands may run during investigation while choices and controls take priority',()=>{
  const r=example('dialogue'),check=example('check'),session={ruleId:r.id,sceneId:'start',status:'active',visited:['start']};
  assert.equal(selectBotRule([check,r],'숲으로 갑니다',session),r);
  assert.equal(selectBotRule([check,r],'확인',session),check);
  assert.equal(selectBotRule([check,r],'없는 선택지',session),r);
  assert.equal(selectBotRule([check],'숲',session),undefined);
  assert.equal(selectBotRule([r],r.keyword,null),r);
  session.status='paused';assert.equal(selectBotRule([check,r],'확인',session),check);
});
test('deleted current scenes recover without rewards and malformed links, effects and control collisions are rejected',()=>{
  const base=example('dialogue');
  const missing=advanceDialogue(base,actor(),'숲',{ruleId:base.id,sceneId:'removed',status:'active',visited:[]});
  assert.equal(missing.session.status,'ended');assert.equal(missing.changes.length,0);
  for(const mutate of [
    r=>{r.dialogue.start='missing';},r=>{r.dialogue.scenes[0].choices[0].next='missing';},
    r=>{r.dialogue.stopKeyword=r.dialogue.resumeKeyword;},r=>{r.dialogue.scenes[0].choices[0].keyword='조사 중단';},
    r=>{r.dialogue.scenes[0].choices[0].keyword='1';},r=>{r.dialogue.scenes[0].actions=[{type:'item',key:'약초',amount:0.5}];},
    r=>{r.dialogue.scenes[0].choices=[];},r=>{r.dialogue.scenes.push({...r.dialogue.scenes[0]});}
  ]){const r=structuredClone(base);mutate(r);assert.throws(()=>validateRule(r));}
});
