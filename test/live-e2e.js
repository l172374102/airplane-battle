import assert from 'node:assert/strict';

const base=process.env.API_BASE||'https://airplane-battle-online.airplane-battle.workers.dev';
const origin='https://l172374102.github.io';
async function post(action,data){
  const response=await fetch(`${base}/api/${action}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
  const json=await response.json();
  assert.equal(response.ok,true,`${action}: ${JSON.stringify(json)}`);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  return json;
}

const p1Planes=[{x:8,y:2,dir:'L'},{x:8,y:7,dir:'L'},{x:2,y:1,dir:'D'}];
const p2Planes=[{x:1,y:2,dir:'R'},{x:1,y:7,dir:'R'},{x:7,y:1,dir:'D'}];

const created=await post('create',{count:3});
assert.match(created.room,/^\d{6}$/);
assert.equal(created.seat,0);
assert.ok(created.token.length>60);

const joined=await post('join',{room:created.room});
assert.equal(joined.seat,1);

const p1Chat=await post('chat',{room:created.room,token:created.token,text:'准备好了吗？'});
assert.deepEqual(p1Chat.messages.map(({by,text})=>({by,text})),[{by:0,text:'准备好了吗？'}]);
const p2Chat=await post('chat',{room:created.room,token:joined.token,text:'开始吧 ✈️'});
assert.deepEqual(p2Chat.messages.map(({by,text})=>({by,text})),[{by:0,text:'准备好了吗？'},{by:1,text:'开始吧 ✈️'}]);

const p1Ready=await post('ready',{room:created.room,token:created.token,planes:p1Planes});
assert.equal(p1Ready.status,'waiting');
assert.equal(p1Ready.opponentPlanes,undefined);

const p2Ready=await post('ready',{room:created.room,token:joined.token,planes:p2Planes});
assert.equal(p2Ready.status,'playing');
assert.equal(p2Ready.opponentPlanes,undefined);

const privateView=await post('state',{room:created.room,token:created.token});
assert.equal(privateView.opponentPlanes,undefined);
assert.equal(privateView.allShots,undefined);
assert.equal(JSON.stringify(privateView).includes(joined.token),false);

await post('shot',{room:created.room,token:created.token,cell:21});
await post('shot',{room:created.room,token:joined.token,cell:28});
await post('shot',{room:created.room,token:created.token,cell:71});
await post('shot',{room:created.room,token:joined.token,cell:78});
const finalChance=await post('shot',{room:created.room,token:created.token,cell:17});
assert.equal(finalChance.status,'playing');
assert.equal(finalChance.turn,1);
assert.equal(finalChance.finalChance,true);
assert.equal(finalChance.opponentPlanes,undefined);
assert.equal(finalChance.allShots,undefined);

const finished=await post('shot',{room:created.room,token:joined.token,cell:12});
assert.equal(finished.status,'done');
assert.equal(finished.winner,'draw');
assert.deepEqual(finished.opponentPlanes,p1Planes);
assert.equal(finished.allShots.length,6);

const loserView=await post('state',{room:created.room,token:joined.token});
assert.deepEqual(loserView.opponentPlanes,p1Planes);
assert.equal(loserView.allShots.length,6);

const denied=await fetch(`${base}/api/create`,{method:'OPTIONS',headers:{origin:'https://example.com','access-control-request-method':'POST','access-control-request-headers':'content-type'}});
assert.equal(denied.status,403);
assert.equal(denied.headers.get('access-control-allow-origin'),null);

console.log(JSON.stringify({ok:true,room:created.room,shots:finished.allShots.length,winner:finished.winner,chat:'verified',secrecy:'verified',cors:'verified'}));
