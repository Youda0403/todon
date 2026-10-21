import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,example,validateRule,validateRecipes,validateRecipeReferences,recipeRules,itemInfoRules,selectBotRule,advanceDialogue,matchesRecipe,matches} from '../public/engine.mjs';
const item=(name,description='')=>({id:name,name,description,usable:false,effects:[],text:''});
const recipe=()=>({id:'fire',name:'불 피우기',callable:true,keyword:'[불 피우기]',ingredients:[{key:'돌',amount:1,consume:false},{key:'마른 풀',amount:2,consume:true}],conditions:[{target:'stat',key:'힘',op:'>=',amount:3}],chance:100,consumeOnFail:false,effects:[{type:'item',key:'불씨',amount:1}],successText:'불을 피웠습니다. 힘 {힘}',failureText:'불을 피우지 못했습니다.'});
const actor=()=>({name:'러너',stats:{힘:3},inventory:{돌:1,'마른 풀':2}});
const run=(r,a=actor(),options={})=>execute({blocks:[{type:'runRecipe',recipeId:r.id}]},a,{recipes:[r],...options});
test('registered recipes combine materials and stat requirements, preserve tools and never consume required stats',()=>{
  const r=recipe();validateRecipes([r]);const o=run(r);assert.equal(o.inventory.돌,1);assert.equal(o.inventory['마른 풀'],0);assert.equal(o.inventory.불씨,1);assert.equal(o.stats.힘,3);assert.deepEqual(o.replies,['불을 피웠습니다. 힘 3']);
  r.effects=[];r.successText='불을 피웠습니다.';assert.deepEqual(run(r).replies,['불을 피웠습니다.']);
});
test('missing materials or low effective stats reject all prior changes even when failure normally consumes materials',()=>{
  const r=recipe();r.consumeOnFail=true;
  for(const a of [{...actor(),stats:{힘:2}},{...actor(),inventory:{돌:1,'마른 풀':1}}]){
    const o=execute({blocks:[{type:'item',key:'선물',amount:1},{type:'runRecipe',recipeId:r.id}]},a,{recipes:[r]});assert.equal(o.rejected,true);assert.equal(o.inventory.선물,undefined);assert.equal(o.inventory['마른 풀'],a.inventory['마른 풀']);assert.equal(o.stats.힘,a.stats.힘);assert.match(o.replies[0],/조건이 부족/);
  }
  const charm={...item('부적'),passive:true,passiveEffects:[{key:'힘',target:'stat',amount:1}]};const a={...actor(),stats:{힘:2},inventory:{...actor().inventory,부적:1}};assert.equal(run(r,a,{items:[charm]}).rejected,false);
});
test('chance failure only consumes marked materials when configured and later guards roll back the entire recipe',()=>{
  const r=recipe();r.chance=0;let o=run(r);assert.equal(o.inventory['마른 풀'],2);assert.equal(o.inventory.불씨,undefined);assert.deepEqual(o.replies,[r.failureText]);
  r.consumeOnFail=true;o=run(r);assert.equal(o.inventory['마른 풀'],0);assert.equal(o.inventory.돌,1);
  r.chance=100;const a=actor();o=execute({blocks:[{type:'runRecipe',recipeId:r.id},{type:'guard',target:'stat',key:'힘',op:'>=',amount:4,text:'힘이 부족합니다.'}]},a,{recipes:[r]});assert.equal(o.inventory['마른 풀'],2);assert.equal(o.inventory.불씨,undefined);assert.deepEqual(o.changes,[]);
});
test('using an item and using it in a recipe are separate and recipe-backed item use never deducts it twice',()=>{
  const r=recipe(),stone={...item('돌'),usable:true,consume:true,text:'돌을 사용했습니다.',keyword:'[돌 사용]',effects:[{type:'reply',text:'단독 사용'}]};
  const a=actor();let o=execute({blocks:[{type:'useItem',key:'돌',amount:1}]},a,{items:[stone],recipes:[r]});assert.equal(o.inventory.돌,0);assert.equal(o.inventory['마른 풀'],2);assert.equal(o.inventory.불씨,undefined);
  r.ingredients[0].consume=true;stone.effects=[{type:'runRecipe',recipeId:r.id}];o=execute({blocks:[{type:'useItem',key:'돌',amount:1}]},a,{items:[stone],recipes:[r]});assert.equal(o.rejected,false);assert.equal(o.inventory.돌,0);assert.equal(o.inventory['마른 풀'],0);assert.equal(o.inventory.불씨,1);
  const missing={...a,inventory:{돌:1}};o=execute({blocks:[{type:'useItem',key:'돌',amount:1}]},missing,{items:[stone],recipes:[r]});assert.equal(o.rejected,true);assert.equal(o.inventory.돌,1);
});
test('acquisition descriptions accompany ordinary awards, gathering, old and registered recipes, and nested outcomes only once',()=>{
  const items=[item('회복약','체력을 회복하는 약입니다.'),item('약초','숲에서 찾은 풀입니다.'),item('불씨','따뜻한 불씨입니다.')],a={...actor(),inventory:{...actor().inventory,약초:2,물:1}};
  const rules=[{blocks:[{type:'item',key:'회복약',amount:1},{type:'item',key:'회복약',amount:1}]},example('gather'),example('craft'),{blocks:[{type:'runRecipe',recipeId:'fire'}]},{blocks:[{type:'outcome',cases:[{name:'발견',chance:100,text:'발견했습니다.',blocks:[{type:'item',key:'약초',amount:1}]}]}]}];
  for(const [i,r] of rules.entries()){const o=execute(r,a,{items,recipes:[recipe()],random:()=>0});assert.equal(o.replies.filter(t=>t.includes('아이템 설명')).length,1,String(i));}
  const rejected=execute({blocks:[{type:'item',key:'약초',amount:1},{type:'guard',target:'item',key:'열쇠',op:'>=',amount:1,text:'열쇠 없음'}]},a,{items});assert.deepEqual(rejected.replies,['열쇠 없음']);
});
test('bags summarize descriptions and owned item inspection returns full text without changing a live scene',()=>{
  const items=[item('돌','매끄러운 돌입니다.')],a=actor(),r=example('dialogue');r.dialogue.scenes[0].choices[0].keyword='돌';
  const info=itemInfoRules(items,'bot')[0];validateRule(info);const session=advanceDialogue(r,a,r.keyword).session;
  assert.equal(selectBotRule([r,info],'[설명 돌]',session,a),info);assert.match(execute(example('check'),a,{items}).replies[1],/매끄러운 돌/);
  assert.match(execute(info,a,{items}).replies[0],/매끄러운 돌/);assert.ok(!execute(info,{...a,inventory:{}},{items}).replies[0].includes('매끄러운'));
});
test('recipe validation rejects invalid materials, stat conditions, recursive execution and dangling references',()=>{
  for(const mutate of [r=>r.ingredients.push({...r.ingredients[0]}),r=>{r.ingredients[0].amount=-1;},r=>{r.conditions[0].target='item';},r=>{r.chance=101;},r=>{r.effects=[{type:'runRecipe',recipeId:r.id}];},r=>{r.effects=[{type:'useItem',key:'돌',amount:1}];}]){const r=recipe();mutate(r);assert.throws(()=>validateRecipes([r]));}
  const r=recipe(),rule={...example('check'),blocks:[{type:'runRecipe',recipeId:r.id}]};assert.doesNotThrow(()=>validateRecipeReferences({recipes:[r],rules:[rule]}));assert.throws(()=>validateRecipeReferences({recipes:[],rules:[rule]}));
  assert.equal(recipeRules([r],'bot').length,1);r.callable=false;assert.equal(recipeRules([r],'bot').length,0);assert.equal(run(r).inventory.불씨,1);
});
test('recipes remain executable inside nested item-use outcomes without bypassing their checks',()=>{
  const wrap=blocks=>[{type:'outcome',cases:[{name:'결과',chance:100,text:'',blocks}]}],r=recipe();r.effects=wrap(wrap(r.effects));validateRecipes([r]);
  const stone={...item('돌'),usable:true,consume:false,text:'',effects:wrap([{type:'runRecipe',recipeId:r.id}])},rule={...example('check'),blocks:wrap([{type:'useItem',key:'돌',amount:1}])};validateRule(rule);
  const o=execute(rule,actor(),{items:[stone],recipes:[r]});assert.equal(o.rejected,false);assert.equal(o.inventory.불씨,1);assert.equal(o.inventory['마른 풀'],0);assert.equal(o.inventory.돌,1);
});
test('all-word recipe triggers require every word in either order and can ignore whitespace',()=>{
  const r={...recipe(),keyword:'',triggerMode:'all',triggerWords:['돌','마른 풀'],ignoreSpaces:true};validateRecipes([r]);const rule=recipeRules([r],'bot')[0];validateRule(rule);
  for(const text of ['돌과 마른풀을 조합한다','마른 풀 + 돌','돌마른풀','마 른\t풀 그리고 돌','돌과 마른\u00a0풀']){assert.equal(matchesRecipe(r,text),true,text);assert.equal(matches(rule,text),true,text);assert.equal(selectBotRule([rule],text,null,actor()),rule);}
  for(const text of ['돌','마른 풀','조합한다','',r.name])assert.equal(matchesRecipe(r,text),false,text);
  r.ignoreSpaces=false;assert.equal(matchesRecipe(r,'돌과 마른풀'),false);assert.equal(matchesRecipe(r,'돌과 마른 풀'),true);
});
test('legacy recipe triggers stay literal and new all-word definitions reject blanks and duplicate normalized conditions',()=>{
  const old=recipe();assert.equal(matchesRecipe(old,'[불피우기]'),false);assert.equal(matchesRecipe(old,'[불 피우기]'),true);
  for(const words of [[],[' '],['돌','돌'],['마른 풀','마른풀'],Array.from({length:21},(_,i)=>'단어'+i)])assert.throws(()=>validateRecipes([{...old,triggerMode:'all',triggerWords:words,ignoreSpaces:true}]));
  const r={...old,triggerMode:'all',triggerWords:['돌','마른 풀'],ignoreSpaces:true};assert.throws(()=>validateRecipes([r,{...r,id:'other',name:'다른 불',triggerWords:['마른풀','돌']}]),/같은 인식 조건/);
});
