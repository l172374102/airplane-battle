import {aiDifficultyLabel,chooseAiTarget} from './ai.js?v=20261028-5';

const $=id=>document.getElementById(id);
const letters='ABCDEFGHIJ';
const apiBase=(document.querySelector('meta[name="api-base"]')?.content||'').replace(/\/$/,'');
const sessionKey='airplane-online-session-v2';
let activeMode='online';
let timer=null;
let online={room:'',token:'',seat:-1,planes:[],state:null,ready:false,busy:false,guesses:[],guessMode:false,draftPlane:null,draftIndex:-1,guessDraftPlane:null,guessDraftIndex:-1};
let local=null;
const cueState={};

function message(text=''){$('message').textContent=text}
function coord(n){return letters[n%10]+(Math.floor(n/10)+1)}
function headSymbol(p){return {U:'▼',R:'◀',D:'▲',L:'▶'}[p.dir]||'▲'}
function planeCoordinates(p){
  let dx=0,dy=0;
  if(p.dir==='U')dy=-1;if(p.dir==='D')dy=1;if(p.dir==='L')dx=-1;if(p.dir==='R')dx=1;
  const sx=-dy,sy=dx,points=[];
  for(const [f,s] of [[0,0],[1,-2],[1,-1],[1,0],[1,1],[1,2],[2,0],[3,-1],[3,0],[3,1]]){
    const x=p.x+f*dx+s*sx,y=p.y+f*dy+s*sy;
    points.push({x,y});
  }
  return points;
}
function shape(p){
  const points=planeCoordinates(p);if(points.some(({x,y})=>x<0||x>9||y<0||y>9))return null;
  const cells=points.map(({x,y})=>y*10+x);
  return {head:p.y*10+p.x,cells};
}
function validPlane(candidate,planes){
  const candidateShape=shape(candidate);if(!candidateShape)return false;
  const used=new Set(planes.flatMap(p=>shape(p)?.cells||[]));
  return candidateShape.cells.every(cell=>!used.has(cell));
}
function randomPlanes(count){
  const result=[],dirs=['U','R','D','L'];
  for(let attempt=0;result.length<count&&attempt<10000;attempt++){
    const p={x:Math.floor(Math.random()*10),y:Math.floor(Math.random()*10),dir:dirs[Math.floor(Math.random()*4)]};
    if(validPlane(p,result))result.push(p);
  }
  if(result.length!==count)throw Error('无法生成有效布局，请重试');
  return result;
}
function grid(target,render){
  const root=$(target);root.innerHTML='';
  const board=document.createElement('div');board.className='board';
  for(let y=-1;y<10;y++)for(let x=-1;x<10;x++){
    let el;
    if(x===-1||y===-1){el=document.createElement('div');el.className='axis';el.textContent=x===-1&&y===-1?'':y===-1?letters[x]:y+1}
    else{const n=y*10+x;el=document.createElement('button');el.className='cell';el.type='button';el.setAttribute('aria-label',coord(n));render(el,n,x,y)}
    board.appendChild(el);
  }
  root.appendChild(board);
}
function planeAtCell(planes,cell){return planes.findIndex(p=>shape(p)?.cells.includes(cell))}
function destroyedPlaneIds(shots){return new Set(shots.filter(s=>s.result==='kill'&&Number.isInteger(s.planeId)).map(s=>s.planeId))}
function planeOutlinePath(p){
  let dx=0,dy=0;
  if(p.dir==='U')dy=-1;if(p.dir==='D')dy=1;if(p.dir==='L')dx=-1;if(p.dir==='R')dx=1;
  const sx=-dy,sy=dx,cx=p.x+.5,cy=p.y+.5;
  const point=(f,s)=>`${(cx+f*dx+s*sx).toFixed(3)},${(cy+f*dy+s*sy).toFixed(3)}`;
  return [
    `M${point(-.46,0)}`,
    `C${point(-.28,.16)} ${point(.18,.34)} ${point(.52,.43)}`,
    `L${point(.58,2.18)}`,
    `Q${point(.60,2.48)} ${point(.88,2.48)}`,
    `L${point(1.18,2.48)}`,
    `Q${point(1.45,2.48)} ${point(1.42,2.18)}`,
    `L${point(1.38,.45)}`,
    `L${point(2.48,.38)}`,
    `L${point(2.56,1.16)}`,
    `Q${point(2.58,1.48)} ${point(2.90,1.48)}`,
    `L${point(3.18,1.48)}`,
    `Q${point(3.48,1.48)} ${point(3.45,1.18)}`,
    `L${point(3.45,-1.18)}`,
    `Q${point(3.48,-1.48)} ${point(3.18,-1.48)}`,
    `L${point(2.90,-1.48)}`,
    `Q${point(2.58,-1.48)} ${point(2.56,-1.16)}`,
    `L${point(2.48,-.38)}`,
    `L${point(1.38,-.45)}`,
    `L${point(1.42,-2.18)}`,
    `Q${point(1.45,-2.48)} ${point(1.18,-2.48)}`,
    `L${point(.88,-2.48)}`,
    `Q${point(.60,-2.48)} ${point(.58,-2.18)}`,
    `L${point(.52,-.43)}`,
    `C${point(.18,-.34)} ${point(-.28,-.16)} ${point(-.46,0)} Z`
  ].join(' ');
}
function positionPlaneOverlay(svg){
  const board=svg.parentElement,cells=board?.querySelectorAll('.cell');if(!cells||cells.length<100)return;
  const first=cells[0],last=cells[99];
  svg.style.left=`${first.offsetLeft}px`;svg.style.top=`${first.offsetTop}px`;
  svg.style.width=`${last.offsetLeft+last.offsetWidth-first.offsetLeft}px`;svg.style.height=`${last.offsetTop+last.offsetHeight-first.offsetTop}px`;
}
function renderPlaneOutlines(target,planes,{destroyed=new Set(),guess=false,draft=false,invalid=false,allowInvalid=false}={}){
  const board=$(target)?.querySelector('.board');if(!board||!planes?.length)return;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('plane-overlay');svg.setAttribute('viewBox','0 0 10 10');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
  planes.forEach((plane,index)=>{
    if(!allowInvalid&&!shape(plane))return;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',planeOutlinePath(plane));
    path.classList.add('plane-outline',`plane-${index%4}`);
    if(destroyed.has(index))path.classList.add('destroyed-outline');if(guess)path.classList.add('guess-outline');if(draft)path.classList.add('draft-outline');if(invalid)path.classList.add('invalid-outline');
    svg.appendChild(path);
  });
  board.appendChild(svg);positionPlaneOverlay(svg);
}
window.addEventListener('resize',()=>requestAnimationFrame(()=>document.querySelectorAll('.plane-overlay').forEach(positionPlaneOverlay)));
function paintPlanes(el,n,planes){
  for(const p of planes){const s=shape(p);if(!s)continue;if(s.head===n){el.classList.add('head');el.textContent=headSymbol(p);return}if(s.cells.includes(n)){el.classList.add('body');return}}
}
function paintShots(el,n,shots){
  const shot=shots.find(s=>s.cell===n);if(!shot)return false;
  el.classList.add(shot.result);el.textContent=shot.result==='miss'?'×':shot.result==='hit'?'●':'✕';return true;
}
function paintGuesses(el,n,guesses){
  for(const guess of guesses){const s=shape(guess);if(!s)continue;if(s.head===n){el.classList.add('guess-head');return}if(s.cells.includes(n)){el.classList.add('guess-body');return}}
}
function paintOwnDamage(el,n,planes,incoming){
  const destroyed=destroyedPlaneIds(incoming);
  let planeIndex=-1,planeShape=null;
  for(let i=0;i<planes.length;i++){const s=shape(planes[i]);if(s?.cells.includes(n)){planeIndex=i;planeShape=s;break}}
  if(planeIndex>=0){
    if(destroyed.has(planeIndex)){el.classList.add('destroyed');if(planeShape.head===n)el.textContent='✕'}
    else if(planeShape.head===n){el.classList.add('head');el.textContent=headSymbol(planes[planeIndex])}
    else el.classList.add('body');
  }
  const shot=incoming.find(s=>s.cell===n);if(!shot)return;
  if(shot.result==='miss'){el.classList.add('miss');el.textContent='×'}
  else if(destroyed.has(planeIndex)){el.classList.add('destroyed');el.textContent=shot.result==='kill'?'✕':'●'}
  else{el.classList.add(shot.result);el.textContent=shot.result==='kill'?'✕':'●'}
}
function draftPlacementStatus(planes,holder){
  const draft=holder.draftPlane;if(!draft)return {valid:false,reason:''};
  const draftShape=shape(draft);if(!draftShape)return {valid:false,reason:'飞机超出棋盘'};
  const others=planes.filter((_,index)=>index!==holder.draftIndex),used=new Set(others.flatMap(p=>shape(p)?.cells||[]));
  if(draftShape.cells.some(cell=>used.has(cell)))return {valid:false,reason:'飞机与其他飞机重叠'};
  return {valid:true,reason:''};
}
function paintDraftPlane(el,n,draft,valid,guess=false){
  const cells=planeCoordinates(draft).filter(({x,y})=>x>=0&&x<10&&y>=0&&y<10).map(({x,y})=>y*10+x);if(!cells.includes(n))return;
  el.classList.add(n===draft.y*10+draft.x?'draft-head':'draft-body');if(guess)el.classList.add('guess-draft');if(!valid)el.classList.add('draft-invalid');if(n===draft.y*10+draft.x)el.textContent=headSymbol(draft);
}
function syncPlacementControls(prefix,planes,holder,max){
  const hasDraft=!!holder.draftPlane,{valid,reason}=draftPlacementStatus(planes,holder),selection=$(`${prefix}Selection`);
  $(`${prefix}RotateLeft`).disabled=!hasDraft;$(`${prefix}RotateRight`).disabled=!hasDraft;$(`${prefix}ConfirmPlane`).disabled=!valid;$(`${prefix}CancelPlane`).disabled=!hasDraft;$(`${prefix}Delete`).disabled=!(hasDraft&&holder.draftIndex>=0);
  $(`${prefix}ConfirmPlane`).textContent=holder.draftIndex>=0?'✓ 保存调整':'✓ 确认此飞机';selection.classList.toggle('invalid-text',hasDraft&&!valid);
  if(!hasDraft)selection.textContent=planes.length>=max?`已放置 ${max} 架；点击任意飞机可重新调整`:`点击棋盘设置第 ${planes.length+1} 架飞机的机头（默认向下）`;
  else if(!valid)selection.textContent=`⚠️ ${reason}：请移动机头或旋转`;
  else selection.textContent=holder.draftIndex>=0?`第 ${holder.draftIndex+1} 架位置有效：请保存调整`:'位置有效：可旋转或确认此飞机';
}
function handlePlacementCell(planes,holder,max,n,x,y,rerender){
  if(holder.draftPlane){holder.draftPlane={...holder.draftPlane,x,y};message('');rerender();return}
  const hit=planeAtCell(planes,n);
  if(hit>=0){holder.draftPlane={...planes[hit]};holder.draftIndex=hit;message(`正在调整第 ${hit+1} 架飞机`);rerender();return}
  if(planes.length>=max){message('已放满飞机；点击任意飞机可重新调整');return}
  holder.draftPlane={x,y,dir:'U'};holder.draftIndex=-1;message('');rerender();
}
function placementGrid(target,planes,holder,max,rerender){
  const {valid}=draftPlacementStatus(planes,holder),visiblePlanes=holder.draftIndex>=0?planes.filter((_,index)=>index!==holder.draftIndex):planes;
  grid(target,(el,n,x,y)=>{paintPlanes(el,n,visiblePlanes);if(holder.draftPlane)paintDraftPlane(el,n,holder.draftPlane,valid);el.onclick=()=>handlePlacementCell(planes,holder,max,n,x,y,rerender)});
  renderPlaneOutlines(target,visiblePlanes);
  if(holder.draftPlane)renderPlaneOutlines(target,[holder.draftPlane],{draft:true,invalid:!valid,allowInvalid:true});
}
function rotateDraftPlane(holder,step,rerender){
  if(!holder.draftPlane)return;const dirs=['U','R','D','L'],current=holder.draftPlane.dir,next=dirs[(dirs.indexOf(current)+step+4)%4];holder.draftPlane={...holder.draftPlane,dir:next};message('');rerender();
}
function confirmDraftPlane(planes,holder,rerender){
  if(!draftPlacementStatus(planes,holder).valid)return;
  if(holder.draftIndex>=0)planes[holder.draftIndex]={...holder.draftPlane};else planes.push({...holder.draftPlane});
  holder.draftPlane=null;holder.draftIndex=-1;message('飞机已确认');rerender();
}
function cancelDraftPlane(holder,rerender){holder.draftPlane=null;holder.draftIndex=-1;message('');rerender()}
function deleteEditingPlane(planes,holder,rerender){
  if(holder.draftIndex<0)return;planes.splice(holder.draftIndex,1);holder.draftPlane=null;holder.draftIndex=-1;message('飞机已删除');rerender();
}
function guessDraftStatus(guesses,holder){
  const draft=holder.guessDraftPlane;if(!draft)return {valid:false,reason:''};
  const draftShape=shape(draft);if(!draftShape)return {valid:false,reason:'推测飞机超出棋盘'};
  const others=guesses.filter((_,index)=>index!==holder.guessDraftIndex),used=new Set(others.flatMap(guess=>shape(guess)?.cells||[]));
  if(draftShape.cells.some(cell=>used.has(cell)))return {valid:false,reason:'推测飞机与其他推测重叠'};
  return {valid:true,reason:''};
}
function guessDraftView(guesses,holder){
  const status=guessDraftStatus(guesses,holder),visible=holder.guessDraftIndex>=0?guesses.filter((_,index)=>index!==holder.guessDraftIndex):guesses;
  return {...status,visible};
}
function syncGuessControls(prefix,guesses,holder,max,active){
  const hasDraft=!!holder.guessDraftPlane,{valid,reason}=guessDraftStatus(guesses,holder),selection=$(`${prefix}Selection`);
  $(`${prefix}Editor`).classList.toggle('hide',!active);$(`${prefix}RotateLeft`).disabled=!hasDraft;$(`${prefix}RotateRight`).disabled=!hasDraft;$(`${prefix}Confirm`).disabled=!valid;$(`${prefix}Cancel`).disabled=!hasDraft;$(`${prefix}Delete`).disabled=!(hasDraft&&holder.guessDraftIndex>=0);
  $(`${prefix}Confirm`).textContent=holder.guessDraftIndex>=0?'✓ 保存调整':'✓ 确认推测';$(`${prefix}Undo`).disabled=guesses.length===0||hasDraft;$(`${prefix}Clear`).disabled=guesses.length===0&&!hasDraft;selection.classList.toggle('invalid-text',hasDraft&&!valid);
  if(!hasDraft)selection.textContent=guesses.length>=max?`已标记 ${max} 架推测飞机；点击任意一架可重新调整`:`点击棋盘设置第 ${guesses.length+1} 架推测飞机的机头（默认向下）`;
  else if(!valid)selection.textContent=`⚠️ ${reason}：请移动机头或旋转`;
  else selection.textContent=holder.guessDraftIndex>=0?`第 ${holder.guessDraftIndex+1} 架推测位置有效：请保存调整`:'推测位置有效：可旋转或确认';
}
function handleGuessCell(guesses,holder,max,n,x,y,rerender){
  if(holder.guessDraftPlane){holder.guessDraftPlane={...holder.guessDraftPlane,x,y};message('');rerender();return}
  const hit=planeAtCell(guesses,n);
  if(hit>=0){holder.guessDraftPlane={...guesses[hit]};holder.guessDraftIndex=hit;message(`正在调整第 ${hit+1} 架推测飞机`);rerender();return}
  if(guesses.length>=max){message(`最多标记 ${max} 架推测飞机；可点击已有推测进行调整`);return}
  holder.guessDraftPlane={x,y,dir:'U'};holder.guessDraftIndex=-1;message('');rerender();
}
function rotateGuessDraft(holder,step,rerender){
  if(!holder.guessDraftPlane)return;const dirs=['U','R','D','L'],current=holder.guessDraftPlane.dir,next=dirs[(dirs.indexOf(current)+step+4)%4];holder.guessDraftPlane={...holder.guessDraftPlane,dir:next};message('');rerender();
}
function confirmGuessDraft(guesses,holder,persist,rerender){
  if(!guessDraftStatus(guesses,holder).valid)return;
  if(holder.guessDraftIndex>=0)guesses[holder.guessDraftIndex]={...holder.guessDraftPlane};else guesses.push({...holder.guessDraftPlane});
  holder.guessDraftPlane=null;holder.guessDraftIndex=-1;if(persist)persist();message('推测飞机已确认');rerender();
}
function cancelGuessDraft(holder,rerender){holder.guessDraftPlane=null;holder.guessDraftIndex=-1;message('');rerender()}
function deleteGuessDraft(guesses,holder,persist,rerender){
  if(holder.guessDraftIndex<0)return;guesses.splice(holder.guessDraftIndex,1);holder.guessDraftPlane=null;holder.guessDraftIndex=-1;if(persist)persist();message('推测飞机已删除');rerender();
}
function toggleGuessMode(holder,rerender){
  holder.guessMode=!holder.guessMode;if(!holder.guessMode){holder.guessDraftPlane=null;holder.guessDraftIndex=-1}message('');rerender();
}
function updateTurnCue(id,on,key){
  const el=$(id);el.classList.toggle('your-turn',on);
  if(on&&cueState[id]!==key){cueState[id]=key;if(document.visibilityState==='visible'&&navigator.vibrate)navigator.vibrate([120,60,120])}
  if(!on)cueState[id]=null;
  if(on)document.title='🎯 轮到你攻击 · 空战棋盘';
  else if(!Object.values(cueState).some(Boolean))document.title='✈️ 空战棋盘';
}
function onlineGuessKey(round=online.state?.round||1){return `airplane-online-guesses-${online.room}-${online.seat}-${round}`}
function loadOnlineGuesses(){
  const key=onlineGuessKey(),legacyKey=`airplane-online-guesses-${online.room}-${online.seat}`;
  let raw=localStorage.getItem(key);if(raw===null&&(online.state?.round||1)===1)raw=localStorage.getItem(legacyKey);
  let saved=[];try{saved=JSON.parse(raw||'[]')}catch{localStorage.removeItem(key)}
  if(!Array.isArray(saved))return [];
  const valid=[];
  for(const guess of saved){
    if(valid.length>=4)break;
    if(guess&&Number.isInteger(guess.x)&&Number.isInteger(guess.y)&&['U','R','D','L'].includes(guess.dir)&&validPlane(guess,valid))valid.push(guess);
  }
  return valid;
}
function saveOnlineGuesses(){localStorage.setItem(onlineGuessKey(),JSON.stringify(online.guesses))}
function renderHistory(target,shots,empty='暂无记录'){
  $(target).innerHTML=shots.map((shot,index)=>`<div>第${index+1}轮 · ${coord(shot.cell)} · ${{miss:'未击中',hit:'命中',kill:'击毁'}[shot.result]}</div>`).join('')||`<div>${empty}</div>`;
}
function showHome(){
  $('home').classList.remove('hide');$('onlineGame').classList.add('hide');$('localGame').classList.add('hide');message('');
  updateTurnCue('onlineStatus',false,'');updateTurnCue('localStatus',false,'');
  if(timer){clearInterval(timer);timer=null}
}

