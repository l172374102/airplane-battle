import test from 'node:test';
import assert from 'node:assert/strict';
import {shape,validPlanes,playerView,requestRematch} from '../src/worker.js';

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
  const state={room:'123456',count:3,round:1,status:'done',turn:0,winner:0,updated:1,shots:[{by:0,cell:22,result:'kill'}],players:[
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
  assert.equal(state.turn,0);
  assert.deepEqual(state.shots,[]);
  assert.deepEqual(state.players.map(({token})=>token),['a','b']);
  for(const player of state.players){
    assert.equal(player.ready,false);
    assert.equal(player.rematch,false);
    assert.equal(player.kills,0);
    assert.deepEqual(player.planes,[]);
  }
});
