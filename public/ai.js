const BOARD_SIZE=10;
const DIRECTIONS=['U','R','D','L'];

export const AI_DIFFICULTIES={easy:'休闲',normal:'标准',hard:'困难'};

export function aiDifficultyLabel(value){return AI_DIFFICULTIES[value]||AI_DIFFICULTIES.normal}

export function aiPlaneShape(plane){
  let dx=0,dy=0;
  if(plane.dir==='U')dy=-1;if(plane.dir==='D')dy=1;if(plane.dir==='L')dx=-1;if(plane.dir==='R')dx=1;
  const sx=-dy,sy=dx,cells=[];
  for(const [forward,side] of [[0,0],[1,-2],[1,-1],[1,0],[1,1],[1,2],[2,0],[3,-1],[3,0],[3,1]]){
    const x=plane.x+forward*dx+side*sx,y=plane.y+forward*dy+side*sy;
    if(x<0||x>=BOARD_SIZE||y<0||y>=BOARD_SIZE)return null;
    cells.push(y*BOARD_SIZE+x);
  }
  return {head:plane.y*BOARD_SIZE+plane.x,cells};
}

const ALL_PLANES=[];
for(let y=0;y<BOARD_SIZE;y++)for(let x=0;x<BOARD_SIZE;x++)for(const dir of DIRECTIONS){
  const plane={x,y,dir},shape=aiPlaneShape(plane);
  if(shape)ALL_PLANES.push({...plane,...shape,body:shape.cells.slice(1)});
}

function shuffled(items,rng){
  const copy=items.slice();
  for(let i=copy.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]]}
  return copy;
}

function observations(shots){
  const fired=new Set(),misses=new Set(),hits=new Set(),kills=new Set();
  for(const shot of shots){
    if(!Number.isInteger(shot.cell)||shot.cell<0||shot.cell>=BOARD_SIZE*BOARD_SIZE)continue;
    fired.add(shot.cell);
    if(shot.result==='miss')misses.add(shot.cell);
    else if(shot.result==='hit')hits.add(shot.cell);
    else if(shot.result==='kill')kills.add(shot.cell);
  }
  return {fired,misses,hits,kills};
}

function possiblePlanes(observed){
  return ALL_PLANES.filter(plane=>{
    if(plane.cells.some(cell=>observed.misses.has(cell)))return false;
    if(observed.hits.has(plane.head))return false;
    for(const killedHead of observed.kills)if(plane.cells.includes(killedHead)&&plane.head!==killedHead)return false;
    return true;
  });
}

function randomUnshot(observed,rng){
  const choices=[];
  for(let cell=0;cell<BOARD_SIZE*BOARD_SIZE;cell++)if(!observed.fired.has(cell))choices.push(cell);
  return choices.length?choices[Math.floor(rng()*choices.length)]:null;
}

function bestScoredCell(scores,observed,rng){
  let best=-Infinity,choices=[];
  for(let cell=0;cell<scores.length;cell++){
    if(observed.fired.has(cell))continue;
    const score=scores[cell];
    if(score>best+1e-9){best=score;choices=[cell]}
    else if(Math.abs(score-best)<1e-9)choices.push(cell);
  }
  if(!choices.length||best<=0)return randomUnshot(observed,rng);
  return choices[Math.floor(rng()*choices.length)];
}

function normalTarget(candidates,observed,rng){
  const scores=new Float64Array(BOARD_SIZE*BOARD_SIZE),hasHits=observed.hits.size>0;
  for(const plane of candidates){
    if(observed.kills.has(plane.head))continue;
    let coveredHits=0;
    for(const hit of observed.hits)if(plane.body.includes(hit))coveredHits++;
    const relevance=hasHits?(coveredHits?1+coveredHits*7:.12):1;
    for(const cell of plane.cells){
      if(observed.fired.has(cell))continue;
      scores[cell]+=relevance*(cell===plane.head?10:1);
    }
  }
  return bestScoredCell(scores,observed,rng);
}

function overlaps(plane,occupied){return plane.cells.some(cell=>occupied.has(cell))}

function sampleLayout(candidates,count,observed,rng){
  const selected=[],occupied=new Set(),budget={remaining:1800};
  const search=()=>{
    if(selected.length===count){
      for(const killedHead of observed.kills)if(!selected.some(plane=>plane.head===killedHead))return false;
      for(const hit of observed.hits)if(!selected.some(plane=>plane.body.includes(hit)))return false;
      return true;
    }
    if(budget.remaining<=0)return false;
    const missingKills=[...observed.kills].filter(cell=>!selected.some(plane=>plane.head===cell));
    if(missingKills.length>count-selected.length)return false;
    let pool;
    if(missingKills.length){
      let bestPool=null;
      for(const killedHead of missingKills){
        const choices=candidates.filter(plane=>plane.head===killedHead&&!overlaps(plane,occupied));
        if(!choices.length)return false;
        if(!bestPool||choices.length<bestPool.length)bestPool=choices;
      }
      pool=bestPool;
    }else{
      const missingHits=[...observed.hits].filter(cell=>!selected.some(plane=>plane.body.includes(cell)));
      if(missingHits.length){
        let bestPool=null;
        for(const hit of missingHits){
          const choices=candidates.filter(plane=>plane.body.includes(hit)&&!overlaps(plane,occupied));
          if(!choices.length)return false;
          if(!bestPool||choices.length<bestPool.length)bestPool=choices;
        }
        pool=bestPool;
      }else pool=candidates.filter(plane=>!overlaps(plane,occupied));
    }
    for(const plane of shuffled(pool,rng)){
      if(--budget.remaining<0)return false;
      selected.push(plane);for(const cell of plane.cells)occupied.add(cell);
      if(search())return true;
      selected.pop();occupied.clear();for(const chosen of selected)for(const cell of chosen.cells)occupied.add(cell);
    }
    return false;
  };
  return search()?selected.slice():null;
}

function hardTarget(candidates,count,observed,rng){
  const scores=new Float64Array(BOARD_SIZE*BOARD_SIZE),sampleGoal=420;
  let samples=0;
  for(let attempt=0;attempt<sampleGoal*5&&samples<sampleGoal;attempt++){
    const layout=sampleLayout(candidates,count,observed,rng);if(!layout)continue;
    samples++;
    for(const plane of layout){
      if(observed.kills.has(plane.head))continue;
      for(const cell of plane.cells){
        if(observed.fired.has(cell))continue;
        scores[cell]+=cell===plane.head?18:1;
      }
    }
  }
  return samples?bestScoredCell(scores,observed,rng):normalTarget(candidates,observed,rng);
}

export function chooseAiTarget(shots,count,difficulty='normal',rng=Math.random){
  const observed=observations(shots);
  if(observed.fired.size>=BOARD_SIZE*BOARD_SIZE)return null;
  if(difficulty==='easy')return randomUnshot(observed,rng);
  const candidates=possiblePlanes(observed);
  if(!candidates.length)return randomUnshot(observed,rng);
  if(difficulty==='hard')return hardTarget(candidates,count,observed,rng);
  return normalTarget(candidates,observed,rng);
}
