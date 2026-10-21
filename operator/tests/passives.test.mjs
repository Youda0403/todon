import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,example,statView,participantView,validateCatalog,validateStatMaxes,validateRule,advanceDialogue,dialoguePrompt} from '../public/engine.mjs';
const actor=()=>({name:'러너',stats:{HP:90,힘:5},inventory:{부적:1}});
const charm=()=>({id:'charm',name:'부적',description:'',usable:false,keyword:'',text:'',effects:[],passive:true,passiveStack:'once',passiveEffects:[{key:'힘',target:'stat',amount:2}]});
test('possession modifiers are derived, never accumulated in saved stats, and disappear with the item',()=>{
  const items=[charm()],r=example('check'),a=actor();validateCatalog(items);
  for(let i=0;i<5;i++){
    const o=execute(r,a,{items});assert.equal(o.stats.힘,5);assert.equal(o.effectiveStats.힘,7);assert.match(o.replies[0],/힘: 7/);a.stats=o.stats;
  }
  a.inventory.부적=0;assert.equal(statView(a,{items}).stats.힘,5);
  const p=participantView(actor(),{items});assert.equal(p.stats.힘,7);assert.equal(p.baseStats.힘,5);assert.equal(participantView(p,{items}).stats.힘,7);
});
test('passive stacking and maximum bonuses follow current quantities and configured limits',()=>{
  const i=charm(),a=actor();a.inventory.부적=3;
  assert.equal(statView(a,{items:[i]}).stats.힘,7);i.passiveStack='quantity';assert.equal(statView(a,{items:[i]}).stats.힘,11);
  i.passiveEffects.push({key:'힘',target:'max',amount:1});
  const v=statView(a,{items:[i],statMaxes:{힘:8}});assert.equal(v.stats.힘,11);assert.equal(v.maxima.힘,11);
  a.inventory.부적=0;const gone=statView(a,{items:[i],statMaxes:{힘:8}});assert.equal(gone.stats.힘,5);assert.equal(gone.maxima.힘,8);
});
test('fixed changes, random increases, formulas and nested outcomes all enforce caps before the following action',()=>{
  const cap={HP:100},a={...actor(),inventory:{}};
  for(const b of [{type:'stat',key:'HP',amount:30},{type:'randomStat',keys:['HP'],min:30,max:30},{type:'calculate',key:'HP',expression:'{HP} + 30'},{type:'outcome',cases:[{name:'상승',chance:100,text:'최종 {HP}',blocks:[{type:'stat',key:'HP',amount:30}]}]}]){
    const r={...example('check'),blocks:[b,{type:'guard',target:'stat',key:'HP',op:'<=',amount:100,text:'초과'},{type:'reply',text:'HP {HP}'}]},o=execute(r,a,{statMaxes:cap});
    assert.equal(o.stats.HP,100);assert.equal(o.rejected,false);assert.equal(o.replies.at(-1),'HP 100');
  }
});
test('stat operations use the effective value and do not cancel damage beneath a clipped bonus',()=>{
  const i=charm();i.passiveEffects=[{key:'HP',target:'stat',amount:20}];const config={items:[i],statMaxes:{HP:100}},a=actor();
  assert.equal(statView(a,config).stats.HP,100);
  const damage=execute({blocks:[{type:'stat',key:'HP',amount:-5},{type:'reply',text:'HP {HP}'}]},a,config);assert.equal(damage.effectiveStats.HP,95);assert.equal(damage.replies[0],'HP 95');
  const next=execute(example('check'),{...a,stats:damage.stats},config);assert.equal(next.effectiveStats.HP,95);assert.equal(next.stats.HP,damage.stats.HP);
  const full=execute({blocks:[{type:'stat',key:'HP',amount:20}]},a,config);assert.equal(full.stats.HP,90);assert.equal(full.effectiveStats.HP,100);
});
test('gaining and losing a passive item within a command immediately changes conditions and variables',()=>{
  const a=actor();a.inventory={};const items=[charm()],r={...example('check'),blocks:[{type:'item',key:'부적',amount:1},{type:'guard',target:'stat',key:'힘',op:'>=',amount:7,text:'부족'},{type:'reply',text:'소지 중 {힘}'},{type:'item',key:'부적',amount:-1},{type:'reply',text:'소지 후 {힘}'}]};
  const o=execute(r,a,{items});assert.deepEqual(o.replies,['소지 중 7','소지 후 5']);assert.equal(o.stats.힘,5);
});
test('dialogue visibility and narration use passive stats, while aliases also respect hidden choices',()=>{
  const r=example('dialogue'),c=r.dialogue.scenes[0].choices[0];c.keyword='칼로 벗긴다';c.keywords=['칼','벗기기'];c.conditions=[{target:'stat',key:'힘',op:'>=',amount:7}];
  r.dialogue.scenes[0].text='현재 힘 {힘}';validateRule(r);const a=actor(),items=[charm()];
  const start=advanceDialogue(r,a,r.keyword,null,{items});assert.equal(start.replies[0],'현재 힘 7');assert.match(start.replies.join('\n'),/칼로 벗긴다/);
  assert.equal(advanceDialogue(r,a,'칼',start.session,{items}).session.sceneId,'forest');
  a.inventory={};const hidden=advanceDialogue(r,a,'칼',start.session,{items});assert.equal(hidden.session.sceneId,'start');assert.ok(!hidden.replies.join('\n').includes('칼로 벗긴다'));
});
test('choice aliases accept short words, full labels and displayed numbers, with ambiguity handled safely',()=>{
  const r=example('dialogue'),start=r.dialogue.scenes[0];start.choices[0].keyword='칼로 벗긴다';start.choices[0].keywords=['칼','벗기기'];validateRule(r);
  const a=actor(),session=advanceDialogue(r,a,r.keyword).session;
  for(const answer of ['칼','칼을 사용한다','벗기기','칼로 벗긴다','1번'])assert.equal(advanceDialogue(r,a,answer,session).session.sceneId,'forest');
  start.choices[1].keywords=['칼'];const ambiguous=advanceDialogue(r,a,'칼',session);assert.equal(ambiguous.session.sceneId,'start');assert.match(ambiguous.replies[0],/여러 선택지/);
  start.choices[0].keywords=['1'];assert.throws(()=>validateRule(r),/인식 키워드/);
});
test('invalid caps and passive definitions are rejected while old item definitions remain valid',()=>{
  assert.throws(()=>validateStatMaxes({HP:-1},{HP:100}));assert.throws(()=>validateStatMaxes({없는능력치:100},{HP:100}));
  const i=charm();i.passiveEffects=[];assert.throws(()=>validateCatalog([i]));i.passive=false;assert.doesNotThrow(()=>validateCatalog([i]));
  i.passive=true;i.passiveEffects=[{key:'힘',target:'unknown',amount:2}];assert.throws(()=>validateCatalog([i]));
});
