import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCatalog,itemUseRules,matches,execute,example} from '../public/engine.mjs';
import {dialogueFlow} from '../public/dialogue-editor.mjs';
import {actionFlow} from '../public/action-editor.mjs';
const potion={id:'potion',name:'회복약',description:'작은 병',usable:true,keyword:'회복약 사용, 약을 마신다',effects:[{type:'stat',key:'HP',amount:3}],text:'회복했습니다.',consume:true};
test('item aliases recognize roleplay prose and whitespace but still require inventory',()=>{
 validateCatalog([potion]);const rule=itemUseRules([potion],'a')[0];
 for(const text of ['(회복약사용 후 주위를 살핀다.)','조심스레 약을  마신다.'])assert.equal(matches(rule,text),true);
 assert.equal(matches(rule,'풀을 살펴본다'),false);
 const out=execute(rule,{name:'러너',stats:{HP:2},inventory:{회복약:1}},{items:[potion]});assert.equal(out.stats.HP,5);assert.equal(out.inventory.회복약,0);
 const missing=execute(rule,{name:'러너',stats:{HP:2},inventory:{}},{items:[potion]});assert.equal(missing.rejected,true);assert.equal(missing.stats.HP,2);
 assert.throws(()=>validateCatalog([potion,{...potion,id:'other',name:'다른 약',keyword:'약을마신다'}]),/겹치는/);
});
test('comma phrases work in prose while exact mode remains literal',()=>{
 assert.equal(matches({keyword:'운세, 점괘',match:'contains'},'오늘 점괘를 보고 싶어요.'),true);
 assert.equal(matches({keyword:'운세',match:'exact'},'운세를 봐요'),false);
 assert.equal(matches({keyword:'회복약 사용',match:'contains',ignoreSpaces:true},'회복약사용한다'),true);
});
test('flow overview renders branches safely and terminates cyclic scenes',()=>{
 const r=example('dialogue','a');r.dialogue.scenes.find(s=>s.id==='forest').choices.push({keyword:'돌아간다',next:'start'});
 const html=dialogueFlow(r);assert.match(html,/이미 표시한 장면/);assert.match(html,/숲/);assert.ok(html.length<20000);
 const flow=actionFlow([{type:'outcome',cases:[{name:'성공',chance:25,blocks:[{type:'stat',key:'HP',amount:3}],text:'<script>'},{name:'실패',chance:75,blocks:[],text:''}]}]);assert.match(flow,/25%/);assert.match(flow,/HP \+3/);assert.ok(!flow.includes('<script>'));
});
