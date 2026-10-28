const $=id=>document.getElementById(id);
const letters='ABCDEFGHIJ';
const apiBase=(document.querySelector('meta[name="api-base"]')?.content||'').replace(/\/$/,'');
const sessionKey='airplane-online-session-v2';
let activeMode='online';
let timer=null;
let online={room:'',token:'',seat:-1,planes:[],state:null,ready:false,busy:false,guesses:[],guessMode:false};
let local=null;
const cueState={};

function message(text=''){$('message').textContent=text}
function coord(n){return letters[n%10]+(Math.floor(n/10)+1)}
function shape(p){
  let dx=0,dy=0;
  if(p.dir==='U')dy=-1;if(p.dir==='D')dy=1;if(p.dir==='L')dx=-1;if(p.dir==='R')dx=1;
  const sx=-dy,sy=dx,cells=[];
  for(const [f,s] of [[0,0],[1,-2],[1,-1],[1,0],[1,1],[1,2],[2,0],[3,-1],[3,0],[3,1]]){
    const x=p.x+f*dx+s*sx,y=p.y+f*dy+s*sy;
    if(x<0||x>9||y<0||y>9)return null;
    cells.push(y*10+x);
  }
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
function paintPlanes(el,n,planes){
  for(const p of planes){const s=shape(p);if(!s)continue;if(s.head===n){el.classList.add('head');el.textContent='▲';return}if(s.cells.includes(n)){el.classList.add('body');return}}
}
function paintShots(el,n,shots){
  const shot=shots.find(s=>s.cell===n);if(!shot)return false;
  el.classList.add(shot.result);el.textContent=shot.result==='miss'?'×':shot.result==='hit'?'●':'✕';return true;
}
function paintGuesses(el,n,guesses){
  for(const guess of guesses){const s=shape(guess);if(!s)continue;if(s.head===n){el.classList.add('guess-head');return}if(s.cells.includes(n)){el.classList.add('guess-body');return}}
}
function paintOwnDamage(el,n,planes,incoming){
  const destroyed=new Set(incoming.filter(s=>s.result==='kill'&&Number.isInteger(s.planeId)).map(s=>s.planeId));
  let planeIndex=-1,planeShape=null;
  for(let i=0;i<planes.length;i++){const s=shape(planes[i]);if(s?.cells.includes(n)){planeIndex=i;planeShape=s;break}}
  if(planeIndex>=0){
    if(destroyed.has(planeIndex)){el.classList.add('destroyed');if(planeShape.head===n)el.textContent='✕'}
    else if(planeShape.head===n){el.classList.add('head');el.textContent='▲'}
    else el.classList.add('body');
  }
  const shot=incoming.find(s=>s.cell===n);if(!shot)return;
  if(shot.result==='miss'){el.classList.add('miss');el.textContent='×'}
  else if(destroyed.has(planeIndex)){el.classList.add('destroyed');el.textContent=shot.result==='kill'?'✕':'●'}
  else{el.classList.add(shot.result);el.textContent=shot.result==='kill'?'✕':'●'}
}
function editGuess(guesses,cell,x,y,dir,max){
  const existing=guesses.findIndex(guess=>shape(guess)?.cells.includes(cell));
  if(existing>=0){guesses.splice(existing,1);return true}
  if(guesses.length>=max){message(`最多标记 ${max} 架推测飞机`);return false}
  const candidate={x,y,dir};
  if(!validPlane(candidate,guesses)){message('推测飞机越界或与已有推测重叠');return false}
  guesses.push(candidate);message('');return true;
}
function updateTurnCue(id,on,key){
  const el=$(id);el.classList.toggle('your-turn',on);
  if(on&&cueState[id]!==key){cueState[id]=key;if(document.visibilityState==='visible'&&navigator.vibrate)navigator.vibrate([120,60,120])}
  if(!on)cueState[id]=null;
  if(on)document.title='🎯 轮到你攻击 · 空战棋盘';
  else if(!Object.values(cueState).some(Boolean))document.title='✈️ 空战棋盘';
}
function onlineGuessKey(){return `airplane-online-guesses-${online.room}-${online.seat}`}
function loadOnlineGuesses(){
  let saved=[];try{saved=JSON.parse(localStorage.getItem(onlineGuessKey())||'[]')}catch{localStorage.removeItem(onlineGuessKey())}
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
  $(target).innerHTML=shots.map(s=>`<div>第${s.n}次 · ${coord(s.cell)} · ${{miss:'未击中',hit:'命中',kill:'击毁'}[s.result]}</div>`).join('')||`<div>${empty}</div>`;
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
    $('localModeHelp').textContent=mode==='ai'?'你布阵后与电脑轮流攻击；电脑会从未攻击的格子中选择目标。':'两位玩家依次秘密布阵，每回合攻击后遮住棋盘并传递手机。';
  }
}
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode));

