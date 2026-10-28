import test from 'node:test';
import assert from 'node:assert/strict';
import {aiPlaneShape,chooseAiTarget} from '../public/ai.js';

test('AI plane shape matches the ten-cell aircraft rule',()=>{
  const shape=aiPlaneShape({x:4,y:1,dir:'D'});
  assert.equal(shape.head,14);
  assert.equal(shape.cells.length,10);
  assert.equal(new Set(shape.cells).size,10);
});

test('easy AI never repeats an attacked cell',()=>{
  const shots=Array.from({length:99},(_,cell)=>({cell,result:'miss'}));
  assert.equal(chooseAiTarget(shots,3,'easy',()=>0.5),99);
});

test('standard AI finds the only possible head from public results',()=>{
  const plane=aiPlaneShape({x:4,y:1,dir:'D'}),occupied=new Set(plane.cells);
  const shots=[];
  for(let cell=0;cell<100;cell++)if(!occupied.has(cell))shots.push({cell,result:'miss'});
  shots.push({cell:plane.cells[3],result:'hit'});
  assert.equal(chooseAiTarget(shots,1,'normal',()=>0.25),plane.head);
});

test('hard AI infers a constrained layout without hidden plane data',()=>{
  const plane=aiPlaneShape({x:4,y:1,dir:'D'}),occupied=new Set(plane.cells);
  const shots=[];
  for(let cell=0;cell<100;cell++)if(!occupied.has(cell))shots.push({cell,result:'miss'});
  shots.push({cell:plane.cells[5],result:'hit'});
  assert.equal(chooseAiTarget(shots,1,'hard',()=>0.4),plane.head);
});
