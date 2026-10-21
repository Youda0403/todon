import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,example,validateRule,outcomeExample,upgradeActions,validateCatalog,advanceDialogue,availableChoices} from '../public/engine.mjs';
const actor=()=>({name:'루시아',stats:{HP:100,힘:5,행운:8},inventory:{}});
test('25/25/50 outcomes apply only the selected branch, allow several awards and format updated variables',()=>{
  const r={...example('check'),blocks:[outcomeExample('HP')]};
  r.blocks[0].cases[0].blocks.push({type:'item',key:'물',amount:2},{type:'randomStat',keys:['힘','행운'],min:1,max:3});r.blocks[0].cases[0].text='행운 {행운}, 약초 {물건:약초}';validateRule(r);
  for(const n of [0,0.249999,0.25,0.499999,0.5,0.999999]){
    const draws=[n,0.9,0.99],o=execute(r,actor(),{random:()=>draws.shift()});
    assert.equal(o.stats.HP,n>=0.5?95:100);
    assert.equal(o.inventory.약초,n<0.25?1:undefined);assert.equal(o.inventory.돌,n>=0.25&&n<0.5?1:undefined);
    if(n<0.25){assert.equal(o.inventory.물,2);assert.equal(o.stats.행운,11);assert.match(o.replies[0],/행운 11, 약초 1/);}
    if(n>=0.5)assert.match(o.replies[0],/HP: 95/);
  }
  r.blocks[0].cases[0].chance=24;assert.throws(()=>validateRule(r),/100%/);
});
test('a later failed condition rolls back nested outcome rewards and damage',()=>{
  const r={...example('check'),blocks:[{type:'outcome',cases:[{name:'발견',chance:100,text:'발견',blocks:[{type:'item',key:'물',amount:2},{type:'stat',key:'HP',amount:-5}]}]},{type:'guard',target:'item',key:'열쇠',op:'>=',amount:1,text:'열쇠 필요'}]};
  validateRule(r);const o=execute(r,actor(),{random:()=>0});assert.equal(o.rejected,true);assert.equal(o.stats.HP,100);assert.equal(o.inventory.물,undefined);assert.deepEqual(o.changes,[]);assert.deepEqual(o.replies,['열쇠 필요']);
});
test('legacy gathering migrates to equivalent outcome chances without losing its candidates',()=>{
  const blocks=upgradeActions(example('gather').blocks);assert.equal(blocks[0].cases.length,3);assert.deepEqual(blocks[0].cases.map(c=>Math.round(c.chance)),[49,21,30]);
  const r={...example('check'),blocks};validateRule(r);
  assert.match(execute(r,actor(),{random:()=>0}).replies[0],/약초 ×1/);
});
test('hidden choices are filtered and renumbered, cannot be reached by typing their keyword, and reappear with the item',()=>{
  const r=example('dialogue');r.dialogue.scenes[0].choices[0].conditions=[{target:'item',key:'열쇠',op:'>=',amount:1}];validateRule(r);
  const a=actor(),start=advanceDialogue(r,a,r.keyword);assert.ok(!start.replies.join('\n').includes('1. 숲'));assert.match(start.replies.join('\n'),/1. 동굴/);
  const hidden=advanceDialogue(r,a,'숲',start.session);assert.equal(hidden.session.sceneId,'start');
  const numbered=advanceDialogue(r,a,'1',start.session);assert.equal(numbered.session.sceneId,'cave');
  a.inventory.열쇠=1;assert.equal(availableChoices(r.dialogue.scenes[0],a).length,3);assert.equal(advanceDialogue(r,a,'숲',start.session).session.sceneId,'forest');
});
test('scene narrative precedes its effects, custom ending follows them, and an empty ending adds no fixed sentence',()=>{
  const r=example('dialogue');const s=r.dialogue.scenes[0];s.end=true;s.text='도착 전 HP {HP}';s.endText='종료 후 HP {HP} / 열쇠 {물건:열쇠}';s.actions=[{type:'stat',key:'HP',amount:-5}];
  const o=advanceDialogue(r,actor(),r.keyword);assert.equal(o.replies[0],'도착 전 HP 100');assert.equal(o.replies.at(-1),'종료 후 HP 95 / 열쇠 0');assert.ok(!o.replies.includes('조사가 끝났어요.'));
  s.endText='';assert.ok(!advanceDialogue(r,actor(),r.keyword).replies.some(t=>t.includes('조사가 끝났어요.')));
});
test('registered usable items consume once and apply random/stat effects together, missing items cannot apply effects',()=>{
  const items=[{id:'potion',name:'회복약',description:'회복',usable:true,consume:true,keyword:'[회복약 사용]',text:'HP {HP}',effects:[{type:'stat',key:'HP',amount:10},{type:'randomStat',keys:['행운'],min:2,max:2}]}];validateCatalog(items);
  const r={blocks:[{type:'useItem',key:'회복약',amount:1}]},a=actor();
  assert.equal(execute(r,a,{items}).rejected,true);a.inventory.회복약=1;
  const o=execute(r,a,{items});assert.equal(o.inventory.회복약,0);assert.equal(o.stats.HP,110);assert.equal(o.stats.행운,10);assert.equal(o.replies[0],'HP 110');
  assert.equal(execute(r,{...a,stats:o.stats,inventory:o.inventory},{items}).rejected,true);
  items[0].effects.push({type:'guard',target:'item',key:'열쇠',amount:1,op:'>=',text:'열쇠 필요'});const failed=execute(r,a,{items});assert.equal(failed.inventory.회복약,1);assert.equal(failed.stats.HP,100);
  items[0].effects=[{type:'useItem',key:'회복약',amount:1}];assert.throws(()=>validateCatalog(items),/다시 실행/);
});
test('dice and calculation variables inside an outcome reach its message and the final scene ending',()=>{
  const r=example('dialogue'),s=r.dialogue.scenes[0];s.end=true;s.endText='마무리 {주사위} / {판정}';
  s.actions=[{type:'outcome',cases:[{name:'판정',chance:100,text:'굴림 {주사위} / {판정}',blocks:[{type:'dice',count:1,sides:100,ranges:[{max:100,label:'완료'}],text:'주사위 {주사위}'},{type:'calculate',key:'HP',expression:'{HP} - 5'}]}]}];
  validateRule(r);const o=advanceDialogue(r,actor(),r.keyword,null,{random:()=>0,diceTotal:25});assert.ok(o.replies.includes('굴림 25 / 완료'));assert.equal(o.replies.at(-1),'마무리 25 / 완료');assert.equal(o.stats.HP,95);
});
