import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,example,validateRule,calculate,commandText,numericMap,diceBlock,diceRanges} from '../public/engine.mjs';
test('items and stats are changed together; failed condition rolls back all changes',()=>{
  const actor={name:'러너',stats:{체력:50},inventory:{회복약:1}};
  const rule=example('item');validateRule(rule);
  const first=execute(rule,actor);assert.equal(first.stats.체력,60);assert.equal(first.inventory.회복약,0);assert.match(first.replies[0],/60/);
  const second=execute(rule,{...actor,stats:first.stats,inventory:first.inventory});assert.equal(second.stats.체력,60);assert.equal(second.inventory.회복약,0);assert.equal(second.rejected,true);
  assert.equal(actor.stats.체력,50);
});
test('arithmetic supports custom stats and rejects code, division by zero, unsafe keys',()=>{
  assert.equal(calculate('({행운} + 4) * 2 - 3 / 2',{행운:7}),20.5);
  assert.throws(()=>calculate('1/0'));assert.throws(()=>calculate('globalThis.alert(1)'));assert.throws(()=>numericMap(JSON.parse('{"__proto__":5}')));
  validateRule({...example('check'),blocks:[{type:'calculate',key:'결과',expression:'{행운} + 1'}]});
});
test('weighted randomness and templates use the same engine as practice',()=>{
  const rule={...example('dice'),blocks:[{type:'random',text:'30 | 발견\n70 | 없음'},{type:'reply',text:'{닉네임}: {결과}'}]};
  assert.deepEqual(execute(rule,{name:'루시아',stats:{},inventory:{}},{random:()=>0.2}).replies,['루시아: 발견']);
  assert.deepEqual(execute(rule,{name:'루시아',stats:{},inventory:{}},{random:()=>0.9}).replies,['루시아: 없음']);
});
test('leading bot mentions are removed without removing literal @확인',()=>{
  assert.equal(commandText('<p><span>@bot</span> 확인</p>',['bot']),'확인');
  assert.equal(commandText('<p>@bot@planet.moe @확인</p>',['bot@planet.moe']),'@확인');
});
test('1d100 replies contain the rolled number and exactly one verdict for every outcome',()=>{
  const rule=example('dice'),actor={name:'루시아',stats:{체력:50},inventory:{회복약:1}};
  validateRule(rule);
  for(let value=1;value<=100;value++){
    const expected=value<=25?'어려운 성공':value<=50?'성공':value<=75?'실패':'대실패';
    const output=execute(rule,actor,{random:()=>(value-0.5)/100});
    assert.deepEqual(output.replies,[`루시아 · 1d100\n${value} / ${expected}`]);
    assert.equal(output.stats.체력,50);
    assert.equal(output.inventory.회복약,1);
    assert.deepEqual(output.changes,[]);
  }
});
test('dice practice accepts boundary values without changing live randomness or legacy rolls',()=>{
  const rule=example('dice'),actor={name:'러너',stats:{},inventory:{}};
  for(const value of [1,25,26,50,51,75,76,100])assert.ok(execute(rule,actor,{diceTotal:value,random:()=>{throw Error('Practice must use the chosen total');}}).replies[0].includes(`${value} / `));
  for(const value of [0,101,25.5,NaN])assert.throws(()=>execute(rule,actor,{diceTotal:value}),/정수/);
  const legacy={...rule,blocks:[{type:'roll',count:1,sides:100},{type:'reply',text:'숫자: {결과}'}]};
  validateRule(legacy);
  assert.deepEqual(execute(legacy,actor,{random:()=>0.245}).replies,['숫자: 25']);
  const twoDice={...rule,blocks:[diceBlock(2,6)]};
  validateRule(twoDice);
  assert.match(execute(twoDice,actor,{random:()=>0.99}).replies[0],/2d6\n12 \/ 대실패/);
});
test('dice verdict tables reject missing, overlapping, reversed, and unnamed ranges',()=>{
  const rule=example('dice');
  for(const ranges of [[],[{max:99,label:'결과'}],[{max:50,label:'성공'},{max:50,label:'실패'},{max:100,label:'끝'}],[{max:0,label:'범위 밖'},{max:100,label:'끝'}],[{max:101,label:'범위 밖'}],[{max:100,label:''}],[{max:25.5,label:'소수'},{max:100,label:'끝'}]])assert.throws(()=>validateRule({...rule,blocks:[{...diceBlock(),ranges}]}));
  const custom={...rule,blocks:[{...diceBlock(),ranges:[{max:10,label:'기적'},{max:100,label:'평범'}],text:'{주사위식} = {주사위}, {판정}; 숫자 {결과}'}]};
  validateRule(custom);
  assert.equal(execute(custom,{name:'러너',stats:{},inventory:{}},{diceTotal:10}).replies[0],'1d100 = 10, 기적; 숫자 10');
  assert.equal(execute(custom,{name:'러너',stats:{},inventory:{}},{diceTotal:11}).replies[0],'1d100 = 11, 평범; 숫자 11');
  const small=diceRanges(1,2);assert.deepEqual(small.map(r=>r.max),[1,2]);
  assert.throws(()=>diceRanges(0,100));
});
test('all condition comparisons work for stats, items and rolled results at boundaries',()=>{
  const actor={name:'러너',stats:{체력:50},inventory:{열쇠:2}};
  for(const target of ['stat','item','result'])for(const [op,expected] of [['>=',[false,true,true]],['<=',[true,true,false]],['==',[false,true,false]],['>',[false,false,true]],['<',[true,false,false]]]){
    const value=target==='stat'?50:target==='item'?2:25;
    for(const [i,n] of [value+1,value,value-1].entries()){
      const rule={...example('check'),blocks:[...(target==='result'?[{type:'roll',count:1,sides:100}]:[]),{type:'guard',target,key:target==='item'?'열쇠':'체력',op,amount:n,text:'실패'},{type:'item',key:'보상',amount:1},{type:'reply',text:'통과'}]};
      validateRule(rule);const out=execute(rule,actor,{diceTotal:25});assert.equal(!out.rejected,expected[i],`${target} ${op} ${n}`);assert.equal(out.inventory.보상,expected[i]?1:undefined);
    }
  }
});
test('two conditions both apply, failed conditions roll back earlier replies and mutations',()=>{
  const rule={...example('check'),blocks:[{type:'stat',key:'체력',amount:5},{type:'reply',text:'이 답장은 취소되어야 해요'},{type:'guard',target:'stat',key:'체력',op:'>=',amount:50,text:'체력 부족'},{type:'guard',target:'item',key:'열쇠',op:'>=',amount:1,text:'열쇠 부족'}]};
  const out=execute(rule,{name:'러너',stats:{체력:50},inventory:{}});assert.equal(out.stats.체력,50);assert.deepEqual(out.replies,['열쇠 부족']);assert.deepEqual(out.changes,[]);assert.equal(out.trace.length,3);
});
test('calculation validation checks syntax without rejecting valid variable denominators',()=>{
  const r={...example('calculate'),blocks:[{type:'calculate',key:'계산값',expression:'100 / ({체력} - {관찰력})'},{type:'reply',text:'{계산값} / {결과}'}]};
  validateRule(r);const out=execute(r,{name:'러너',stats:{체력:50,관찰력:30},inventory:{}});assert.equal(out.stats.계산값,5);assert.deepEqual(out.replies,['5 / 5']);
  assert.throws(()=>execute(r,{stats:{체력:30,관찰력:30},inventory:{}}));
});
test('every ready-made form executes, weighted direct replies preserve old selection-only behavior',()=>{
  for(const kind of ['reply','random','award','calculate','dice','check','history','search','item']){const r=example(kind);validateRule(r);const out=execute(r,{name:'러너',stats:{체력:50,관찰력:0},inventory:{회복약:1}},{random:()=>0.1,history:[{message:'열쇠 +1'}]});assert.ok(out.replies.length>0,kind);}
  const r=example('random');r.blocks[0].text='0 | 제외\n30 | A\n70 | B';
  assert.deepEqual(execute(r,{stats:{},inventory:{}},{random:()=>0}).replies,['A']);
  assert.deepEqual(execute(r,{stats:{},inventory:{}},{random:()=>0.3}).replies,['B']);
  r.blocks[0].emit=false;assert.deepEqual(execute(r,{stats:{},inventory:{}}).replies,[]);
  r.blocks[0].text='0 | 없음';assert.throws(()=>validateRule(r));
});
test('negative or empty weighted candidates cannot silently become a reply',()=>{
  const r=example('random');for(const text of ['-1 | 잘못된 비중','2 | ']){r.blocks[0].text=text;assert.throws(()=>validateRule(r));}
});
test('gathering rolls success first, chooses one weighted material and never awards on failure',()=>{
  const r=example('gather'),a={name:'러너',stats:{},inventory:{}};validateRule(r);
  let rolls=[0.69,0.7];let out=execute(r,a,{random:()=>rolls.shift()});assert.equal(out.inventory['반짝이는 돌'],1);assert.equal(out.inventory.약초,undefined);assert.match(out.replies[0],/반짝이는 돌/);
  out=execute(r,a,{random:()=>0.7});assert.deepEqual(Object.keys(out.inventory),[]);assert.equal(out.changes.length,0);
});
test('recipes require every material and consume exact quantities only on configured outcomes',()=>{
  const r=example('craft'),a={name:'러너',stats:{},inventory:{약초:4,물:1}};validateRule(r);
  let out=execute(r,a);assert.equal(out.inventory.약초,2);assert.equal(out.inventory.물,0);assert.equal(out.inventory.회복약,1);assert.equal(a.inventory.약초,4);
  out=execute(r,{...a,inventory:{약초:1,물:100}});assert.equal(out.rejected,true);assert.equal(out.inventory.약초,1);assert.equal(out.inventory.물,100);assert.match(out.replies[0],/재료가 부족/);
  r.blocks[0].chance=0;out=execute(r,a);assert.equal(out.inventory.약초,4);assert.equal(out.inventory.회복약,undefined);
  r.blocks[0].consumeOnFail=true;out=execute(r,a);assert.equal(out.inventory.약초,2);assert.equal(out.inventory.물,0);assert.equal(out.inventory.회복약,undefined);
});
test('recipes reject duplicate or negative materials and later unmet conditions roll back crafting',()=>{
  const r=example('craft');r.blocks[0].ingredients.push({key:'약초',amount:2});assert.throws(()=>validateRule(r));r.blocks[0].ingredients.pop();r.blocks[0].ingredients[0].amount=-1;assert.throws(()=>validateRule(r));
  const valid=example('craft');valid.blocks.push({type:'guard',target:'stat',key:'체력',op:'>=',amount:50,text:'체력 부족'});const out=execute(valid,{name:'러너',stats:{체력:10},inventory:{약초:2,물:1}});assert.equal(out.inventory.약초,2);assert.equal(out.inventory.회복약,undefined);assert.deepEqual(out.changes,[]);
});
