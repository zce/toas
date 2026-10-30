// Final v8.7: compact 46x11 dot plate, mirrored angular braid, phosphor.
export const RECORD_WIDTH=164,PROCESS_WIDTH=136,MATRIX_HEIGHT=40,MATRIX_STEP=3.5,MATRIX_FPS=30
const COLS=46,ROWS=11,HISTORY=64,TAU=Math.PI*2
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x))
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t)}
const follow=(v,to,dt,tau)=>v+(to-v)*(1-Math.exp(-dt/tau))
const rates=[.8,1.25,1.85,2.6],spatial=[1.4,2.4,3.8,5.6],coeff=[.55,.42,.3,.2]
export const contour=p=>2/Math.PI*Math.asin(Math.sin(p))
export class MatrixSignal{
 constructor(){this.a=new Float32Array(HISTORY);this.b=new Float32Array(HISTORY);this.reset()}
 reset(){
  this.a.fill(0);this.b.fill(0);this.head=0;this.time=0;this.goal=0
  this.voice=0;this.energy=0;this.peak=-37;this.room=-58;this.processMix=0
  this.phase=[.1,1.7,3.3,4.6];this.phase2=[2.4,.6,5.1,1.9]
 }
 pushRms(rms){
  const db=20*Math.log10(Math.max(1e-6,Number.isFinite(rms)?rms:0))
  this.room=follow(this.room,db,.1,db<this.room?.3:6)
  const floor=Math.max(-60,this.room)+16
  this.peak=follow(this.peak,Math.max(floor,db),.1,db>this.peak?.04:3)
  this.peak=Math.max(floor,this.peak)
  const lower=Math.max(Math.max(-60,this.room)+5,this.peak-24)
  this.goal=clamp((db-lower)/Math.max(1,this.peak-lower))
  this.a[this.head]=this.goal;this.b[this.head]=this.goal*.86
  this.head=(this.head+1)%HISTORY
 }
 past(history,age){
  const p=clamp(age,0,HISTORY-2),i=Math.floor(p),f=p-i
  const a=(this.head-1-i+HISTORY)%HISTORY,b=(a-1+HISTORY)%HISTORY
  return history[a]*(1-f)+history[b]*f
 }
 advance(dt,mode){
  if(!Number.isFinite(dt)||dt<=0)return
  const h=Math.min(.08,dt),voice=mode==='recording',busy=mode==='busy'
  this.time+=h
  const target=voice?this.goal:0
  this.voice=follow(this.voice,target,h,target>this.voice?.04:.12)
  this.energy=follow(this.energy,this.voice*this.voice*1.8,h,1.6)
  const rate=voice?1:busy?.15:0,speed=this.voice*.7+.58
  for(let i=0;i<4;i++){
   this.phase[i]+=h*TAU*rates[i]*speed*rate
   this.phase2[i]+=h*TAU*rates[i]*speed*.96*rate
  }
  this.processMix=follow(this.processMix,busy?1:0,h,.22)
 }
}
export class MatrixHoverIntent {
 constructor(){this.reset()}
 reset(x=null,y=null){this.active=false;this.x=x;this.y=y}
 move(x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y))return
  if(this.x===null||this.y===null){this.x=x;this.y=y}
  else if(Math.hypot(x-this.x,y-this.y)>=3)this.active=true
 }
}
const letters={C:['0111','1000','1000','1000','0111'],A:['0110','1001','1111','1001','1001'],N:['1001','1101','1011','1001','1001'],E:['1111','1000','1110','1000','1111'],L:['1000','1000','1000','1000','1111']}
function geometry(width){
 const size=COLS*ROWS,xy=new Float32Array(size*2),edge=new Float32Array(size),glyph=new Uint8Array(size)
 const ox=width/2-(COLS-1)*MATRIX_STEP/2,oy=MATRIX_HEIGHT/2-(ROWS-1)*MATRIX_STEP/2
 for(let x=0;x<COLS;x++)for(let y=0;y<ROWS;y++){
  const n=x*ROWS+y,px=ox+x*MATRIX_STEP,py=oy+y*MATRIX_STEP
  const dx=Math.max(0,Math.abs(px-width/2)-(width-MATRIX_HEIGHT)/2)
  const signed=MATRIX_HEIGHT/2-Math.hypot(dx,py-MATRIX_HEIGHT/2)
  xy[n*2]=px;xy[n*2+1]=py
  edge[n]=smooth((signed-1.1)/4.8)*(1-.55*smooth((Math.abs(py-MATRIX_HEIGHT/2)/(MATRIX_HEIGHT/2)-.37)/.63))
 }
 const left=Math.floor((COLS-29)/2),top=Math.floor((ROWS-5)/2)
 for(let k=0;k<6;k++)for(let y=0;y<5;y++)for(let x=0;x<4;x++)if(letters['CANCEL'[k]][y][x]==='1')glyph[(left+k*5+x)*ROWS+(top+y)]=1
 return {width,xy,edge,glyph,head:new Float32Array(size),tail:new Float32Array(size),path:[new Float32Array(COLS),new Float32Array(COLS)],strength:[new Float32Array(COLS),new Float32Array(COLS)]}
}
const base=[135/255,192/255,1],core=[229/255,242/255,1],amber=[216/255,154/255,121/255]
export class MatrixRenderer{
 constructor(){this.cache=new Map();this.temporary=null}
 _grid(w){
  const width=Math.max(40,Math.round(w))
  if(width===RECORD_WIDTH||width===PROCESS_WIDTH){
   if(!this.cache.has(width))this.cache.set(width,geometry(width))
   return this.cache.get(width)
  }
  if(this.temporary?.width!==width)this.temporary=geometry(width)
  return this.temporary
 }
 paint(cr,width,height,model,hover=0,exit=0){
  if(width<=0||height<=0)return 0
  const grid=this._grid(width),{xy,edge,glyph,path,strength}=grid
  const rec=1-model.processMix,work=model.processMix,t=model.time
  const amp=.75*(.55+.35*(.5+.5*Math.sin(t*TAU/5.5)))+3.85*Math.pow(model.voice,.63)
  const carrier=t*TAU*.17,mid=(ROWS-1)/2
  for(let x=0;x<COLS;x++){
   const u=x/(COLS-1),ends=Math.min(smooth(u*7),smooth((1-u)*7))
   for(let k=0;k<2;k++){
    const history=k===0?model.a:model.b,phases=k===0?model.phase:model.phase2
    const v=model.past(history,1+u*13)
    let spread=0
    for(let j=0;j<4;j++)spread+=coeff[j]*Math.sin(TAU*spatial[j]*u-phases[j])*v
    path[k][x]=mid+(k===0?-1:1)*ends*(amp*contour(TAU*1.55*u-carrier+(k===1?.12:0))+spread*2.05)*rec
    strength[k][x]=rec*(.61+.69*Math.sqrt(model.voice))*(.64+.36*ends)
   }
  }
  const headKeep=Math.exp(-1/(MATRIX_FPS*.15)),tailKeep=Math.exp(-1/(MATRIX_FPS*.6))
  const beam=(((t*.64)%1.42)-.19)*grid.width,morph=smooth(hover)
  let count=0
  for(let i=0;i<edge.length;i++){
   const mask=edge[i];if(mask<=.015)continue
   const x=xy[2*i],y=xy[2*i+1],col=Math.floor(i/ROWS),row=i%ROWS
   const da=row-path[0][col],db=row-path[1][col]
   const one=Math.exp(-da*da/.63)*strength[0][col],two=Math.exp(-db*db/.63)*strength[1][col]
   const current=1-(1-clamp(one))*(1-clamp(two))
   grid.head[i]=Math.max(grid.head[i]*headKeep,current*.75)
   grid.tail[i]=Math.max(grid.tail[i]*tailKeep,current*.84)
   const glow=Math.max(current,grid.head[i],grid.tail[i]*.43)
   const pass=Math.exp(-Math.pow((x-beam)/10,2))*1.35
   const center=Math.exp(-Math.pow((y-MATRIX_HEIGHT/2)/4.7,2))
   const working=clamp((.10+.12*Math.pow(Math.sin(TAU*1.25*x/grid.width-carrier),2)+pass)*center)
   let power=(glow*rec+working*work)*(1-.58*smooth(exit))
   power=power*(1-morph)+(glyph[i]?.98:.015)*morph
   const val=clamp(power),fresh=current/(glow+.0001)
   const radius=MATRIX_STEP*(.24+.20*Math.pow(val,.62))
   const alpha=(.077*(1-.65*smooth(Math.abs(y-MATRIX_HEIGHT/2)/(MATRIX_HEIGHT/2)))+.923*Math.pow(val,.78))*mask
   if(alpha<.009)continue
   const bright=Math.min(.97,val*val*1.15)*(.34+.66*clamp(fresh))
   const warning=morph*(glyph[i]?.88:.10)
   const red=(base[0]*(1-bright)+core[0]*bright)*(1-warning)+amber[0]*warning
   const green=(base[1]*(1-bright)+core[1]*bright)*(1-warning)+amber[1]*warning
   const blue=(base[2]*(1-bright)+core[2]*bright)*(1-warning)+amber[2]*warning
   if(val>.08){cr.setSourceRGBA(red,green,blue,.12*val*val*mask);cr.arc(x,y,radius*1.7,0,TAU);cr.fill()}
   cr.setSourceRGBA(red,green,blue,alpha);cr.arc(x,y,radius,0,TAU);cr.fill()
   count++
  }
  return count
 }
 paintSurface(cr,pw,ph,lw,model,hover=0,exit=0){
  if(pw<=0||ph<=0||lw<=0)return 0
  const scale=pw/lw;cr.scale(scale,scale)
  return this.paint(cr,pw/scale,ph/scale,model,hover,exit)
 }
 clear(){this.cache.clear();this.temporary=null}
}
