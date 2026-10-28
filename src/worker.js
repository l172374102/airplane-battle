const JSON_HEADERS={'content-type':'application/json;charset=utf-8','cache-control':'no-store'};
const send=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:JSON_HEADERS});
const err=(msg,status=400)=>send({error:msg},status);
const random=n=>{const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return bytes[0]%n};
const code=()=>Array.from({length:6},()=>String(random(10))).join('');
const token=()=>crypto.randomUUID()+crypto.randomUUID();

function allowedOrigin(request,env,url){
  const origin=request.headers.get('origin');
  if(!origin)return true;
  let frontendOrigin='';
  try{frontendOrigin=new URL(env.FRONTEND_ORIGIN).origin}catch{}
  return origin===frontendOrigin||origin===url.origin||/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function withCors(response,request,env,url){
  const origin=request.headers.get('origin');
  const headers=new Headers(response.headers);
  headers.set('vary','Origin');
  if(origin&&allowedOrigin(request,env,url))headers.set('access-control-allow-origin',origin);
  headers.set('access-control-allow-methods','POST, OPTIONS');
  headers.set('access-control-allow-headers','content-type');
  headers.set('access-control-max-age','86400');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export function shape(head,dir){
  let [x,y]=head,dx=0,dy=0;
  if(dir==='U')dy=-1;if(dir==='D')dy=1;if(dir==='L')dx=-1;if(dir==='R')dx=1;
  const sx=-dy,sy=dx,cells=[];
  for(const [f,s] of [[0,0],[1,-2],[1,-1],[1,0],[1,1],[1,2],[2,0],[3,-1],[3,0],[3,1]]){
    const a=x+f*dx+s*sx,b=y+f*dy+s*sy;
    if(a<0||a>9||b<0||b>9)return null;
    cells.push(b*10+a);
  }
  return {head:y*10+x,cells};
}
export function validPlanes(planes,count){
  if(!Array.isArray(planes)||planes.length!==count)return false;
  const used=new Set();
  for(const p of planes){
    if(!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||!['U','D','L','R'].includes(p.dir))return false;
    const s=shape([p.x,p.y],p.dir);if(!s)return false;
    for(const cell of s.cells){if(used.has(cell))return false;used.add(cell)}
  }
  return true;
}
export function playerView(state,seat){
  const me=state.players[seat],other=state.players[1-seat];
  return {
    room:state.room,count:state.count,round:state.round||1,status:state.status,seat,turn:state.turn,winner:state.winner,
    players:state.players.map(p=>({joined:!!p.token,ready:p.ready,name:p.name,kills:p.kills,rematch:!!p.rematch})),
    myPlanes:me.planes,
    shots:state.shots.filter(shot=>shot.by===seat),
    incoming:state.shots.filter(shot=>shot.by!==seat),
    allShots:state.status==='done'?state.shots:undefined,
    opponentPlanes:state.status==='done'?other.planes:undefined,
    updated:state.updated
  };
}
export function requestRematch(state,seat){
  state.players[seat].rematch=true;
  if(!state.players.every(player=>player.rematch))return false;
  state.round=(state.round||1)+1;
  state.status='waiting';state.turn=0;state.winner=null;state.shots=[];
  for(const player of state.players){
    player.ready=false;player.planes=[];player.kills=0;player.rematch=false;
  }
  return true;
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
    if(request.method==='OPTIONS'){
      const response=allowedOrigin(request,env,url)?new Response(null,{status:204}):err('Origin not allowed',403);
      return withCors(response,request,env,url);
    }
    if(!allowedOrigin(request,env,url))return withCors(err('Origin not allowed',403),request,env,url);
    if(request.method!=='POST')return withCors(err('Method not allowed',405),request,env,url);
    let body={};try{body=await request.json()}catch{return withCors(err('JSON 格式错误'),request,env,url)}

    if(url.pathname==='/api/create'){
      const count=Number(body.count);if(count!==3&&count!==4)return withCors(err('请选择3或4架'),request,env,url);
      for(let i=0;i<10;i++){
        const room=code(),stub=env.ROOMS.get(env.ROOMS.idFromName(room));
        const response=await stub.fetch('https://room/init',{method:'POST',body:JSON.stringify({room,count})});
        if(response.status===201){
          const json=await response.json();
          const base=env.FRONTEND_ORIGIN||`${url.origin}/`;
          return withCors(send({...json,url:new URL(`?room=${room}`,base).toString()}),request,env,url);
        }
      }
      return withCors(err('创建房间失败',503),request,env,url);
    }

    const room=String(body.room||'');
    if(!/^\d{6}$/.test(room))return withCors(err('房间号必须是6位数字'),request,env,url);
    const stub=env.ROOMS.get(env.ROOMS.idFromName(room));
    const response=await stub.fetch(`https://room/${url.pathname.slice(5)}`,{method:'POST',body:JSON.stringify(body)});
    return withCors(response,request,env,url);
  }
};

export class GameRoom {
  constructor(state,env){this.ctx=state;this.env=env}
  async fetch(request){
    let body={};try{body=await request.json()}catch{return err('JSON 错误')}
    const action=new URL(request.url).pathname.slice(1);
    let state=await this.ctx.storage.get('game');

    if(action==='init'){
      if(state)return err('房间已存在',409);
      const accessToken=token();
      state={room:body.room,count:body.count,round:1,status:'waiting',turn:0,winner:null,players:[{token:accessToken,name:'玩家1',ready:false,planes:[],kills:0,rematch:false},{token:null,name:'玩家2',ready:false,planes:[],kills:0,rematch:false}],shots:[],updated:Date.now()};
      await this.ctx.storage.put('game',state);
      return send({room:state.room,seat:0,token:accessToken},201);
    }
    if(!state)return err('房间不存在',404);

    if(action==='join'){
      if(state.status!=='waiting')return err('游戏已经开始');
      if(state.players[1].token)return err('房间已满');
      const accessToken=token();state.players[1].token=accessToken;state.updated=Date.now();
      await this.ctx.storage.put('game',state);
      return send({room:state.room,seat:1,token:accessToken});
    }

    const seat=state.players.findIndex(player=>player.token&&player.token===body.token);
    if(seat<0)return err('无权访问房间',403);
    if(action==='state')return send(playerView(state,seat));

    if(action==='ready'){
      if(state.status!=='waiting'||!state.players[1].token)return err('等待另一位玩家加入');
      if(!validPlanes(body.planes,state.count))return err('飞机布局无效：不能重叠或越界');
      state.players[seat].planes=body.planes;state.players[seat].ready=true;
      if(state.players.every(player=>player.ready))state.status='playing';
      state.updated=Date.now();await this.ctx.storage.put('game',state);return send(playerView(state,seat));
    }

    if(action==='rematch'){
      if(state.status!=='done')return err('只能在本局结束后重新开始');
      requestRematch(state,seat);
      state.updated=Date.now();await this.ctx.storage.put('game',state);return send(playerView(state,seat));
    }

    if(action==='shot'){
      if(state.status!=='playing')return err('游戏尚未开始或已结束');
      if(state.turn!==seat)return err('还没轮到你');
      const cell=Number(body.cell);
      if(!Number.isInteger(cell)||cell<0||cell>=100)return err('坐标无效');
      if(state.shots.some(shot=>shot.by===seat&&shot.cell===cell))return err('不能重复攻击同一个格子');
      const target=state.players[1-seat];let result='miss',planeId=-1;
      for(let i=0;i<target.planes.length;i++){
        const plane=target.planes[i],planeShape=shape([plane.x,plane.y],plane.dir);
        if(planeShape.cells.includes(cell)){planeId=i;result=planeShape.head===cell?'kill':'hit';break}
      }
      if(result==='kill')state.players[seat].kills++;
      state.shots.push({by:seat,cell,result,planeId:result==='kill'?planeId:undefined,n:state.shots.length+1});
      if(state.players[seat].kills===state.count){state.status='done';state.winner=seat}else state.turn=1-seat;
      state.updated=Date.now();await this.ctx.storage.put('game',state);return send(playerView(state,seat));
    }
    return err('未知操作',404);
  }
}
