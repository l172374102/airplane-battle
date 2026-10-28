import test from 'node:test';
import assert from 'node:assert/strict';
import {shape,validPlanes,playerView,requestRematch,settleAfterShot,normalizeChatText,appendChatMessage} from '../src/worker.js';

test('plane shape has ten unique cells and preserves the head',()=>{
  const result=shape([4,4],'U');
  assert.equal(result.head,44);
  assert.equal(result.cells.length,10);
  assert.equal(new Set(result.cells).size,10);
});

test('plane shape rejects out-of-bounds placements',()=>{
  assert.equal(shape([0,0],'U'),null);
  assert.equal(shape([9,9],'D'),null);
});

test('validPlanes accepts separate planes and rejects overlap',()=>{
  const valid=[{x:1,y:2,dir:'R'},{x:1,y:7,dir:'R'},{x:7,y:1,dir:'D'}];
  assert.equal(validPlanes(valid,3),true);
  assert.equal(validPlanes([valid[0],valid[0],valid[2]],3),false);
});

test('player view never exposes opponent layout before game end',()=>{
  const state={room:'123456',count:3,status:'playing',turn:0,winner:null,updated:1,shots:[],players:[
    {token:'a',name:'玩家1',ready:true,planes:[{x:2,y:4,dir:'R'}],kills:0},
    {token:'b',name:'玩家2',ready:true,planes:[{x:7,y:5,dir:'L'}],kills:0}
  ]};
  const view=playerView(state,0);
  assert.deepEqual(view.myPlanes,state.players[0].planes);
  assert.equal(view.opponentPlanes,undefined);
  assert.equal(JSON.stringify(view).includes('"token"'),false);
  state.status='done';
  assert.deepEqual(playerView(state,0).opponentPlanes,state.players[1].planes);
});

test('both players can start the next round in the same room',()=>{
  const state={room:'123456',count:3,round:1,status:'done',turn:0,winner:0,finalChance:true,updated:1,shots:[{by:0,cell:22,result:'kill'}],messages:[{id:1,by:0,text:'再来一局',at:1}],players:[
    {token:'a',name:'玩家1',ready:true,planes:[{x:2,y:4,dir:'R'}],kills:3,rematch:false},
    {token:'b',name:'玩家2',ready:true,planes:[{x:7,y:5,dir:'L'}],kills:1,rematch:false}
  ]};
  assert.equal(requestRematch(state,0),false);
  assert.equal(state.status,'done');
  assert.equal(state.players[0].rematch,true);
  assert.equal(requestRematch(state,1),true);
  assert.equal(state.round,2);
  assert.equal(state.status,'waiting');
  assert.equal(state.winner,null);
  assert.equal(state.finalChance,false);
  assert.equal(state.turn,0);
  assert.deepEqual(state.shots,[]);
  assert.deepEqual(state.messages,[{id:1,by:0,text:'再来一局',at:1}]);
  assert.deepEqual(state.players.map(({token})=>token),['a','b']);
  for(const player of state.players){
    assert.equal(player.ready,false);
    assert.equal(player.rematch,false);
    assert.equal(player.kills,0);
    assert.deepEqual(player.planes,[]);
  }
});

test('second player gets one final shot and can force a draw',()=>{
  const state={count:3,status:'playing',turn:0,winner:null,finalChance:false,players:[{kills:3},{kills:2}]};
  settleAfterShot(state,0);
  assert.equal(state.status,'playing');
  assert.equal(state.turn,1);
  assert.equal(state.finalChance,true);
  assert.equal(state.winner,null);

  state.players[1].kills=3;
  settleAfterShot(state,1);
  assert.equal(state.status,'done');
  assert.equal(state.winner,'draw');
  assert.equal(state.finalChance,false);
});

test('first player wins if the final reply does not complete all kills',()=>{
  const state={count:3,status:'playing',turn:1,winner:null,finalChance:true,players:[{kills:3},{kills:1}]};
  settleAfterShot(state,1);
  assert.equal(state.status,'done');
  assert.equal(state.winner,0);
  assert.equal(state.finalChance,false);
});

test('second player wins normally when finishing before a final-chance state',()=>{
  const state={count:3,status:'playing',turn:1,winner:null,finalChance:false,players:[{kills:2},{kills:3}]};
  settleAfterShot(state,1);
  assert.equal(state.status,'done');
  assert.equal(state.winner,1);
});

test('chat messages are normalized and invalid lengths are rejected',()=>{
  assert.equal(normalizeChatText('  准备好了吗？  '),'准备好了吗？');
  assert.equal(normalizeChatText('两行\n消息'),'两行 消息');
  assert.equal(normalizeChatText('   '),null);
  assert.equal(normalizeChatText('a'.repeat(121)),null);
  assert.equal(normalizeChatText(null),null);
});

test('chat history keeps safe text fields and only the newest 100 messages',()=>{
  const state={messages:[],nextMessageId:0};
  for(let i=1;i<=105;i++)appendChatMessage(state,i%2,`消息 ${i}`,1000+i);
  assert.equal(state.messages.length,100);
  assert.equal(state.messages[0].id,6);
  assert.deepEqual(state.messages[99],{id:105,by:1,text:'消息 105',at:1105});
  const literal=appendChatMessage(state,0,'<img src=x onerror=alert(1)>',2000);
  assert.equal(literal.text,'<img src=x onerror=alert(1)>');
});
