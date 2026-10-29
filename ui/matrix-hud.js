// Pure, allocation-light Cairo painter for Toas's dot-matrix HUD.
// GJS Cairo uses camelCase. It draws DOTS ONLY, never separate curves/struts.
export const RECORD_WIDTH = 174
export const PROCESS_WIDTH = 116
export const MATRIX_HEIGHT = 38
export const MATRIX_FPS = 15
const STEP = 4.7, RADIUS = 1.25

// Smooth the display signal only, using the existing 15 FPS animation.
export function smoothMatrixLevel(current, target, seconds) {
 const dt=clamp(seconds,0,.1)
 const response=target > current ? 0.17 : 0.26
 return current+(target-current)*dt/(response+dt)
}

// Preserve mic loudness differences instead of normalizing every spoken
// phrase into the same waveform size. A fixed quiet floor and gently
// compressed upper range are easier to tune and cost almost nothing.
export function recordingLevel(rms) {
 if(!Number.isFinite(rms)) return 0
 return Math.sqrt(clamp((rms-.0016)/.08))
}

// Hover must be caused by pointer movement in this *presentation*, not by
// Shell's sticky track_hover state from a previous recording.
export class MatrixHoverIntent {
 constructor(){this.reset()}
 reset(x = null, y = null) {
  this.active = false
  this.x = x
  this.y = y
 }
 move(x, y) {
  if(!Number.isFinite(x) || !Number.isFinite(y)) return
  if(this.x === null || this.y === null) {
   this.x = x
   this.y = y
  } else if(Math.abs(x-this.x)+Math.abs(y-this.y) >= 3) {
   this.active = true
  }
 }
}
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
 const pitch=Math.min(2.05,w*.51/35)
 const x0=w/2-35*pitch/2+pitch/2,y0=h/2-3*pitch
 for(let i=0;i<6;i++){
  const glyph=GLYPHS['CANCEL'[i]]
  for(let r=0;r<7;r++)for(let c=0;c<5;c++){
   if(glyph[r][c]!=='1')continue
   dot(cr,x0+(i*6+c)*pitch,y0+r*pitch,pitch*.32,hover*.85,true)
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
 // The same luminance for every dot; calculate the root just once per frame.
 const waveLight=.94*Math.sqrt(gain)
 const focus=w/2+w*.27*Math.sin(time*1.9)
 const tail=focus-12*Math.cos(time*1.9)
 let count=0
 for(let col=0;col<cols;col++){
  const x=x0+col*STEP,u=x/w
  const phase=u*15.5-time*2.15+.18*Math.sin(u*9+time*.6)
  // Shape has a modest minimum radius when active. Loudness still controls
  // the spread; the three phases weave instead of collapsing to a center row.
  const amp=(4.2+7.3*gain)*(.92+.06*Math.sin(time*.6+u*5))
  const rise=.55*Math.sin(time*.9)+.24*Math.sin(time*.38+1)
  const a=center+rise+amp*Math.sin(phase)
  const b=center+rise+amp*Math.sin(phase+2.18)
  const c=center+rise*.7+amp*.78*Math.sin(phase+4.12+time*.16)
  const dx=(x-focus)/17,tx=(x-tail)/27
  const primary=1/(1+dx*dx*1.9),trail=1/(1+tx*tx*2.4)
  for(let row=0;row<rows;row++){
   const y=y0+row*STEP
   const inside=center-Math.hypot(Math.max(0,Math.abs(x-w/2)-straight),y-center)
   if(inside<=1.4)continue
   const edge=fade((inside-1.4)/7)*(.48+.52*fade(Math.min(x,w-x)/13))
   let signal=0
   if(recording){
    // Tighter per-strand light keeps adjacent rows from merging into a bar.
    const da=(y-a)/2.8,db=(y-b)/2.8,dc=(y-c)/2.8
    signal=Math.max(1/(1+da*da*2.1),.86/(1+db*db*2.1),.43/(1+dc*dc*2.1))*waveLight
   }else if(busy){
    const dy=(y-center)/9,cy=1/(1+dy*dy*2.1),vx=(x-focus)/9
    signal=(.65*primary+.17*trail+.22/(1+vx*vx*2.5))*cy+.10/(1+dy*dy*3)
   }
   const alpha=clamp(((busy?.16:.085)+regular*signal)*edge)
   if(alpha>.013){dot(cr,x,y,RADIUS,alpha);count++}
  }
 }
 drawCancel(cr,w,h,hover)
 return count
}

// Use the actor's logical width to retain one dot grid at every display scale.
// At 2x backing resolution Cairo scales coordinates, not the number of dots.
export function paintMatrixSurface(cr, pixelWidth, pixelHeight, logicalWidth, mode, time, level, hover) {
 if(pixelWidth<=0 || pixelHeight<=0 || logicalWidth<=0)return 0
 const scale=pixelWidth/logicalWidth
 cr.scale(scale,scale)
 return paintMatrix(cr,pixelWidth/scale,pixelHeight/scale,mode,time,level,hover)
}
