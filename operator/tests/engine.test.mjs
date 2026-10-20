import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,example,validateRule,calculate,commandText,numericMap} from '../public/engine.mjs';
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
