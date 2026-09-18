import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm';

const ENGINE_PATH='./engine/stockfish-19-lite-single.js';
const HISTORY_KEY='omb-history-v1';
const DEPTH=10;
const COMPUTER_DEPTH={beginner:3,club:6,strong:10};
const ICON={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};

const $=s=>document.querySelector(s);
const el={
 board:$('#board'),engine:$('#engine-status'),status:$('#position-status'),last:$('#last-move'),
 intent:$('#intent'),verdict:$('#verdict'),pill:$('#loss-pill'),main:$('#coach-main'),
 comparison:$('#comparison'),your:$('#your-move'),best:$('#best-move'),lessonBox:$('#lesson-box'),
 lesson:$('#lesson-text'),show:$('#show-better-btn'),reset:$('#reset-btn'),flip:$('#flip-btn'),
 history:$('#history-list'),historyEmpty:$('#history-empty'),clear:$('#clear-history-btn'),
 computer:$('#computer-level')
};

let game=new Chess(),selected=null,targets=[],flipped=false,busy=false,lastResult=null,showingBetter=false,demo=null,computerLevel='off';

class Engine{
 constructor(){this.worker=null;this.pending=null;this.ready=null}
 init(){
  if(this.ready)return this.ready;
  this.ready=new Promise((resolve,reject)=>{
   try{
    this.worker=new Worker(ENGINE_PATH);
    const timer=setTimeout(()=>reject(new Error('Stockfish start timeout')),30000);
    const ready=e=>{
     const t=String(e.data||'');
     if(t.includes('uciok'))this.worker.postMessage('isready');
     if(t.includes('readyok')){
      clearTimeout(timer);
      this.worker.removeEventListener('message',ready);
      resolve();
     }
    };
    this.worker.addEventListener('message',ready);
    this.worker.addEventListener('message',e=>this.onMessage(e.data));
    this.worker.addEventListener('error',e=>reject(new Error(e.message||'Worker error')),{once:true});
    this.worker.postMessage('uci');
   }catch(err){reject(err)}
  });
  return this.ready
 }
 onMessage(data){
  if(!this.pending)return;
  for(const raw of String(data||'').split(/\r?\n/)){
   const line=raw.trim();
   if(line.startsWith('info ')&&line.includes(' score ')&&line.includes(' pv ')){
    const sm=line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
    const pm=line.match(/\bpv\s+(.+)$/);
    if(sm&&pm)this.pending.info={type:sm[1],value:Number(sm[2]),pv:pm[1].trim().split(/\s+/)}
   }
   if(line.startsWith('bestmove ')){
    const best=line.split(/\s+/)[1],result={bestMove:best==='(none)'?null:best,...(this.pending.info||{})};
    const done=this.pending.done;this.pending=null;done(result)
   }
  }
 }
 async analyse(fen,depth=DEPTH){
  await this.init();
  if(this.pending)throw new Error('Engine busy');
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.worker.postMessage('stop');this.pending=null;reject(new Error('Analysis timeout'))},25000);
   this.pending={info:null,done:v=>{clearTimeout(timer);resolve(v)}};
   this.worker.postMessage('position fen '+fen);
   this.worker.postMessage('go depth '+depth)
  })
 }
}

const engine = new Engine();