function setMode(mode){
  activeMode=mode;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('secondary',b.dataset.mode!==mode));
  $('onlineSetup').classList.toggle('hide',mode!=='online');$('localSetup').classList.toggle('hide',mode==='online');
  if(mode!=='online'){
    $('localModeTitle').textContent=mode==='ai'?'人机对战':'同机双人';
    $('aiDifficultyControl').classList.toggle('hide',mode!=='ai');
    updateLocalModeHelp();
  }
}
function updateLocalModeHelp(){
  if(activeMode!=='ai'){$('localModeHelp').textContent='两位玩家依次秘密布阵，每回合攻击后遮住棋盘并传递手机。';return}
  const difficulty=$('aiDifficulty').value,descriptions={easy:'休闲模式随机选择未攻击格。',normal:'标准模式会根据命中与未击中结果追踪可能机位。',hard:'困难模式会抽样符合全部已知结果的完整布局，优先攻击高概率机头。'};
  $('localModeHelp').textContent=`${descriptions[difficulty]} 电脑不会读取你的隐藏飞机布局。`;
}
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode));
$('aiDifficulty').onchange=updateLocalModeHelp;

async function api(action,data={}){
  if(!apiBase||apiBase.includes('REPLACE_ME'))throw Error('联网服务尚未完成部署');
  const response=await fetch(`${apiBase}/api/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,room:online.room,token:online.token})});
  let json;try{json=await response.json()}catch{throw Error('网络连接失败')}
  if(!response.ok)throw Error(json.error||'操作失败');return json;
}
function inviteUrl(room){const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('room',room);return url.toString()}
function onlineSession(session){
  online.room=session.room;online.token=session.token;online.seat=session.seat;online.planes=[];online.state=null;online.ready=false;online.busy=false;online.guessMode=false;online.guesses=[];online.draftPlane=null;online.draftIndex=-1;online.guessDraftPlane=null;online.guessDraftIndex=-1;
  localStorage.setItem(sessionKey,JSON.stringify({room:online.room,token:online.token,seat:online.seat}));
  const url=new URL(location.href);url.search='';url.searchParams.set('room',online.room);history.replaceState(null,'',url);
  $('home').classList.add('hide');$('onlineGame').classList.remove('hide');$('localGame').classList.add('hide');
  if(timer)clearInterval(timer);refreshOnline();timer=setInterval(refreshOnline,1500);
}
function applyOnlineState(next){
  const first=!online.state,previousRound=online.state?.round||1,nextRound=next.round||1,roundChanged=!first&&previousRound!==nextRound;
  online.state=next;online.ready=!!next.players[online.seat].ready;
  if(first||roundChanged)online.guesses=loadOnlineGuesses();
  if(roundChanged){
    online.planes=[];online.draftPlane=null;online.draftIndex=-1;online.guessMode=false;online.guessDraftPlane=null;online.guessDraftIndex=-1;
  }
  if(online.ready)online.planes=next.myPlanes||[];
  return roundChanged;
}
function onlinePlacementGrid(){
  placementGrid('onlineBoard',online.planes,online,online.state.count,renderOnline);
}
function renderOnline(){
  const state=online.state;if(!state)return;
  const players=state.players,playing=state.status==='playing',done=state.status==='done',me=players[online.seat],other=players[1-online.seat];
  if(!playing&&online.guessDraftPlane){online.guessDraftPlane=null;online.guessDraftIndex=-1;online.guessMode=false}
  $('onlineHeading').textContent=`房间 ${online.room} · ${online.seat===0?'玩家1':'玩家2'} · 第${state.round||1}局`;$('roomText').textContent=`房间号：${online.room}`;
  $('shareRow').classList.toggle('hide',state.status!=='waiting');$('onlinePlacement').classList.toggle('hide',online.ready||state.status!=='waiting');
  $('onlineReady').disabled=online.planes.length!==state.count||!!online.draftPlane;$('onlineReady').textContent=`完成布阵（${online.planes.length}/${state.count}）`;
  syncPlacementControls('online',online.planes,online,state.count);
  const myTurn=playing&&state.turn===online.seat;
  const label=done?(me.rematch&&!other.rematch?'✓ 已确认再来一局，等待对方':state.winner===online.seat?'🏆 你赢了！':'对方获胜'):playing?(myTurn?(online.guessMode?'✏️ 推测标记中：关闭后可发起攻击':'🎯 轮到你攻击：点击目标坐标'):'⏳ 等待对方攻击'):(online.ready?'已准备，等待对方完成布阵':other.joined?'请放置飞机并点击完成布阵':'等待另一位玩家加入房间');
  $('onlineStatus').textContent=`${label} · 机头击毁 ${me.kills}/${state.count}，对方击毁 ${other.kills}/${state.count}`;
  const myShots=state.shots||[],incoming=state.incoming||[];
  $('onlineAttackHeader').classList.toggle('hide',!playing);
  $('onlineOwnPanel').classList.toggle('hide',!(playing||done));
  $('onlineGuessToggle').classList.toggle('active',online.guessMode);
  $('onlineGuessToggle').setAttribute('aria-pressed',String(online.guessMode));
  $('onlineGuessToggle').textContent=`✏️ 推测标记：${online.guessMode?'开':'关'}`;
  syncGuessControls('onlineGuess',online.guesses,online,state.count,playing&&online.guessMode);
  $('onlineBoard').classList.toggle('guess-active',playing&&online.guessMode);
  updateTurnCue('onlineStatus',myTurn,`${online.room}:${state.updated}`);
  if(state.status==='waiting'&&!online.ready)onlinePlacementGrid();
  else if(playing||done){
    const guessView=guessDraftView(online.guesses,online);
    grid('onlineBoard',(el,n,x,y)=>{
      paintGuesses(el,n,guessView.visible);const alreadyShot=paintShots(el,n,myShots);if(playing&&online.guessMode&&online.guessDraftPlane)paintDraftPlane(el,n,online.guessDraftPlane,guessView.valid,true);
      if(playing&&online.guessMode){el.onclick=()=>handleGuessCell(online.guesses,online,state.count,n,x,y,renderOnline);return}
      if(alreadyShot){el.disabled=true;return}
      el.disabled=done||!myTurn;el.onclick=async()=>{if(online.busy)return;online.busy=true;try{applyOnlineState(await api('shot',{cell:n}));renderOnline()}catch(e){message(e.message)}finally{online.busy=false;renderOnline()}};
    });
    renderPlaneOutlines('onlineBoard',guessView.visible,{guess:true});
    if(playing&&online.guessMode&&online.guessDraftPlane)renderPlaneOutlines('onlineBoard',[online.guessDraftPlane],{guess:true,draft:true,invalid:!guessView.valid,allowInvalid:true});
  }else{
    grid('onlineBoard',(el,n)=>{paintPlanes(el,n,online.planes);el.disabled=true});renderPlaneOutlines('onlineBoard',online.planes);
  }
  if(playing||done){
    grid('onlineOwnBoard',(el,n)=>{paintOwnDamage(el,n,online.planes,incoming);el.disabled=true});
    renderPlaneOutlines('onlineOwnBoard',online.planes,{destroyed:destroyedPlaneIds(incoming)});
  }
  renderHistory('onlineMyHistory',myShots);renderHistory('onlineTheirHistory',incoming);
  $('onlineReveal').classList.toggle('hide',!done);if(done&&state.opponentPlanes){grid('onlineEnemyBoard',(el,n)=>{paintOwnDamage(el,n,state.opponentPlanes,myShots);el.disabled=true});renderPlaneOutlines('onlineEnemyBoard',state.opponentPlanes,{destroyed:destroyedPlaneIds(myShots)})}
  $('onlineResult').textContent=done?'游戏结束：双方完整攻击历史已保留，对方布局已公开。':playing?'橙色=命中机身，红色=击毁机头，灰色=未击中。':'';
  $('onlineRematchRow').classList.toggle('hide',!done);
  $('onlineRematch').disabled=!done||online.busy||me.rematch;
  $('onlineRematch').textContent=me.rematch?'✓ 已确认再来一局':'↻ 再来一局';
  $('onlineRematchText').textContent=me.rematch&&!other.rematch?'等待对方确认…':!me.rematch&&other.rematch?'对方已确认，点击即可开始下一局':'双方确认后在原房间重新布阵';
}
async function refreshOnline(){
  if(!online.token)return;
  try{const next=await api('state');const changed=JSON.stringify(next)!==JSON.stringify(online.state),roundChanged=applyOnlineState(next);if(changed)renderOnline();message(roundChanged?'新一局开始，请重新布阵':'')}
  catch(e){message(`连接中断：${e.message}`)}
}
$('create').onclick=async()=>{try{const session=await api('create',{count:Number($('onlineCount').value)});onlineSession(session)}catch(e){message(e.message)}};
$('join').onclick=async()=>{try{online.room=$('roomInput').value.trim();const session=await api('join');onlineSession(session)}catch(e){message(e.message)}};
$('onlineUndo').onclick=()=>{online.draftPlane=null;online.draftIndex=-1;online.planes.pop();renderOnline()};
$('onlineRandom').onclick=()=>{try{online.planes=randomPlanes(online.state.count);online.draftPlane=null;online.draftIndex=-1;renderOnline()}catch(e){message(e.message)}};
$('onlineRotateLeft').onclick=()=>rotateDraftPlane(online,-1,renderOnline);
$('onlineRotateRight').onclick=()=>rotateDraftPlane(online,1,renderOnline);
$('onlineConfirmPlane').onclick=()=>confirmDraftPlane(online.planes,online,renderOnline);
$('onlineCancelPlane').onclick=()=>cancelDraftPlane(online,renderOnline);
$('onlineDelete').onclick=()=>deleteEditingPlane(online.planes,online,renderOnline);
$('onlineReady').onclick=async()=>{if(online.planes.length!==online.state.count||online.draftPlane)return;try{applyOnlineState(await api('ready',{planes:online.planes}));renderOnline()}catch(e){message(e.message)}};
$('onlineRematch').onclick=async()=>{if(online.busy)return;online.busy=true;try{applyOnlineState(await api('rematch'));renderOnline()}catch(e){message(e.message)}finally{online.busy=false;renderOnline()}};
$('onlineGuessToggle').onclick=()=>toggleGuessMode(online,renderOnline);
$('onlineGuessRotateLeft').onclick=()=>rotateGuessDraft(online,-1,renderOnline);
$('onlineGuessRotateRight').onclick=()=>rotateGuessDraft(online,1,renderOnline);
$('onlineGuessConfirm').onclick=()=>confirmGuessDraft(online.guesses,online,saveOnlineGuesses,renderOnline);
$('onlineGuessCancel').onclick=()=>cancelGuessDraft(online,renderOnline);
$('onlineGuessDelete').onclick=()=>deleteGuessDraft(online.guesses,online,saveOnlineGuesses,renderOnline);
$('onlineGuessUndo').onclick=()=>{if(online.guessDraftPlane)return;online.guesses.pop();saveOnlineGuesses();renderOnline()};
$('onlineGuessClear').onclick=()=>{online.guesses=[];online.guessDraftPlane=null;online.guessDraftIndex=-1;saveOnlineGuesses();renderOnline()};
$('share').onclick=async()=>{const url=inviteUrl(online.room);try{if(navigator.share)await navigator.share({title:'加入空战棋盘',text:`房间号：${online.room}`,url});else{await navigator.clipboard.writeText(url);message('邀请链接已复制，发给对方即可')}}catch(e){if(e.name!=='AbortError')prompt('复制邀请链接',url)}};
$('onlineHome').onclick=showHome;

function killsBy(seat){return local.shots.filter(s=>s.by===seat&&s.result==='kill').length}
function resolveShot(attacker,cell){
  const target=local.players[1-attacker];let result='miss',planeId=-1;
  for(let i=0;i<target.planes.length;i++){const s=shape(target.planes[i]);if(s.cells.includes(cell)){planeId=i;result=s.head===cell?'kill':'hit';break}}
  local.shots.push({by:attacker,cell,result,planeId:result==='kill'?planeId:undefined,n:local.shots.length+1});
  if(killsBy(attacker)===local.count){local.phase='done';local.winner=attacker}else local.turn=1-attacker;
}
function beginHandoff(title,text,next){local.awaitingPass=true;local.handoffNext=next;local.guessMode=false;local.guessDraftPlane=null;local.guessDraftIndex=-1;$('localStatus').textContent=`📱 ${title}`;$('handoffTitle').textContent=title;$('handoffText').textContent=text;renderLocal()}
function createLocalState(mode,count,difficulty,round=1){
  return {mode,count,difficulty,round,phase:'placing',placingSeat:0,players:[{planes:[]},{planes:mode==='ai'?randomPlanes(count):[]}],shots:[],turn:0,winner:null,awaitingPass:false,handoffNext:null,busy:false,guesses:[[],[]],guessMode:false,draftPlane:null,draftIndex:-1,guessDraftPlane:null,guessDraftIndex:-1};
}
function startLocal(){
  const mode=activeMode==='same'?'same':'ai',count=Number($('localCount').value),difficulty=mode==='ai'?$('aiDifficulty').value:null;
  local=createLocalState(mode,count,difficulty);
  $('home').classList.add('hide');$('onlineGame').classList.add('hide');$('localGame').classList.remove('hide');message('');renderLocal();
}
function restartLocal(){
  if(!local||local.phase!=='done')return;
  local=createLocalState(local.mode,local.count,local.difficulty,(local.round||1)+1);message('新一局开始，请重新布阵');renderLocal();
}
function localPlacementGrid(){
  const planes=local.players[local.placingSeat].planes;
  placementGrid('localBoard',planes,local,local.count,renderLocal);
}
function renderLocal(){
  if(!local)return;
  const ai=local.mode==='ai',placing=local.phase==='placing',done=local.phase==='done';
  $('localHeading').textContent=`${ai?`🤖 人机对战 · ${aiDifficultyLabel(local.difficulty)}`:'👥 同机双人'} · 第${local.round||1}局`;
  $('handoff').classList.toggle('hide',!local.awaitingPass);$('localPlayArea').classList.toggle('hide',local.awaitingPass);
  if(local.awaitingPass){updateTurnCue('localStatus',false,'');return}
  $('localPlacement').classList.toggle('hide',!placing);
  $('localAttackHeader').classList.toggle('hide',placing||done);
  $('localOwnPanel').classList.toggle('hide',placing);
  $('localRematchRow').classList.toggle('hide',!done);
  if(placing){
    updateTurnCue('localStatus',false,'');$('localBoard').classList.remove('guess-active');
    const p=local.players[local.placingSeat].planes;
    $('localReady').disabled=p.length!==local.count||!!local.draftPlane;$('localReady').textContent=`完成布阵（${p.length}/${local.count}）`;
    syncPlacementControls('local',p,local,local.count);
    $('localStatus').textContent=`${ai?'你':`玩家${local.placingSeat+1}`}正在秘密布阵`;
    localPlacementGrid();
  }else{
    const current=local.turn,viewer=ai?0:current,outgoing=local.shots.filter(s=>s.by===viewer),incoming=local.shots.filter(s=>s.by!==viewer),guesses=local.guesses[viewer];
    const humanTurn=!done&&!local.busy;
    const label=done?(local.winner===0?(ai?'🏆 你赢了！':'🏆 玩家1获胜！'):(ai?'电脑获胜':'🏆 玩家2获胜')):(ai?(local.busy?'🧠 电脑正在分析棋盘':local.guessMode?'✏️ 推测标记中：关闭后可发起攻击':'🎯 轮到你攻击'):(local.guessMode?`✏️ 玩家${current+1}正在标记推测`:`🎯 玩家${current+1}攻击`));
    $('localStatus').textContent=`${label} · 玩家1击毁 ${killsBy(0)}/${local.count}，${ai?'电脑':'玩家2'}击毁 ${killsBy(1)}/${local.count}`;
    $('localGuessToggle').classList.toggle('active',local.guessMode);$('localGuessToggle').textContent=`✏️ 推测标记：${local.guessMode?'开':'关'}`;
    $('localGuessToggle').setAttribute('aria-pressed',String(local.guessMode));
    syncGuessControls('localGuess',guesses,local,local.count,local.guessMode&&!done);
    $('localBoard').classList.toggle('guess-active',local.guessMode&&!done);
    updateTurnCue('localStatus',humanTurn,`${viewer}:${local.shots.length}`);
    const guessView=guessDraftView(guesses,local);
    grid('localBoard',(el,n,x,y)=>{
      paintGuesses(el,n,guessView.visible);const alreadyShot=paintShots(el,n,outgoing);if(!done&&local.guessMode&&local.guessDraftPlane)paintDraftPlane(el,n,local.guessDraftPlane,guessView.valid,true);
      if(!done&&local.guessMode){el.onclick=()=>handleGuessCell(guesses,local,local.count,n,x,y,renderLocal);return}
      if(alreadyShot){el.disabled=true;return}
      el.disabled=done||local.busy;el.onclick=()=>localAttack(n);
    });
    renderPlaneOutlines('localBoard',guessView.visible,{guess:true});
    if(!done&&local.guessMode&&local.guessDraftPlane)renderPlaneOutlines('localBoard',[local.guessDraftPlane],{guess:true,draft:true,invalid:!guessView.valid,allowInvalid:true});
    grid('localOwnBoard',(el,n)=>{paintOwnDamage(el,n,local.players[viewer].planes,incoming);el.disabled=true});
    renderPlaneOutlines('localOwnBoard',local.players[viewer].planes,{destroyed:destroyedPlaneIds(incoming)});
  }
  const one=local.shots.filter(s=>s.by===0),two=local.shots.filter(s=>s.by===1);
  $('localHistoryOneTitle').textContent='玩家1攻击记录';$('localHistoryTwoTitle').textContent=`${ai?'电脑':'玩家2'}攻击记录`;
  renderHistory('localHistoryOne',one);renderHistory('localHistoryTwo',two);
  $('localReveal').classList.toggle('hide',!done);
  if(done){
    $('revealTitle0').textContent='玩家1布局';$('revealTitle1').textContent=`${ai?'电脑':'玩家2'}布局`;
    grid('localReveal0',(el,n)=>{paintOwnDamage(el,n,local.players[0].planes,two);el.disabled=true});
    grid('localReveal1',(el,n)=>{paintOwnDamage(el,n,local.players[1].planes,one);el.disabled=true});
    renderPlaneOutlines('localReveal0',local.players[0].planes,{destroyed:destroyedPlaneIds(two)});renderPlaneOutlines('localReveal1',local.players[1].planes,{destroyed:destroyedPlaneIds(one)});
  }
}
function localReady(){
  const planes=local.players[local.placingSeat].planes;if(planes.length!==local.count)return;
  if(local.draftPlane)return;
  if(local.mode==='same'&&local.placingSeat===0){local.placingSeat=1;local.draftPlane=null;local.draftIndex=-1;beginHandoff('请交给玩家2','棋盘已经遮住。玩家2拿到手机后点击继续，独立完成布阵。',()=>{local.phase='placing';renderLocal()});return}
  local.draftPlane=null;local.draftIndex=-1;
  local.phase='playing';local.turn=0;
  if(local.mode==='same')beginHandoff('请交给玩家1','双方布阵完成。玩家1拿到手机后点击继续并开始攻击。',renderLocal);else renderLocal();
}
function localAttack(cell){
  if(local.phase!=='playing'||local.busy||local.guessMode)return;
  const already=local.shots.some(s=>s.by===local.turn&&s.cell===cell);if(already)return;
  const attacker=local.turn;resolveShot(attacker,cell);
  if(local.phase==='done'){renderLocal();return}
  if(local.mode==='same'){beginHandoff(`请交给玩家${local.turn+1}`,`玩家${attacker+1}已完成攻击，结果已记录。下一位玩家拿到手机后继续。`,renderLocal);return}
  local.busy=true;renderLocal();
  setTimeout(()=>{const publicResults=local.shots.filter(s=>s.by===1).map(({cell,result})=>({cell,result})),cell=chooseAiTarget(publicResults,local.count,local.difficulty);if(cell!==null)resolveShot(1,cell);local.busy=false;renderLocal()},650);
}
$('startLocal').onclick=()=>{try{startLocal()}catch(e){message(e.message)}};
$('localUndo').onclick=()=>{const planes=local.players[local.placingSeat].planes;local.draftPlane=null;local.draftIndex=-1;planes.pop();renderLocal()};
$('localRandom').onclick=()=>{try{local.players[local.placingSeat].planes=randomPlanes(local.count);local.draftPlane=null;local.draftIndex=-1;renderLocal()}catch(e){message(e.message)}};
$('localRotateLeft').onclick=()=>rotateDraftPlane(local,-1,renderLocal);
$('localRotateRight').onclick=()=>rotateDraftPlane(local,1,renderLocal);
$('localConfirmPlane').onclick=()=>confirmDraftPlane(local.players[local.placingSeat].planes,local,renderLocal);
$('localCancelPlane').onclick=()=>cancelDraftPlane(local,renderLocal);
$('localDelete').onclick=()=>deleteEditingPlane(local.players[local.placingSeat].planes,local,renderLocal);
$('localReady').onclick=localReady;
$('localRematch').onclick=()=>{try{restartLocal()}catch(e){message(e.message)}};
$('localGuessToggle').onclick=()=>toggleGuessMode(local,renderLocal);
$('localGuessRotateLeft').onclick=()=>rotateGuessDraft(local,-1,renderLocal);
$('localGuessRotateRight').onclick=()=>rotateGuessDraft(local,1,renderLocal);
$('localGuessConfirm').onclick=()=>{const viewer=local.mode==='ai'?0:local.turn;confirmGuessDraft(local.guesses[viewer],local,null,renderLocal)};
$('localGuessCancel').onclick=()=>cancelGuessDraft(local,renderLocal);
$('localGuessDelete').onclick=()=>{const viewer=local.mode==='ai'?0:local.turn;deleteGuessDraft(local.guesses[viewer],local,null,renderLocal)};
$('localGuessUndo').onclick=()=>{if(local.guessDraftPlane)return;const viewer=local.mode==='ai'?0:local.turn;local.guesses[viewer].pop();renderLocal()};
$('localGuessClear').onclick=()=>{const viewer=local.mode==='ai'?0:local.turn;local.guesses[viewer]=[];local.guessDraftPlane=null;local.guessDraftIndex=-1;renderLocal()};
$('handoffContinue').onclick=()=>{const next=local.handoffNext;local.awaitingPass=false;local.handoffNext=null;if(next)next();else renderLocal()};
$('localHome').onclick=showHome;

setMode('online');
let saved=null;try{saved=JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{localStorage.removeItem(sessionKey)}
const roomFromUrl=new URLSearchParams(location.search).get('room');
if(saved?.room&&saved?.token&&(!roomFromUrl||saved.room===roomFromUrl))onlineSession(saved);
else if(/^\d{6}$/.test(roomFromUrl||'')){$('roomInput').value=roomFromUrl;setMode('online')}
