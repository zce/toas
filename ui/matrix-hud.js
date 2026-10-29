// Pure, allocation-light Cairo painter for Toas's optional matrix HUD.
// GJS Cairo uses camelCase. It draws DOTS ONLY, never separate curves/struts.
export const RECORD_WIDTH = 252
export const PROCESS_WIDTH = 158
export const MATRIX_HEIGHT = 52
export const MATRIX_FPS = 15
const STEP = 5.6, RADIUS = 1.5
const GLYPHS = {
 C:['01110','10001','10000','10000','10000','10001','01110'],
 A:['01110','10001','10001','11111','10001','10001','10001'],
 N:['10001','11001','10101','10101','10011','10001','10001'],
 E:['11111','10000','10000','11110','10000','10000','11111'],
 L:['10000','10000','10000','10000','10000','10000','11111']
}
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v))
const fade=v=>{const x=clamp(v);return x*x*(3-2*x)}
function dot(cr,x,y,r,a,warn=false) {
 if(a<.013)return
 if(warn)cr.setSourceRGBA(.86,.63,.47,clamp(a))
 else cr.setSourceRGBA(.91,.92,.95,clamp(a))
 cr.arc(x,y,r,0,Math.PI*2)
 cr.fill()
}
function drawCancel(cr,w,h,hover) {
 if(hover<.025)return
 const pitch=Math.min(STEP*1.13,(w-22)/35)
 const x0=w/2-35*pitch/2+pitch/2,y0=h/2-3*pitch
 for(let i=0;i<6;i++){
  const glyph=GLYPHS['CANCEL'[i]]
  for(let r=0;r<7;r++)for(let c=0;c<5;c++){
   if(glyph[r][c]!=='1')continue
   dot(cr,x0+(i*6+c)*pitch,y0+r*pitch,pitch*.28,hover*.86,true)
  }
 }
}
// Inputs: actual St.DrawingArea surface size, visual mode, elapsed time, RMS
// display level, and hover progress. No per-frame arrays or GLib dependencies.
export function paintMatrix(cr,w,h,mode,time,level,hover) {
 if(w<=0||h<=0)return 0
 const cols=Math.max(1,Math.floor(w/STEP)),rows=Math.max(1,Math.floor(h/STEP))
 const x0=(w-(cols-1)*STEP)/2,y0=(h-(rows-1)*STEP)/2
 const center=h/2,straight=Math.max(0,(w-h)/2)
 const recording=mode==='recording',busy=mode==='busy'
 const gain=clamp(level),regular=1-hover*.93
 const focus=w/2+w*.27*Math.sin(time*1.9)
 const tail=focus-20*Math.cos(time*1.9)
 let count=0
 for(let col=0;col<cols;col++){
  const x=x0+col*STEP,u=x/w
  const phase=u*15.5-time*2.15+.18*Math.sin(u*9+time*.6)
  const amp=(6+15*gain)*(.84+.1*Math.sin(time*.6+u*5))
  const rise=1.15*Math.sin(time*.9)+.6*Math.sin(time*.38+1)
  const a=center+rise+amp*Math.sin(phase)
  const b=center+rise-amp*Math.sin(phase+.22)
  const c=center+rise*.55+amp*.5*Math.sin(phase*.83+2+time*.27)
  const dx=(x-focus)/26,tx=(x-tail)/46
  const primary=1/(1+dx*dx*1.9),trail=1/(1+tx*tx*2.4)
  for(let row=0;row<rows;row++){
   const y=y0+row*STEP
   const inside=center-Math.hypot(Math.max(0,Math.abs(x-w/2)-straight),y-center)
   if(inside<=1.4)continue
   const edge=fade((inside-1.4)/10)*(.48+.52*fade(Math.min(x,w-x)/17))
   let signal=0
   if(recording){
    const da=(y-a)/6.5,db=(y-b)/6.5,dc=(y-c)/6.5
    signal=Math.max(1/(1+da*da*3),.87/(1+db*db*3),.53/(1+dc*dc*3))*(.36+.75*gain)
   }else if(busy){
    const dy=(y-center)/13,cy=1/(1+dy*dy*2.1),vx=(x-focus)/12
    signal=(.65*primary+.17*trail+.22/(1+vx*vx*2.5))*cy+.10/(1+dy*dy*3)
   }
   const alpha=clamp(((busy?.16:.085)+regular*signal)*edge)
   if(alpha>.013){dot(cr,x,y,RADIUS,alpha);count++}
  }
 }
 drawCancel(cr,w,h,hover)
 return count
}