function status(msg){
 if(msg){el.status.textContent=msg;return}
 if(game.isCheckmate())el.status.textContent='Checkmate.';
 else if(game.isDraw())el.status.textContent='Draw.';
 else el.status.textContent=(game.turn()==='w'?'White':'Black')+' to move'+(game.inCheck()?' — check!':'.')
}
function squareName(f,r){return String.fromCharCode(97+f)+String(8-r)}
function displaySquares(){
 const a=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){
  const rr=flipped?7-r:r,cc=flipped?7-c:c;a.push({square:squareName(cc,rr),row:r,col:c})
 }return a
}
function render(){
 el.board.innerHTML='';
 for(const item of displaySquares()){
  const b=document.createElement('button');b.type='button';
  b.className='square '+(((item.row+item.col)%2===0)?'light':'dark');
  const p=game.get(item.square);if(p)b.textContent=ICON[p.color+p.type];
  if(selected===item.square)b.classList.add('selected');
  if(targets.includes(item.square))b.classList.add(p?'capture-target':'target');
  if(demo&&demo.from===item.square)b.classList.add('demo-from');
  if(demo&&demo.to===item.square)b.classList.add('demo-to');
  b.disabled=busy||showingBetter;
  b.setAttribute('aria-label',item.square);
  if(item.row===7){const s=document.createElement('span');s.className='coord file';s.textContent=item.square[0];b.appendChild(s)}
  if(item.col===0){const s=document.createElement('span');s.className='coord rank';s.textContent=item.square[1];b.appendChild(s)}
  b.addEventListener('click',()=>clickSquare(item.square));el.board.appendChild(b)
 }
}
function legal(square){try{return game.moves({square,verbose:true}).map(m=>m.to)}catch{return[]}}
function uciParts(u){return u&&u.length>=4?{from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||undefined}:null}
function sanFor(fen,uci){try{const c=new Chess(fen),m=c.move(uciParts(uci));return m?m.san:uci}catch{return uci}}
function whiteScore(result,fen){
 if(!result||!result.type||!Number.isFinite(result.value))return null;
 let n=result.type==='mate'?(Math.sign(result.value)||1)*(100000-Math.min(Math.abs(result.value),999)*100):result.value;
 return fen.split(' ')[1]==='w'?n:-n
}
function perspective(score,color){return score==null?null:score*(color==='w'?1:-1)}
function verdict(loss,best){
 if(best)return{name:'Best move',tone:'good'};
 if(!Number.isFinite(loss)||loss<=30)return{name:'Good move',tone:'good'};
 if(loss<=85)return{name:'Small inaccuracy',tone:'warn'};
 if(loss<=190)return{name:'Mistake',tone:'warn'};
 return{name:'Blunder',tone:'danger'}
}
function coach(move,intent,v){
 const opening=game.history().length<=16;
 if(v.name==='Best move')return['That was Stockfish’s first choice.','Good moves still need a reason. Notice what your move improved, attacked or defended.'];
 if(intent==='develop'&&opening)return['Your idea was sensible: develop a piece.','Development is useful, but before moving a piece check what it currently protects.'];
 if(intent==='castle')return['King safety is a good priority.','Develop the pieces between your king and rook, then castle before starting unnecessary attacks.'];
 if(intent==='attack')return['The attacking idea makes sense, but the position had a stronger option.','Before attacking, scan every check, capture and direct threat for both sides.'];
 if(intent==='material')return['You were looking for material, which is good practical thinking.','After every capture, ask whether the capturing piece can simply be taken back.'];
 if(intent==='defend')return['You saw that defence mattered, but Stockfish preferred another move.','When defending, check whether one move can solve the threat while also developing or counter-attacking.'];
 if(move.san.includes('+'))return['You found a forcing check, but there was a stronger continuation.','Checks are candidates, not automatically good moves. Always picture the opponent’s best reply.'];
 return['There was a stronger move in the position.','Before committing, scan: their checks, captures and threats, then your checks, captures and threats.']
}
function tone(name){
 el.verdict.style.color=name==='danger'?'var(--danger)':name==='warn'?'var(--warn)':'var(--good)'
}
function resetAnalysis(){
 el.verdict.textContent='Make a move';el.verdict.style.color='';
 el.pill.classList.add('hidden');el.comparison.classList.add('hidden');el.lessonBox.classList.add('hidden');el.show.classList.add('hidden');
 el.main.textContent="I'll compare your move with Stockfish and give you one useful thing to remember.";
 lastResult=null;showingBetter=false;demo=null
}
async function analyseMove(move,preFen,postFen,intent){
 busy=true;render();status('Analysing your move…');el.verdict.textContent='Thinking…';el.main.textContent='Stockfish is comparing your move with the best option.';
 try{
  const pre=await engine.analyse(preFen);
  const post=await engine.analyse(postFen);
  const player=preFen.split(' ')[1],bestUci=pre.bestMove,bestSan=sanFor(preFen,bestUci)||'—';
  const playedUci=move.from+move.to+(move.promotion||'');
  const isBest=playedUci===bestUci;
  const preP=perspective(whiteScore(pre,preFen),player),postP=perspective(whiteScore(post,postFen),player);
  const loss=(preP==null||postP==null)?null:Math.max(0,preP-postP);
  const v=verdict(loss,isBest),c=coach(move,intent,v);
  lastResult={preFen,postFen,bestUci,bestSan};
  el.verdict.textContent=v.name;tone(v.tone);el.main.textContent=c[0];
  el.your.textContent=move.san;el.best.textContent=bestSan;el.comparison.classList.remove('hidden');
  el.lesson.textContent=c[1];el.lessonBox.classList.remove('hidden');
  if(loss!=null&&!isBest){el.pill.textContent=loss<100?'small difference':loss<200?'worth reviewing':'big swing';el.pill.classList.remove('hidden')}else el.pill.classList.add('hidden');
  if(bestUci&&!isBest)el.show.classList.remove('hidden');else el.show.classList.add('hidden');
  save({verdict:v.name,move:move.san,best:bestSan,lesson:c[1]})
 }catch(err){
  console.error(err);el.verdict.textContent='Engine unavailable';tone('danger');
  el.main.textContent='The board still works, but Stockfish could not complete this analysis.';
  el.engine.textContent='Stockfish error';el.engine.className='engine-status error'
 }finally{
  el.intent.value='unsure';
  if(computerLevel!=='off'&&game.turn()==='b'&&!game.isGameOver())await playComputerMove();
  busy=false;render();status()
 }
}
async function playComputerMove(){
 if(computerLevel==='off'||game.turn()!=='b'||game.isGameOver())return;
 status('Computer thinking…');
 el.last.textContent='Computer is thinking…';
 render();
 try{
  const result=await engine.analyse(game.fen(),COMPUTER_DEPTH[computerLevel]||3);
  if(!result.bestMove)throw new Error('No computer move');
  const move=game.move(uciParts(result.bestMove));
  if(!move)throw new Error('Computer returned an illegal move');
  el.last.textContent='Computer played: '+move.san;
 }catch(err){
  console.error(err);
  el.last.textContent='Computer could not move.';
 }
}

