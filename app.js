import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm';

const ENGINE_PATH='./engine/stockfish-19-lite-single.js';
const HISTORY_KEY='omb-history-v1';
const DEPTH=10;
const ICON={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};

const $=s=>document.querySelector(s);
const el={
 board:$('#board'),engine:$('#engine-status'),status:$('#position-status'),last:$('#last-move'),
 verdict:$('#verdict'),pill:$('#loss-pill'),main:$('#coach-main'),
 comparison:$('#comparison'),your:$('#your-move'),best:$('#best-move'),lessonBox:$('#lesson-box'),
 lesson:$('#lesson-text'),show:$('#show-better-btn'),reset:$('#reset-btn'),flip:$('#flip-btn'),
 recapBtn:$('#recap-btn'),recapPanel:$('#recap-panel'),recapTitle:$('#recap-title'),
 recapGood:$('#recap-good'),recapImprove:$('#recap-improve'),recapFocus:$('#recap-focus'),
 mode:$('#mode-select')
};

let game=new Chess(),selected=null,targets=[],flipped=false,busy=false,lastResult=null,showingBetter=false,demo=null,mode='computer',finished=false,gameNotes=[];

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
 if(finished){el.status.textContent='Game finished · recap below';return}
 if(game.isCheckmate())el.status.textContent='Checkmate.';
 else if(game.isDraw())el.status.textContent='Draw.';
 else if(mode==='computer')el.status.textContent=game.turn()==='w'?'Your turn · White':'Computer to move';
 else el.status.textContent=(game.turn()==='w'?'White':'Black')+' to move · you control both sides'+(game.inCheck()?' · check!':'')
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
  b.disabled=finished||busy||showingBetter||(mode==='computer'&&game.turn()==='b');
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
 if(!Number.isFinite(loss)||loss<=35)return{name:'Strong move',tone:'good'};
 if(loss<=90)return{name:'Playable move',tone:'good'};
 if(loss<=180)return{name:'Inaccuracy',tone:'warn'};
 if(loss<=320)return{name:'Mistake',tone:'warn'};
 return{name:'Blunder',tone:'danger'}
}
function alternativeIdea(bestSan,preFen){
 const san=(bestSan||'').replace(/[+#]/g,'');
 if(['Nf3','Nf6'].includes(san))return['The knight move develops a piece toward the centre and also helps prepare castling.','Look for moves that improve a piece while doing something else useful at the same time.'];
 if(['Nc3','Nc6'].includes(san))return['The knight move develops a piece toward the centre instead of spending another tempo on a pawn.','In the opening, compare pawn moves with developing moves before committing.'];
 if(san==='c5')return['c5 challenges White’s centre from the side straight away.','The point is not to win a pawn immediately — it is to put pressure on the centre and create an active position.'];
 if(san==='c4')return['c4 puts pressure on the centre from the side and gains useful space.','Ask what central square the move influences, not just what it attacks immediately.'];
 if(['e4','d4','e5','d5'].includes(san))return['The engine prefers a direct claim on the centre.','Central pawn moves are often strong because they gain space while opening lines for your pieces.'];
 if(san.startsWith('O-O'))return['The engine prefers getting the king safe and bringing the rook closer to the game.','When several moves are playable, king safety can be the most useful improvement.'];
 if(san.includes('x'))return['The engine prefers an immediate capture, but the point may be the position after the recapture rather than simply winning material.','Before judging a capture, picture the opponent’s best recapture and one move beyond it.'];
 return['Stockfish prefers '+bestSan+' because it makes a more useful improvement in this position.','Compare the two moves by asking: which develops, attacks, defends or improves king safety more efficiently?'];
}

function coach(move,v,preFen,bestSan,isBest){
 if(isBest){
  if(move.san.includes('O-O'))return['You got your king safer and brought your rook closer to the game.','What to notice: which piece can become more active now?'];
  if(move.piece==='p'&&['e4','d4','e5','d5'].includes(move.to)){
   const side=move.from[0]==='e'?'king-side bishop':'queen-side bishop';
   return['Strong opening move. '+move.san.replace(/[+#]/g,'')+' takes central space and frees your '+side+'.','What to notice: which piece is now easier to develop?'];
  }
  if(move.piece==='p'&&['c4','c5'].includes(move.to))
   return['Strong opening move. It fights for the centre from the side rather than occupying it immediately.','What to notice: which central pawn is this move challenging?'];
  if(move.piece==='n'&&['f3','c3','f6','c6'].includes(move.to)){
   const castle=(move.to==='f3'||move.to==='f6')?' and helps prepare castling':'';
   return['Strong developing move. The knight moves toward the centre'+castle+'.','What to notice: what can the knight influence from its new square?'];
  }
  if(move.captured)return['This was a strong capture in the position.','What to notice: after the opponent’s best reply, what have you actually gained — material, activity or position?'];
  if(move.san.includes('+'))return['This was a useful forcing move because the opponent has to answer your check.','What to notice: does the check improve your position after their best reply?'];
  return['That was Stockfish’s first choice, and it improves your position efficiently.','What to notice: what did the move improve — space, activity, king safety, pressure or defence?'];
 }
 const alt=alternativeIdea(bestSan,preFen);
 if(v.name==='Strong move'||v.name==='Playable move')return[
  'Your move is sound. Stockfish slightly prefers '+bestSan+'. '+alt[0],
  alt[1]
 ];
 return[alt[0],alt[1]];
}
function recordGameNote(move,loss,verdictName,player){
 if(mode!=='computer'||player!=='w')return;
 const ply=gameNotes.length+1;
 gameNotes.push({
  ply,
  san:move.san,
  piece:move.piece,
  from:move.from,
  to:move.to,
  captured:move.captured||null,
  castle:move.san.startsWith('O-O'),
  centralPawn:move.piece==='p'&&['c4','d4','e4','c3','d3','e3'].includes(move.to),
  loss:Number.isFinite(loss)?loss:null,
  verdict:verdictName
 });
}

function buildRecap(){
 if(mode!=='computer'){
  return{
   title:'Personal recap unavailable',
   good:'Free board lets you control both colours, so I cannot reliably tell which moves were yours.',
   improve:'Switch to Play computer for a recap linked specifically to your decisions.',
   focus:'Play a game against the computer, then finish the game or tap Finish & recap.'
  };
 }

 const notes=gameNotes;
 if(!notes.length){
  return{
   title:'No moves to recap yet',
   good:'Make a few moves first so the recap has something real to work from.',
   improve:'The recap only uses moves you actually played.',
   focus:'Play at least four or five moves, then check again.'
  };
 }

 const firstSix=notes.slice(0,6);
 const firstTen=notes.slice(0,10);
 const centralEarly=firstSix.filter(n=>n.centralPawn).length;
 const minorStarts=new Set(['b1','g1','c1','f1']);
 const developedBy6=new Set(firstSix.filter(n=>minorStarts.has(n.from)).map(n=>n.from));
 const developedBy10=new Set(firstTen.filter(n=>minorStarts.has(n.from)).map(n=>n.from));
 const castleNote=notes.find(n=>n.castle);
 const pawnMovesBeforeTwoDev=(()=>{
  let developed=new Set(),pawns=0;
  for(const n of notes){
   if(minorStarts.has(n.from))developed.add(n.from);
   if(developed.size>=2)break;
   if(n.piece==='p')pawns++;
  }
  return pawns;
 })();
 const earlyQueen=firstSix.some(n=>n.piece==='q');
 const bestStrong=notes.filter(n=>['Best move','Strong move','Playable move'].includes(n.verdict)).length;
 const mistakes=notes.filter(n=>['Mistake','Blunder'].includes(n.verdict)).length;
 const blunders=notes.filter(n=>n.verdict==='Blunder').length;
 const avgLoss=(()=>{
  const vals=notes.map(n=>n.loss).filter(Number.isFinite);
  return vals.length?vals.reduce((x,y)=>x+y,0)/vals.length:null;
 })();

 const good=[];
 const improve=[];

 if(centralEarly>=1)good.push('You used your pawns to claim or support the centre early rather than ignoring it.');
 if(developedBy6.size>=2)good.push('You brought at least two minor pieces into the game within your first six moves.');
 if(castleNote&&castleNote.ply<=8)good.push('You castled early enough to improve king safety and bring a rook closer to the game.');
 if(mistakes===0&&notes.length>=4)good.push('You avoided major tactical mistakes in the moves analysed.');
 if(bestStrong>=Math.ceil(notes.length*0.7)&&notes.length>=4)good.push('Most of your moves were sound according to the engine, so the game was not being lost through constant inaccuracies.');
 if(!good.length)good.push('You kept the game playable and gave yourself positions to learn from rather than collapsing immediately.');

 if(developedBy6.size<2&&notes.length>=5)improve.push('Your knights and bishops stayed on their starting squares for too long. Development should usually come before extra pawn moves.');
 if(pawnMovesBeforeTwoDev>=4)improve.push('You made '+pawnMovesBeforeTwoDev+' pawn moves before developing two minor pieces, which cost useful opening time.');
 if(!castleNote&&notes.length>=6)improve.push('You did not castle. That left your king in the centre and delayed connecting your rook to the game.');
 else if(castleNote&&castleNote.ply>8)improve.push('You eventually castled, but only on your '+castleNote.ply+'th move. Earlier castling would usually make the position easier to handle.');
 if(earlyQueen&&developedBy6.size<2)improve.push('Your queen moved before enough of your minor pieces were developed, which can make you spend extra moves defending or moving it again.');
 if(mistakes>0)improve.push('There '+(mistakes===1?'was one move':'were '+mistakes+' moves')+' where the engine saw a significant drop in the position'+(blunders?'; '+blunders+' was classed as a blunder':'')+'.');
 if(avgLoss!=null&&avgLoss>90&&mistakes===0)improve.push('Several moves were individually playable, but small losses accumulated. The next step is choosing more active moves when several options are safe.');
 if(!improve.length)improve.push('There was no single recurring problem in this short game. The biggest gain now is making your sound moves more active and purposeful.');

 let focus;
 if(developedBy6.size<2||pawnMovesBeforeTwoDev>=4)focus='In your next game, try to develop two knights or bishops before making extra pawn moves. Then look to castle.';
 else if(!castleNote||castleNote.ply>8)focus='In your next game, make king safety a checkpoint: develop the pieces between king and rook, then castle before starting a new attack.';
 else if(mistakes>0)focus='Before each move next game, ask: “What checks, captures and threats does my opponent have if I play this?”';
 else focus='Keep the same solid base, but look for moves that do two jobs at once: develop a piece while attacking, defending or preparing castling.';

 let title='Game recap';
 if(game.isCheckmate()){
  title=game.turn()==='b'?'You won by checkmate':'You were checkmated';
 }else if(game.isDraw())title='Draw · game recap';
 else title='Practice recap so far';

 return{title,good:good.slice(0,2).join(' '),improve:improve.slice(0,2).join(' '),focus};
}

function showRecap(forceFinish=false){
 if(forceFinish)finished=true;
 const r=buildRecap();
 el.recapTitle.textContent=r.title;
 el.recapGood.textContent=r.good;
 el.recapImprove.textContent=r.improve;
 el.recapFocus.textContent=r.focus;
 el.recapPanel.classList.remove('hidden');
 if(finished){selected=null;targets=[];render();status()}
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
async function analyseMove(move,preFen,postFen){
 busy=true;
 render();
 status('Analysing '+move.san+'…');
 el.verdict.textContent='Thinking…';
 el.main.textContent='Comparing your move with the strongest alternatives.';
 let computerReply=null;
 try{
  const pre=await engine.analyse(preFen);
  const post=await engine.analyse(postFen);
  computerReply=post&&post.bestMove?post.bestMove:null;

  const player=preFen.split(' ')[1];
  const bestUci=pre.bestMove;
  const bestSan=sanFor(preFen,bestUci)||'—';
  const playedUci=move.from+move.to+(move.promotion||'');
  const isBest=playedUci===bestUci;
  const preP=perspective(whiteScore(pre,preFen),player);
  const postP=perspective(whiteScore(post,postFen),player);
  const loss=(preP==null||postP==null)?null:Math.max(0,preP-postP);
  const v=verdict(loss,isBest);
  recordGameNote(move,loss,v.name,player);
  const c=coach(move,v,preFen,bestSan,isBest);

  lastResult={preFen,postFen,bestUci,bestSan};
  el.verdict.textContent=v.name;
  tone(v.tone);
  el.main.textContent=c[0];
  el.your.textContent=move.san;
  el.best.textContent=bestSan;
  if(isBest)el.comparison.classList.add('hidden');
  else el.comparison.classList.remove('hidden');
  el.lesson.textContent=c[1];
  el.lessonBox.classList.remove('hidden');

  if(loss!=null&&!isBest&&loss>35){
   el.pill.textContent=loss<=90?'small engine preference':loss<=180?'worth comparing':'important difference';
   el.pill.classList.remove('hidden');
  }else el.pill.classList.add('hidden');

  if(bestUci&&!isBest&&mode==='free')el.show.classList.remove('hidden');
  else el.show.classList.add('hidden');

  if(game.isGameOver()){
   finished=true;
   showRecap();
  }else if(mode==='computer'&&player==='w'&&game.turn()==='b'){
   status('Computer thinking…');
   await playComputerMove(computerReply);
   if(game.isGameOver()){
    finished=true;
    showRecap();
   }
  }
 }catch(err){
  console.error(err);
  el.verdict.textContent='Analysis unavailable';
  tone('danger');
  el.main.textContent='Stockfish could not finish this move analysis. You can keep playing.';
  el.engine.textContent='Stockfish error';
  el.engine.className='engine-status error';
 }finally{
  busy=false;
  render();
  status();
 }
}
async function playComputerMove(bestMove=null){
 if(mode!=='computer'||game.turn()!=='b'||game.isGameOver())return;
 status('Computer thinking…');
 el.last.textContent='Computer is thinking…';
 render();
 try{
  let uci=bestMove;
  if(!uci){
   const result=await engine.analyse(game.fen(),6);
   uci=result.bestMove;
  }
  if(!uci)throw new Error('No computer move');
  const move=game.move(uciParts(uci));
  if(!move)throw new Error('Computer returned an illegal move');
  el.last.textContent='Computer played: '+move.san;
 }catch(err){
  console.error(err);
  el.last.textContent='Computer could not move.';
  status('Computer move failed.');
 }
}

function clickSquare(square){
 if(finished||busy||showingBetter)return;
 if(mode==='computer'&&game.turn()==='b'){status('Computer thinking…');return}
 const p=game.get(square);
 if(!selected){
  if(!p||p.color!==game.turn()){status('Choose one of your own pieces.');return}
  selected=square;targets=legal(square);render();return
 }
 if(square===selected){selected=null;targets=[];render();status();return}
 if(p&&p.color===game.turn()){selected=square;targets=legal(square);render();return}
 const preFen=game.fen();
 try{
  const move=game.move({from:selected,to:square,promotion:'q'});if(!move)throw new Error('illegal');
  const postFen=game.fen();selected=null;targets=[];el.last.textContent='Last move: '+move.san;
  render();status();analyseMove(move,preFen,postFen)
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
el.reset.addEventListener('click',()=>{
 game=new Chess();
 selected=null;
 targets=[];
 busy=false;
 finished=false;
 gameNotes=[];
 el.recapPanel.classList.add('hidden');
 el.last.textContent='No moves yet.';
 resetAnalysis();
 render();
 status();
});
el.flip.addEventListener('click',()=>{flipped=!flipped;render()});
el.show.addEventListener('click',toggleBetter);
el.recapBtn.addEventListener('click',()=>showRecap(true));
el.mode.addEventListener('change',async()=>{
 mode=el.mode.value;
 selected=null;
 targets=[];
 finished=false;
 gameNotes=[];
 el.recapPanel.classList.add('hidden');
 resetAnalysis();
 render();
 if(mode==='computer'&&game.turn()==='b'&&!game.isGameOver()){
  busy=true;
  render();
  status('Computer thinking…');
  await playComputerMove();
  busy=false;
  render();
 }
 status();
});

render();status();
engine.init().then(()=>{el.engine.textContent='Stockfish ready';el.engine.className='engine-status ready'}).catch(err=>{console.error(err);el.engine.textContent='Stockfish failed to load';el.engine.className='engine-status error'});