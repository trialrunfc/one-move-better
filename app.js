import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm';

const ENGINE_PATH='./engine/stockfish-19-lite-single.js';
const HISTORY_KEY='omb-history-v1';
const DEPTH=8;
const POST_DEPTH=6;
const COMPUTER_DEPTH=5;
const ANALYSIS_TIMEOUT_MS=12000;
const ICON={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};

const $=s=>document.querySelector(s);
const el={
 board:$('#board'),engine:$('#engine-status'),status:$('#position-status'),last:$('#last-move'),
 verdict:$('#verdict'),pill:$('#loss-pill'),main:$('#coach-main'),
 comparison:$('#comparison'),your:$('#your-move'),best:$('#best-move'),
 yourNotation:$('#your-notation'),bestNotation:$('#best-notation'),
 thinkBox:$('#think-box'),thinkText:$('#think-text'),explain:$('#explain-btn'),
 replyBox:$('#reply-box'),reply:$('#reply-text'),lessonBox:$('#lesson-box'),
 lesson:$('#lesson-text'),show:$('#show-better-btn'),reset:$('#reset-btn'),flip:$('#flip-btn'),
 recapBtn:$('#recap-btn'),recapPanel:$('#recap-panel'),recapTitle:$('#recap-title'),
 recapGood:$('#recap-good'),recapImprove:$('#recap-improve'),recapFocus:$('#recap-focus'),
 mode:$('#mode-select')
};

let game=new Chess(),selected=null,targets=[],flipped=false,busy=false,lastResult=null,showingBetter=false,demo=null,mode='computer',finished=false,gameNotes=[],pendingExplanation=null;

class Engine{
 constructor(){this.worker=null;this.pending=null;this.ready=null}

 reset(){
  try{if(this.worker)this.worker.terminate()}catch{}
  this.worker=null;
  this.pending=null;
  this.ready=null;
 }

 init(){
  if(this.ready)return this.ready;
  this.ready=new Promise((resolve,reject)=>{
   try{
    this.worker=new Worker(ENGINE_PATH);
    const timer=setTimeout(()=>{
     this.reset();
     reject(new Error('Stockfish start timeout'));
    },ANALYSIS_TIMEOUT_MS);

    const ready=e=>{
     const t=String(e.data||'');
     if(t.includes('uciok'))this.worker?.postMessage('isready');
     if(t.includes('readyok')){
      clearTimeout(timer);
      this.worker?.removeEventListener('message',ready);
      resolve();
     }
    };

    const fail=e=>{
     clearTimeout(timer);
     const message=e?.message||'Worker error';
     this.reset();
     reject(new Error(message));
    };

    this.worker.addEventListener('message',ready);
    this.worker.addEventListener('message',e=>this.onMessage(e.data));
    this.worker.addEventListener('error',fail,{once:true});
    this.worker.postMessage('uci');
   }catch(err){
    this.reset();
    reject(err);
   }
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
    const best=line.split(/\s+/)[1];
    const result={bestMove:best==='(none)'?null:best,...(this.pending.info||{})};
    const pending=this.pending;
    this.pending=null;
    pending.done(result);
   }
  }
 }

 async analyse(fen,depth=DEPTH,retry=true){
  try{
   await this.init();
   if(this.pending)throw new Error('Engine busy');

   return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
     try{this.worker?.postMessage('stop')}catch{}
     this.pending=null;
     this.reset();
     reject(new Error('Analysis timeout'));
    },ANALYSIS_TIMEOUT_MS);

    this.pending={
     info:null,
     done:v=>{clearTimeout(timer);resolve(v)}
    };

    this.worker.postMessage('position fen '+fen);
    this.worker.postMessage('go depth '+depth);
   });
  }catch(err){
   if(retry){
    this.reset();
    return this.analyse(fen,Math.max(4,depth-2),false);
   }
   throw err;
  }
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
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const PIECE_NAME={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};