function clickSquare(square){
 if(busy||showingBetter)return;
 const p=game.get(square);
 if(!selected){
  if(!p||p.color!==game.turn()){status('Choose one of your own pieces.');return}
  selected=square;targets=legal(square);render();return
 }
 if(square===selected){selected=null;targets=[];render();status();return}
 if(p&&p.color===game.turn()){selected=square;targets=legal(square);render();return}
 const preFen=game.fen(),intent=el.intent.value;
 try{
  const move=game.move({from:selected,to:square,promotion:'q'});if(!move)throw new Error('illegal');
  const postFen=game.fen();selected=null;targets=[];el.last.textContent='Last move: '+move.san;
  render();status();analyseMove(move,preFen,postFen,intent)
 }catch{status('That move is not legal.')}
}
function toggleBetter(){
 if(!lastResult||!lastResult.bestUci)return;
 if(!showingBetter){
  const p=uciParts(lastResult.bestUci);game.load(lastResult.preFen);game.move(p);showingBetter=true;demo={from:p.from,to:p.to};
  el.show.textContent='Back to my move';status('Stockfish preferred '+lastResult.bestSan+'.')
 }else{
  game.load(lastResult.postFen);showingBetter=false;demo=null;el.show.textContent='Show me the better move';status()
 }render()
}
function read(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{return[]}}
function save(item){const a=read();a.unshift(item);localStorage.setItem(HISTORY_KEY,JSON.stringify(a.slice(0,8)));renderHistory()}
function renderHistory(){
 const a=read();el.history.innerHTML='';el.historyEmpty.classList.toggle('hidden',a.length>0);
 for(const x of a){const li=document.createElement('li'),m=document.createElement('span');li.textContent=x.lesson;m.className='history-meta';m.textContent=x.verdict+': '+x.move+(x.best&&x.best!==x.move?' → '+x.best:'');li.appendChild(m);el.history.appendChild(li)}
}
el.reset.addEventListener('click',()=>{game=new Chess();selected=null;targets=[];busy=false;el.last.textContent='No move analysed yet.';resetAnalysis();render();status()});
el.flip.addEventListener('click',()=>{flipped=!flipped;render()});
el.show.addEventListener('click',toggleBetter);
el.clear.addEventListener('click',()=>{localStorage.removeItem(HISTORY_KEY);renderHistory()});
el.computer.addEventListener('change',async()=>{
 computerLevel=el.computer.value;
 if(computerLevel!=='off'&&game.turn()==='b'&&!game.isGameOver()&&!busy){
  busy=true;render();
  await playComputerMove();
  busy=false;render();status();
 }
});

render();renderHistory();status();
engine.init().then(()=>{el.engine.textContent='Stockfish ready';el.engine.className='engine-status ready'}).catch(err=>{console.error(err);el.engine.textContent='Stockfish failed to load';el.engine.className='engine-status error'});