async function api(action,data={}){
  if(!apiBase||apiBase.includes('REPLACE_ME'))throw Error('联网服务尚未完成部署');
  const response=await fetch(`${apiBase}/api/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,room:online.room,token:online.token})});
  let json;try{json=await response.json()}catch{throw Error('网络连接失败')}
  if(!response.ok)throw Error(json.error||'操作失败');return json;
}
function inviteUrl(room){const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('room',room);return url.toString()}
function onlineSession(session){
  online.room=session.room;online.token=session.token;online.seat=session.seat;online.planes=[];online.state=null;online.ready=false;online.busy=false;online.guessMode=false;online.guesses=loadOnlineGuesses();
  localStorage.setItem(sessionKey,JSON.stringify({room:online.room,token:online.token,seat:online.seat}));
  const url=new URL(location.href);url.search='';url.searchParams.set('room',online.room);history.replaceState(null,'',url);
  $('home').classList.add('hide');$('onlineGame').classList.remove('hide');$('localGame').classList.add('hide');
  if(timer)clearInterval(timer);refreshOnline();timer=setInterval(refreshOnline,1500);
}
function onlinePlacementGrid(){
  grid('onlineBoard',(el,n,x,y)=>{paintPlanes(el,n,online.planes);el.onclick=()=>{if(online.planes.length>=online.state.count)return;const p={x,y,dir:$('onlineDir').value};if(!validPlane(p,online.planes)){message('位置无效：飞机越界或与其他飞机重叠');return}online.planes.push(p);message('');renderOnline()}});
}
function renderOnline(){
  const state=online.state;if(!state)return;
  const players=state.players,playing=state.status==='playing',done=state.status==='done',me=players[online.seat],other=players[1-online.seat];
  $('onlineHeading').textContent=`房间 ${online.room} · ${online.seat===0?'玩家1':'玩家2'}`;$('roomText').textContent=`房间号：${online.room}`;
  $('shareRow').classList.toggle('hide',state.status!=='waiting');$('onlinePlacement').classList.toggle('hide',online.ready||state.status!=='waiting');
  $('onlineReady').disabled=online.planes.length!==state.count;$('onlineReady').textContent=`完成布阵（${online.planes.length}/${state.count}）`;
  const myTurn=playing&&state.turn===online.seat;
  const label=done?(state.winner===online.seat?'🏆 你赢了！':'对方获胜'):playing?(myTurn?(online.guessMode?'✏️ 推测标记中：关闭后可发起攻击':'🎯 轮到你攻击：点击目标坐标'):'⏳ 等待对方攻击'):(online.ready?'已准备，等待对方完成布阵':other.joined?'请放置飞机并点击完成布阵':'等待另一位玩家加入房间');
  $('onlineStatus').textContent=`${label} · 机头击毁 ${me.kills}/${state.count}，对方击毁 ${other.kills}/${state.count}`;
  const myShots=state.shots||[],incoming=state.incoming||[];
  $('onlineAttackHeader').classList.toggle('hide',!playing);
  $('onlineOwnPanel').classList.toggle('hide',!(playing||done));
  $('onlineGuessToggle').classList.toggle('active',online.guessMode);
  $('onlineGuessToggle').setAttribute('aria-pressed',String(online.guessMode));
  $('onlineGuessToggle').textContent=`✏️ 推测标记：${online.guessMode?'开':'关'}`;
  $('onlineGuessUndo').disabled=online.guesses.length===0;$('onlineGuessClear').disabled=online.guesses.length===0;
  $('onlineBoard').classList.toggle('guess-active',playing&&online.guessMode);
  updateTurnCue('onlineStatus',myTurn,`${online.room}:${state.updated}`);
  if(state.status==='waiting'&&!online.ready)onlinePlacementGrid();
  else if(playing||done)grid('onlineBoard',(el,n,x,y)=>{
    paintGuesses(el,n,online.guesses);const alreadyShot=paintShots(el,n,myShots);
    if(playing&&online.guessMode){el.onclick=()=>{if(editGuess(online.guesses,n,x,y,$('onlineGuessDir').value,state.count)){saveOnlineGuesses();renderOnline()}};return}
    if(alreadyShot){el.disabled=true;return}
    el.disabled=done||!myTurn;el.onclick=async()=>{if(online.busy)return;online.busy=true;try{online.state=await api('shot',{cell:n});renderOnline()}catch(e){message(e.message)}finally{online.busy=false}};
  });
  else grid('onlineBoard',(el,n)=>{paintPlanes(el,n,online.planes);el.disabled=true});
  if(playing||done)grid('onlineOwnBoard',(el,n)=>{paintOwnDamage(el,n,online.planes,incoming);el.disabled=true});
  renderHistory('onlineMyHistory',myShots);renderHistory('onlineTheirHistory',incoming);
  $('onlineReveal').classList.toggle('hide',!done);if(done&&state.opponentPlanes)grid('onlineEnemyBoard',(el,n)=>{paintOwnDamage(el,n,state.opponentPlanes,myShots);el.disabled=true});
  $('onlineResult').textContent=done?'游戏结束：双方完整攻击历史已保留，对方布局已公开。':playing?'橙色=命中机身，红色=击毁机头，灰色=未击中。':'';
}
async function refreshOnline(){
  if(!online.token)return;
  try{const next=await api('state');const changed=JSON.stringify(next)!==JSON.stringify(online.state);online.state=next;online.ready=next.players[online.seat].ready;if(online.ready)online.planes=next.myPlanes||[];if(changed)renderOnline();message('')}
  catch(e){message(`连接中断：${e.message}`)}
}
$('create').onclick=async()=>{try{const session=await api('create',{count:Number($('onlineCount').value)});onlineSession(session)}catch(e){message(e.message)}};
$('join').onclick=async()=>{try{online.room=$('roomInput').value.trim();const session=await api('join');onlineSession(session)}catch(e){message(e.message)}};
$('onlineUndo').onclick=()=>{online.planes.pop();renderOnline()};
$('onlineRandom').onclick=()=>{try{online.planes=randomPlanes(online.state.count);renderOnline()}catch(e){message(e.message)}};
$('onlineReady').onclick=async()=>{if(online.planes.length!==online.state.count)return;try{online.state=await api('ready',{planes:online.planes});online.ready=true;renderOnline()}catch(e){message(e.message)}};
$('onlineGuessToggle').onclick=()=>{online.guessMode=!online.guessMode;renderOnline()};
$('onlineGuessUndo').onclick=()=>{online.guesses.pop();saveOnlineGuesses();renderOnline()};
$('onlineGuessClear').onclick=()=>{online.guesses=[];saveOnlineGuesses();renderOnline()};
$('share').onclick=async()=>{const url=inviteUrl(online.room);try{if(navigator.share)await navigator.share({title:'加入空战棋盘',text:`房间号：${online.room}`,url});else{await navigator.clipboard.writeText(url);message('邀请链接已复制，发给对方即可')}}catch(e){if(e.name!=='AbortError')prompt('复制邀请链接',url)}};
$('onlineHome').onclick=showHome;

function killsBy(seat){return local.shots.filter(s=>s.by===seat&&s.result==='kill').length}
function resolveShot(attacker,cell){
  const target=local.players[1-attacker];let result='miss',planeId=-1;
  for(let i=0;i<target.planes.length;i++){const s=shape(target.planes[i]);if(s.cells.includes(cell)){planeId=i;result=s.head===cell?'kill':'hit';break}}
  local.shots.push({by:attacker,cell,result,planeId:result==='kill'?planeId:undefined,n:local.shots.length+1});
  if(killsBy(attacker)===local.count){local.phase='done';local.winner=attacker}else local.turn=1-attacker;
}
function beginHandoff(title,text,next){local.awaitingPass=true;local.handoffNext=next;local.guessMode=false;$('localStatus').textContent=`📱 ${title}`;$('handoffTitle').textContent=title;$('handoffText').textContent=text;renderLocal()}
function startLocal(){
  const mode=activeMode==='same'?'same':'ai',count=Number($('localCount').value);
  local={mode,count,phase:'placing',placingSeat:0,players:[{planes:[]},{planes:mode==='ai'?randomPlanes(count):[]}],shots:[],turn:0,winner:null,awaitingPass:false,handoffNext:null,busy:false,guesses:[[],[]],guessMode:false};
  $('home').classList.add('hide');$('onlineGame').classList.add('hide');$('localGame').classList.remove('hide');message('');renderLocal();
}
function localPlacementGrid(){
  const planes=local.players[local.placingSeat].planes;
  grid('localBoard',(el,n,x,y)=>{paintPlanes(el,n,planes);el.onclick=()=>{if(planes.length>=local.count)return;const p={x,y,dir:$('localDir').value};if(!validPlane(p,planes)){message('位置无效：飞机越界或与其他飞机重叠');return}planes.push(p);message('');renderLocal()}});
}
function renderLocal(){
  if(!local)return;
  const ai=local.mode==='ai',placing=local.phase==='placing',done=local.phase==='done';
  $('localHeading').textContent=ai?'🤖 人机对战':'👥 同机双人';
  $('handoff').classList.toggle('hide',!local.awaitingPass);$('localPlayArea').classList.toggle('hide',local.awaitingPass);
  if(local.awaitingPass){updateTurnCue('localStatus',false,'');return}
  $('localPlacement').classList.toggle('hide',!placing);
  $('localAttackHeader').classList.toggle('hide',placing||done);
  $('localOwnPanel').classList.toggle('hide',placing);
  if(placing){
    updateTurnCue('localStatus',false,'');$('localBoard').classList.remove('guess-active');
    const p=local.players[local.placingSeat].planes;
    $('localReady').disabled=p.length!==local.count;$('localReady').textContent=`完成布阵（${p.length}/${local.count}）`;
    $('localStatus').textContent=`${ai?'你':`玩家${local.placingSeat+1}`}正在秘密布阵`;
    localPlacementGrid();
  }else{
    const current=local.turn,viewer=ai?0:current,outgoing=local.shots.filter(s=>s.by===viewer),incoming=local.shots.filter(s=>s.by!==viewer),guesses=local.guesses[viewer];
    const humanTurn=!done&&!local.busy;
    const label=done?(local.winner===0?(ai?'🏆 你赢了！':'🏆 玩家1获胜！'):(ai?'电脑获胜':'🏆 玩家2获胜')):(ai?(local.busy?'⏳ 电脑正在攻击':local.guessMode?'✏️ 推测标记中：关闭后可发起攻击':'🎯 轮到你攻击'):(local.guessMode?`✏️ 玩家${current+1}正在标记推测`:`🎯 玩家${current+1}攻击`));
    $('localStatus').textContent=`${label} · 玩家1击毁 ${killsBy(0)}/${local.count}，${ai?'电脑':'玩家2'}击毁 ${killsBy(1)}/${local.count}`;
    $('localGuessToggle').classList.toggle('active',local.guessMode);$('localGuessToggle').textContent=`✏️ 推测标记：${local.guessMode?'开':'关'}`;
    $('localGuessToggle').setAttribute('aria-pressed',String(local.guessMode));
    $('localGuessUndo').disabled=guesses.length===0;$('localGuessClear').disabled=guesses.length===0;
    $('localBoard').classList.toggle('guess-active',local.guessMode&&!done);
    updateTurnCue('localStatus',humanTurn,`${viewer}:${local.shots.length}`);
    grid('localBoard',(el,n,x,y)=>{
      paintGuesses(el,n,guesses);const alreadyShot=paintShots(el,n,outgoing);
      if(!done&&local.guessMode){el.onclick=()=>{if(editGuess(guesses,n,x,y,$('localGuessDir').value,local.count))renderLocal()};return}
      if(alreadyShot){el.disabled=true;return}
      el.disabled=done||local.busy;el.onclick=()=>localAttack(n);
    });
    grid('localOwnBoard',(el,n)=>{paintOwnDamage(el,n,local.players[viewer].planes,incoming);el.disabled=true});
  }
  const one=local.shots.filter(s=>s.by===0),two=local.shots.filter(s=>s.by===1);
  $('localHistoryOneTitle').textContent='玩家1攻击记录';$('localHistoryTwoTitle').textContent=`${ai?'电脑':'玩家2'}攻击记录`;
  renderHistory('localHistoryOne',one);renderHistory('localHistoryTwo',two);
  $('localReveal').classList.toggle('hide',!done);
  if(done){
    $('revealTitle0').textContent='玩家1布局';$('revealTitle1').textContent=`${ai?'电脑':'玩家2'}布局`;
    grid('localReveal0',(el,n)=>{paintOwnDamage(el,n,local.players[0].planes,two);el.disabled=true});
    grid('localReveal1',(el,n)=>{paintOwnDamage(el,n,local.players[1].planes,one);el.disabled=true});
  }
}
function localReady(){
  const planes=local.players[local.placingSeat].planes;if(planes.length!==local.count)return;
  if(local.mode==='same'&&local.placingSeat===0){local.placingSeat=1;beginHandoff('请交给玩家2','棋盘已经遮住。玩家2拿到手机后点击继续，独立完成布阵。',()=>{local.phase='placing';renderLocal()});return}
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
  setTimeout(()=>{const used=new Set(local.shots.filter(s=>s.by===1).map(s=>s.cell));const choices=Array.from({length:100},(_,i)=>i).filter(i=>!used.has(i));const cell=choices[Math.floor(Math.random()*choices.length)];resolveShot(1,cell);local.busy=false;renderLocal()},550);
}
$('startLocal').onclick=()=>{try{startLocal()}catch(e){message(e.message)}};
$('localUndo').onclick=()=>{local.players[local.placingSeat].planes.pop();renderLocal()};
$('localRandom').onclick=()=>{try{local.players[local.placingSeat].planes=randomPlanes(local.count);renderLocal()}catch(e){message(e.message)}};
$('localReady').onclick=localReady;
$('localGuessToggle').onclick=()=>{local.guessMode=!local.guessMode;renderLocal()};
$('localGuessUndo').onclick=()=>{const viewer=local.mode==='ai'?0:local.turn;local.guesses[viewer].pop();renderLocal()};
$('localGuessClear').onclick=()=>{const viewer=local.mode==='ai'?0:local.turn;local.guesses[viewer]=[];renderLocal()};
$('handoffContinue').onclick=()=>{const next=local.handoffNext;local.awaitingPass=false;local.handoffNext=null;if(next)next();else renderLocal()};
$('localHome').onclick=showHome;

setMode('online');
let saved=null;try{saved=JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{localStorage.removeItem(sessionKey)}
const roomFromUrl=new URLSearchParams(location.search).get('room');
if(saved?.room&&saved?.token&&(!roomFromUrl||saved.room===roomFromUrl))onlineSession(saved);
else if(/^\d{6}$/.test(roomFromUrl||'')){$('roomInput').value=roomFromUrl;setMode('online')}