function moveDetailsFromUci(fen,uci){
 try{
  const c=new Chess(fen),parts=uciParts(uci);
  if(!parts)return null;
  const move=c.move(parts);
  if(!move)return null;
  return{move,label:humanMoveLabel(move)};
 }catch{return null}
}

function humanMoveLabel(move){
 if(!move)return'';
 if(move.san.startsWith('O-O-O'))return'Castle queenside';
 if(move.san.startsWith('O-O'))return'Castle kingside';
 const piece=PIECE_NAME[move.piece]||'piece';
 if(move.piece==='p'){
  if(move.captured)return'Capture on '+move.to+' with the '+move.from[0]+'-pawn';
  return'Move the '+move.from[0]+'-pawn to '+move.to;
 }
 const startSquares={n:['b1','g1','b8','g8'],b:['c1','f1','c8','f8']};
 if(startSquares[move.piece]?.includes(move.from)&&['c3','f3','c6','f6','b2','g2','b7','g7','c4','f4','c5','f5'].includes(move.to))
  return'Develop the '+piece+' to '+move.to;
 if(move.captured)return'Capture on '+move.to+' with the '+piece;
 return'Move the '+piece+' to '+move.to;
}

function squareCoords(square){
 return{f:square.charCodeAt(0)-97,r:Number(square[1])-1};
}
function coordsSquare(f,r){
 return f>=0&&f<8&&r>=0&&r<8?String.fromCharCode(97+f)+String(r+1):null;
}
function isSquareAttacked(board,square,byColor){
 const target=squareCoords(square);
 const knight=[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
 const king=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
 const diag=[[1,1],[1,-1],[-1,1],[-1,-1]];
 const orth=[[1,0],[-1,0],[0,1],[0,-1]];

 for(const [df,dr] of knight){
  const sq=coordsSquare(target.f+df,target.r+dr),p=sq&&board.get(sq);
  if(p&&p.color===byColor&&p.type==='n')return true;
 }
 for(const [df,dr] of king){
  const sq=coordsSquare(target.f+df,target.r+dr),p=sq&&board.get(sq);
  if(p&&p.color===byColor&&p.type==='k')return true;
 }

 const pawnFromRank=target.r+(byColor==='w'?-1:1);
 for(const df of [-1,1]){
  const sq=coordsSquare(target.f+df,pawnFromRank),p=sq&&board.get(sq);
  if(p&&p.color===byColor&&p.type==='p')return true;
 }

 for(const [df,dr] of diag){
  let f=target.f+df,r=target.r+dr;
  while(f>=0&&f<8&&r>=0&&r<8){
   const sq=coordsSquare(f,r),p=board.get(sq);
   if(p){
    if(p.color===byColor&&(p.type==='b'||p.type==='q'))return true;
    break;
   }
   f+=df;r+=dr;
  }
 }
 for(const [df,dr] of orth){
  let f=target.f+df,r=target.r+dr;
  while(f>=0&&f<8&&r>=0&&r<8){
   const sq=coordsSquare(f,r),p=board.get(sq);
   if(p){
    if(p.color===byColor&&(p.type==='r'||p.type==='q'))return true;
    break;
   }
   f+=df;r+=dr;
  }
 }
 return false;
}

function attackedPieces(board,color){
 const enemy=color==='w'?'b':'w',out=[];
 for(let f=0;f<8;f++)for(let r=0;r<8;r++){
  const sq=coordsSquare(f,r),p=board.get(sq);
  if(p&&p.color===color&&p.type!=='k'&&isSquareAttacked(board,sq,enemy))out.push({square:sq,piece:p});
 }
 return out;
}

function defensiveContext(preFen,move){
 try{
  const pre=new Chess(preFen);
  const color=move.color,enemy=color==='w'?'b':'w';
  const beforeAttacked=attackedPieces(pre,color);
  const sourceWasAttacked=isSquareAttacked(pre,move.from,enemy);
  const wasInCheck=pre.inCheck();

  const post=new Chess(preFen);
  post.move({from:move.from,to:move.to,promotion:move.promotion||'q'});
  const afterAttacked=attackedPieces(post,color);
  const destinationAttacked=isSquareAttacked(post,move.to,enemy);
  const piece=PIECE_NAME[move.piece]||'piece';

  if(wasInCheck){
   return{
    kind:'check',
    text:'You were in check, so this move had to deal with an immediate threat to your king.',
    question:'You were in check. What part of your move removed that threat?'
   };
  }
  if(sourceWasAttacked&&!destinationAttacked){
   return{
    kind:'escape',
    text:'Your '+piece+' on '+move.from+' was under attack, and you moved it to a safer square on '+move.to+'.',
    question:'Your '+piece+' on '+move.from+' was under attack. What would happen if you ignored that threat?'
   };
  }
  if(sourceWasAttacked&&move.captured){
   return{
    kind:'counter',
    text:'Your '+piece+' was under attack, and you answered the threat with a capture rather than simply retreating.',
    question:'Your '+piece+' was under attack. Does this capture actually solve the threat after the opponent replies?'
   };
  }
  if(afterAttacked.length<beforeAttacked.length){
   return{
    kind:'reduce',
    text:'This move reduced the number of your pieces under direct attack, so there is a real defensive idea behind it.',
    question:'Which of your pieces became safer after this move?'
   };
  }
  return null;
 }catch{return null}
}

function moveIdea(fen,move){
 if(!move)return'It improves the position.';
 const defence=defensiveContext(fen,move);
 if(defence)return defence.text;
 const c=new Chess(fen);
 const colour=move.color;
 const enemy=colour==='w'?'b':'w';
 const piece=PIECE_NAME[move.piece]||'piece';

 if(move.san.startsWith('O-O'))return'It makes the king safer and brings a rook closer to the centre.';

 if(move.piece==='p'){
  const central=['d4','e4','d5','e5'];
  if(central.includes(move.to)){
   const bishop=move.from[0]==='e'?(colour==='w'?'f1':'f8'):(colour==='w'?'c1':'c8');
   return'It claims central space and opens a line for the bishop on '+bishop+'.';
  }
  if(['d3','d6'].includes(move.to)){
   const support=colour==='w'?'e4':'e5';
   const supported=c.get(support);
   const bishop=colour==='w'?'c1':'c8';
   if(supported&&supported.color===colour&&supported.type==='p')
    return'It supports the pawn on '+support+' and opens the bishop on '+bishop+', but it does not develop a new piece.';
   return'It gives the centre extra support and opens the bishop on '+bishop+', but it does not develop a new piece.';
  }
  if(['e3','e6'].includes(move.to)){
   const support=colour==='w'?'d4':'d5';
   const supported=c.get(support);
   const bishop=colour==='w'?'f1':'f8';
   if(supported&&supported.color===colour&&supported.type==='p')
    return'It supports the pawn on '+support+' and opens the bishop on '+bishop+', but it is a quieter developing choice.';
   return'It opens the bishop on '+bishop+' and supports central squares, but it is a quieter move.';
  }
  if(move.captured)return'It forces an exchange immediately, but the value depends on what the opponent can recapture with.';
  return'It changes the pawn structure and controls new squares, but it uses a move that could otherwise develop a piece.';
 }

 if(move.piece==='n'){
  const reasons=[];
  if(['f3','c3','f6','c6'].includes(move.to))reasons.push('develops a knight toward the centre');
  const targets={
   f3:['e5','d4'],c3:['e4','d5'],f6:['e4','d5'],c6:['e5','d4']
  }[move.to]||[];
  const attacked=targets.find(sq=>{const p=c.get(sq);return p&&p.color===enemy});
  if(attacked)reasons.push('attacks the piece on '+attacked);
  if(targets.length)reasons.push('controls important central squares');
  if((colour==='w'&&move.from==='g1')||(colour==='b'&&move.from==='g8'))reasons.push('helps clear the way to castle');
  if(reasons.length)return'It '+reasons.join(', ').replace(/, ([^,]*)$/, ' and $1')+'.';
  return'It improves the knight’s activity and gives it influence over more useful squares.';
 }

 if(move.piece==='b'){
  const reasons=['develops a bishop onto an active diagonal'];
  if((colour==='w'&&move.from==='f1')||(colour==='b'&&move.from==='f8'))reasons.push('helps clear the way to castle');
  return'It '+reasons.join(' and ')+'.';
 }

 if(move.captured)return'It wins or exchanges material immediately, but you still need to check the opponent’s best recapture.';
 if(move.san.includes('+'))return'It gives check, so the opponent has to respond immediately.';
 if(move.piece==='q')return'It makes the queen more active, although early queen moves can lose time if the opponent attacks it.';
 if(move.piece==='r')return'It activates a rook and puts more pressure on an open or useful file.';
 if(move.piece==='k')return'It changes king safety, so the important question is whether the king is safer on the new square.';
 return'It improves '+piece+' activity.';
}

function continuationText(fen,pv){
 if(!Array.isArray(pv)||pv.length<2)return'No clear reply line was available at this search depth.';
 const c=new Chess(fen),steps=[];
 for(const uci of pv.slice(0,3)){
  try{
   const m=c.move(uciParts(uci));
   if(!m)break;
   steps.push({move:m,label:humanMoveLabel(m)});
  }catch{break}
 }
 if(steps.length<2)return'No clear reply line was available at this search depth.';
 let text='If you choose '+steps[0].label.toLowerCase()+' ('+steps[0].move.san+'), the opponent’s best reply is '+steps[1].label.toLowerCase()+' ('+steps[1].move.san+').';
 if(steps[0].move.captured&&steps[1].move.captured&&steps[0].move.to===steps[1].move.to)
  text+=' So the capture is not about winning material for free; the recapture is part of the idea.';
 if(steps[2])text+=' A likely continuation is '+steps[2].label.toLowerCase()+' ('+steps[2].move.san+').';
 return text;
}

function questionFor(bestDetails,defence){
 if(defence?.question)return defence.question;
 if(!bestDetails)return null;
 const m=bestDetails.move;
 if(m.piece==='n'&&['f3','c3','f6','c6'].includes(m.to))return'What useful jobs would the knight do from '+m.to+' besides simply moving off its starting square?';
 if(m.san.startsWith('O-O'))return'What does castling improve besides moving the king?';
 if(m.captured)return'If you make this capture, what is the opponent’s best recapture or reply?';
 if(m.piece==='p'&&['d4','e4','d5','e5'].includes(m.to))return'What does this central pawn move open up for your other pieces?';
 return null;
}

function principleFor(move,bestDetails,isBest){
 if(isBest&&move.piece==='n')return'Good development often does more than one job: improve a piece, influence the centre and prepare king safety.';
 if(isBest&&move.piece==='p'&&['d4','e4','d5','e5'].includes(move.to))return'Central pawn moves are strongest when they gain space and help your pieces come out.';
 if(bestDetails?.move.piece==='n')return'When two moves are safe, prefer the one that develops a piece while creating another useful effect.';
 if(bestDetails?.move.san.startsWith('O-O'))return'King safety is also development: castling usually improves both the king and a rook at once.';
 if(bestDetails?.move.captured)return'For every capture, picture the opponent’s best recapture before deciding what the exchange achieves.';
 return'Compare moves by what they achieve, not just by whether the engine ranks one slightly higher.';
}

function revealExplanation(data){
 pendingExplanation=null;
 if(el.thinkBox)el.thinkBox.classList.add('hidden');
 if(el.main)el.main.textContent=data.main||'Move analysed.';
 if(el.comparison){
  if(data.isBest||data.smallPreference){
   el.comparison.classList.add('hidden');
  }else{
   if(el.your)el.your.textContent=data.yourLabel||data.yourSan||'Your move';
   if(el.yourNotation)el.yourNotation.textContent=data.yourSan?'Notation: '+data.yourSan:'';
   if(el.best)el.best.textContent=data.bestLabel||data.bestSan||'Alternative';
   if(el.bestNotation)el.bestNotation.textContent=data.bestSan?'Notation: '+data.bestSan:'';
   el.comparison.classList.remove('hidden');
  }
 }
 if(el.lesson)el.lesson.textContent=data.principle||'Look for the move that improves your position most efficiently.';
 if(el.lessonBox)el.lessonBox.classList.remove('hidden');
 if(el.replyBox){
  if(data.reply&&el.reply){
   el.reply.textContent=data.reply;
   el.replyBox.classList.remove('hidden');
  }else el.replyBox.classList.add('hidden');
 }
}

function verdict(loss,best){
 if(best)return{name:'Best move',tone:'good'};
 if(!Number.isFinite(loss)||loss<=35)return{name:'Strong move',tone:'good'};
 if(loss<=90)return{name:'Playable move',tone:'good'};
 if(loss<=180)return{name:'Inaccuracy',tone:'warn'};
 if(loss<=320)return{name:'Mistake',tone:'warn'};
 return{name:'Blunder',tone:'danger'}
}
function buildMoveExplanation(move,preFen,bestUci,bestSan,isBest,preAnalysis,verdictName){
 const bestDetails=moveDetailsFromUci(preFen,bestUci);
 const defence=defensiveContext(preFen,move);
 const yourLabel=humanMoveLabel(move);
 const yourIdea=moveIdea(preFen,move);
 const bestLabel=bestDetails?bestDetails.label:(bestSan||'Alternative move');
 const bestIdea=bestDetails?moveIdea(preFen,bestDetails.move):'It improves the position more efficiently.';
 const smallPreference=['Strong move','Playable move'].includes(verdictName);

 let main;
 if(isBest){
  main=yourLabel+'. '+yourIdea;
 }else if(smallPreference){
  main=yourLabel+'. '+yourIdea+' This is a sound choice in this position.';
 }else if(defence){
  main='Your defensive idea makes sense: '+defence.text+' The issue is that, in this exact position, '+bestLabel.toLowerCase()+' is stronger because '+bestIdea.charAt(0).toLowerCase()+bestIdea.slice(1);
 }else{
  main='Your idea: '+yourLabel+'. '+yourIdea+' In this exact position, '+bestLabel.toLowerCase()+' is stronger because '+bestIdea.charAt(0).toLowerCase()+bestIdea.slice(1);
 }

 return{
  main,
  isBest,
  smallPreference,
  defence,
  yourLabel,
  yourSan:move.san,
  bestLabel,
  bestSan,
  reply:smallPreference?'':continuationText(preFen,preAnalysis?.pv),
  principle:smallPreference
    ? principleFor(move,null,true)
    : principleFor(move,bestDetails,isBest),
  question:questionFor(bestDetails,defence)
 };
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
 el.thinkBox.classList.add('hidden');el.replyBox.classList.add('hidden');
 el.main.textContent="I'll explain what your move changes in the position and what another strong idea would achieve.";
 pendingExplanation=null;lastResult=null;showingBetter=false;demo=null
}
async function analyseMove(move,preFen,postFen){
 busy=true;
 render();
 status('Analysing '+move.san+'…');
 el.verdict.textContent='Thinking…';
 el.main.textContent='Comparing your move with the strongest alternatives.';
 let computerReply=null;
 try{
  const pre=await engine.analyse(preFen,DEPTH);
  let post=null;
  try{
   post=await engine.analyse(postFen,POST_DEPTH);
  }catch(postErr){
   console.warn('Post-move analysis failed',postErr);
  }
  computerReply=post?.bestMove||null;

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
  let explanation;
  try{
   explanation=buildMoveExplanation(move,preFen,bestUci,bestSan,isBest,pre,v.name);
  }catch(formatErr){
   console.error('Coaching format error',formatErr);
   explanation={
    main:humanMoveLabel(move)+'. '+moveIdea(preFen,move),
    isBest,
    smallPreference:['Strong move','Playable move'].includes(v.name),
    yourLabel:humanMoveLabel(move),
    yourSan:move.san,
    bestLabel:bestSan,
    bestSan,
    reply:'',
    principle:'Focus on what the move changes in this exact position.',
    question:'What does this move improve?'
   };
  }

  lastResult={preFen,postFen,bestUci,bestSan};
  try{
   el.verdict.textContent=v.name;
   tone(v.tone);
   if(el.comparison)el.comparison.classList.add('hidden');
   if(el.lessonBox)el.lessonBox.classList.add('hidden');
   if(el.replyBox)el.replyBox.classList.add('hidden');
   if(el.thinkBox)el.thinkBox.classList.add('hidden');

   const askFirst=!isBest&&Boolean(explanation.question)&&['Inaccuracy','Mistake','Blunder'].includes(v.name);
   if(askFirst){
    pendingExplanation=explanation;
    el.main.textContent='Before I explain the alternative, one concrete question about this position:';
    if(el.thinkText)el.thinkText.textContent=explanation.question;
    if(el.thinkBox)el.thinkBox.classList.remove('hidden');
    else revealExplanation(explanation);
   }else{
    revealExplanation(explanation);
   }

   if(loss!=null&&!isBest&&loss>90){
    el.pill.textContent=loss<=180?'worth comparing':'important difference';
    el.pill.classList.remove('hidden');
   }else el.pill.classList.add('hidden');

   if(bestUci&&!isBest&&mode==='free')el.show.classList.remove('hidden');
   else el.show.classList.add('hidden');
  }catch(uiErr){
   console.error('Coaching UI error',uiErr);
   el.verdict.textContent=v.name;
   el.main.textContent=humanMoveLabel(move)+'. '+moveIdea(preFen,move);
  }

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
  el.main.textContent='The coach could not finish this move analysis, but the game will continue.';
  el.engine.textContent='Stockfish recovering…';
  el.engine.className='engine-status';

  const player=preFen.split(' ')[1];
  if(mode==='computer'&&player==='w'&&game.turn()==='b'&&!game.isGameOver()){
   await playComputerMove();
  }
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
 await wait(1000);

 let uci=bestMove;

 try{
  if(!uci){
   const result=await engine.analyse(game.fen(),COMPUTER_DEPTH);
   uci=result?.bestMove||null;
  }

  if(uci){
   const move=game.move(uciParts(uci));
   if(move){
    el.last.textContent='Computer played: '+move.san;
    el.engine.textContent='Stockfish ready';
    el.engine.className='engine-status ready';
    return;
   }
  }
 }catch(err){
  console.error('Computer engine move failed',err);
 }

 // Never freeze the game because the engine failed.
 const legalMoves=game.moves({verbose:true});
 if(legalMoves.length){
  const fallback=legalMoves[0];
  const move=game.move({from:fallback.from,to:fallback.to,promotion:fallback.promotion||'q'});
  el.last.textContent='Computer played: '+(move?.san||'move');
  el.engine.textContent='Stockfish recovering…';
  el.engine.className='engine-status';
 }else{
  el.last.textContent='No legal computer move.';
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
 pendingExplanation=null;
 el.recapPanel.classList.add('hidden');
 el.last.textContent='No moves yet.';
 resetAnalysis();
 render();
 status();
});
el.flip.addEventListener('click',()=>{flipped=!flipped;render()});
el.show.addEventListener('click',toggleBetter);
el.explain.addEventListener('click',()=>{if(pendingExplanation)revealExplanation(pendingExplanation)});
el.recapBtn.addEventListener('click',()=>showRecap(true));
el.mode.addEventListener('change',async()=>{
 mode=el.mode.value;
 selected=null;
 targets=[];
 finished=false;
 gameNotes=[];
 pendingExplanation=null;
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
engine.init().then(()=>{el.engine.textContent='Stockfish ready';el.engine.className='engine-status ready'}).catch(err=>{console.error(err);el.engine.textContent='Stockfish will retry';el.engine.className='engine-status'});