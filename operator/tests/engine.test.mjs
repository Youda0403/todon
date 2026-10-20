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
