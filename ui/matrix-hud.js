// Faithful port of Matrix HUD v7.3's geometry and signal model.
// Cairo and GJS are only used by the caller. All dot coordinates are logical px.
export const RECORD_WIDTH = 174
export const PROCESS_WIDTH = 116
export const MATRIX_HEIGHT = 42
export const MATRIX_STEP = 3.7
export const MATRIX_FPS = 30

const HISTORY = 48
const TAU_RISE = 0.15
const TAU_FALL = 0.24
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const ease = v => { const x = clamp(v); return x*x*(3-2*x) }
const approach = (v, target, tau, dt) => v + (target-v)*(1-Math.exp(-dt/tau))

// Fixed input reference. No automatic per-utterance normalization, FFT or
// additional audio sampling beyond the host's existing 100 ms RMS windows.
export function recordingLevel(rms) {
  if (!Number.isFinite(rms)) return 0
  return clamp(Math.sqrt(Math.max(0, rms - 0.0015) / 0.085))
}

// A new HUD appearing under an idle mouse must NOT immediately show CANCEL.
export class MatrixHoverIntent {
  constructor() { this.reset() }
  reset(x = null, y = null) { this.active = false; this.x = x; this.y = y }
  move(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (this.x === null || this.y === null) { this.x = x; this.y = y }
    else if (Math.hypot(x-this.x, y-this.y) >= 3) this.active = true
  }
}

function hash(i, salt) {
  let x = Math.imul((i|0) ^ (salt*1664525), 0x45d9f3b)
  x ^= x >>> 16
  x = Math.imul(x, 0x45d9f3b)
  x ^= x >>> 16
  return (x >>> 0)/2147483647-1
}
function smoothNoise(x, salt) {
  const i = Math.floor(x), f = x-i, k = ease(f)
  return hash(i,salt)*(1-k) + hash(i+1,salt)*k
}

export class MatrixSignal {
  constructor() { this.history = new Float32Array(HISTORY); this.reset() }
  reset() {
    this.history.fill(0)
    this.time = 0
    this.sampleAt = 0
    this.signal = 0.06
    this.target = 0.06
    this.processMix = 0
    this.mode = 'recording'
  }
  pushRms(rms) {
    const level = recordingLevel(rms)
    this.history.copyWithin(0,1)
    this.history[HISTORY-1] = level
    this.target = level
    this.sampleAt = this.time
  }
  advance(dt, mode) {
    if (!Number.isFinite(dt) || dt <= 0) return
    const step = Math.min(dt, 0.075)
    this.time += step
    this.mode = mode
    this.signal = approach(this.signal, mode === 'recording' ? this.target : 0,
      this.signal < this.target ? TAU_RISE : TAU_FALL, step)
    this.processMix = approach(this.processMix, mode === 'recording' ? 0 : 1,
      mode === 'recording' ? 0.16 : 0.18, step)
  }
  _historyAt(index) {
    const x = clamp(index, 0, HISTORY-1), i = Math.floor(x), f = x-i
    const a = this.history[Math.max(0,i-1)], b = this.history[i]
    const c = this.history[Math.min(HISTORY-1,i+1)], d = this.history[Math.min(HISTORY-1,i+2)]
    const m1 = .33*(c-a), m2 = .33*(d-b), f2 = f*f, f3 = f2*f
    return clamp((2*f3-3*f2+1)*b+(f3-2*f2+f)*m1+(-2*f3+3*f2)*c+(f3-f2)*m2)
  }
  audioHistory(u) {
    // New RMS samples enter on the LEFT, old samples advance to the RIGHT.
    const age = 1+clamp(u)*13-clamp((this.time-this.sampleAt)/.1,0,1)
    const i = HISTORY-1-age
    return (this._historyAt(i-1)+2*this._historyAt(i)+this._historyAt(i+1))*.25
  }
}

const GLYPHS = {
  C:['01110','10001','10000','10000','10000','10001','01110'],
  A:['01110','10001','10001','11111','10001','10001','10001'],
  N:['10001','11001','10101','10101','10011','10001','10001'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  L:['10000','10000','10000','10000','10000','10000','11111']
}
function dot(cr, x, y, radius, alpha, warning = false) {
  if (alpha < 0.016) return false
  if (warning) cr.setSourceRGBA(216/255,154/255,121/255,clamp(alpha))
  else cr.setSourceRGBA(238/255,239/255,245/255,clamp(alpha))
  cr.arc(x,y,radius,0,Math.PI*2)
  cr.fill()
  return true
}
function drawCancel(cr, w, h, amount) {
  if (amount < .014) return
  const pitch = Math.min(2.05,w*.52/35)
  const left = (w-35*pitch)/2+pitch/2
  const top = h/2-3*pitch
  for (let i=0; i<6; i++) {
    const glyph = GLYPHS['CANCEL'[i]]
    for (let row=0; row<7; row++) for (let col=0; col<5; col++) {
      if (glyph[row][col] === '1')
        dot(cr,left+(i*6+col)*pitch,top+row*pitch,Math.max(.55,pitch*.33),amount*.82,true)
    }
  }
}

function geometry(w, h) {
  const cols = Math.max(2,Math.floor(w/MATRIX_STEP)), rows = Math.max(2,Math.floor(h/MATRIX_STEP))
  const capacity = cols*rows
  const xs = new Float32Array(capacity), ys = new Float32Array(capacity), edges = new Float32Array(capacity)
  const x0 = (w-(cols-1)*MATRIX_STEP)/2, y0 = (h-(rows-1)*MATRIX_STEP)/2
  const rad = h/2, straight = Math.max(0,(w-h)/2)
  let k=0
  for(let col=0;col<cols;col++)for(let row=0;row<rows;row++){
    const x=x0+col*MATRIX_STEP,y=y0+row*MATRIX_STEP
    const dx=Math.max(0,Math.abs(x-w/2)-straight)
    const inset=rad-Math.hypot(dx,y-h/2)
    // Soft internal shadow: even the outer dot rows remain slightly visible.
    const rim=inset<=0?0:ease(inset/1.4)*(.38+.62*ease(inset/8))
    xs[k]=x;ys[k]=y;edges[k]=rim*(.60+.40*ease(Math.min(x,w-x)/13));k++
  }
  return {width:w,height:h,cols,rows,capacity,xs,ys,edges,
    a:new Float32Array(cols),b:new Float32Array(cols),c:new Float32Array(cols),
    outerX:new Float32Array(cols),innerX:new Float32Array(cols),trailX:new Float32Array(cols),
    outerY:new Float32Array(rows),innerY:new Float32Array(rows),trailY:new Float32Array(rows)}
}

export class MatrixRenderer {
  constructor() { this._cache = new Map(); this._temporary = null }
  _grid(w,h) {
    const width = Math.max(20,Math.round(w)), height = Math.round(h)
    const stable = (width === RECORD_WIDTH || width === PROCESS_WIDTH) && height === MATRIX_HEIGHT
    const key = width
    if (stable && this._cache.has(key)) return this._cache.get(key)
    if (!stable && this._temporary?.width === width && this._temporary?.height === height) return this._temporary
    const g = geometry(width,height)
    if (stable) this._cache.set(key,g)
    else this._temporary = g // one entry, not a cache of every transition width
    return g
  }
  paint(cr,w,h,model,hover=0) {
    if (w<=0 || h<=0) return 0
    const grid=this._grid(w,h)
    const {xs,ys,edges,cols,rows,a,b,c,outerX,innerX,trailX,outerY,innerY,trailY}=grid
    const center=grid.height/2, t=model.time, mix=model.processMix
    const recording=1-mix, normal=1-hover*.94
    const presence=ease(model.signal/.3), field=.27+.30*presence
    const driftY=.23*smoothNoise(t*.19,271)
    const packetCenter=grid.width/2+6*smoothNoise(t*.24,415)
    const breath=.95+.17*Math.sin(t*2.08)
    const innerBreath=.98-.09*Math.sin(t*2.08+.8)
    const packetLight=.91+.09*Math.sin(t*2.08-.3)
    const base=.075+mix*.010
    for(let col=0;col<cols;col++){
      const x=xs[col*rows],u=x/grid.width
      if(recording>.005){
        const position=col/(cols-1)
        const anchored=Math.pow(Math.sin(Math.PI*position),1.5)
        const local=clamp(.25*model.signal+.75*model.audioHistory(u))
        const amp=2.4+10.8*Math.pow(local,.74)
        const phase=u*10.3-t*.68+.48*smoothNoise(u*1.45-t*.17,17)
          +.18*smoothNoise(u*2.8-t*.14,91)+.20*(local-model.signal)
        const wav=Math.sin(phase), float=.42*smoothNoise(u*1.1+t*.12,383)
        a[col]=center+anchored*(driftY+float+amp*wav)
        b[col]=center+anchored*(driftY+float-amp*Math.sin(phase+.16))
        c[col]=center+anchored*(driftY*.7+amp*.64*Math.sin(phase+1.53))
      }
      if(mix>.005){
        outerX[col]=Math.abs(x-packetCenter)/(22*breath)
        innerX[col]=Math.abs(x-packetCenter)/(10*innerBreath)
        trailX[col]=Math.abs(x-(packetCenter-10))/28
      }
    }
    if(mix>.005)for(let row=0;row<rows;row++){
      const y=Math.abs(ys[row]-center)
      outerY[row]=y/(10.8*breath)
      innerY[row]=y/(5.2*innerBreath)
      trailY[row]=y/11
    }
    let painted=0
    for(let col=0;col<cols;col++)for(let row=0;row<rows;row++){
      const i=col*rows+row, edge=edges[i]
      if(edge<.008)continue
      const y=ys[i]
      let wave=0,packet=0
      if(recording>.005){
        const da=(y-a[col])/1.7, db=(y-b[col])/1.7, dc=(y-c[col])/1.9
        wave=Math.max(Math.exp(-.5*da*da),.92*Math.exp(-.5*db*db),.24*Math.exp(-.5*dc*dc))
      }
      if(mix>.005){
        const outer=outerX[col]+outerY[row], inner=innerX[col]+innerY[row], trail=trailX[col]+trailY[row]
        const shell=Math.exp(-.5*((outer-.98)/.20)**2)
        const core=Math.exp(-.5*((inner-.87)/.24)**2)
        const balance=.67+.33*ease(Math.abs(y-center)/7.7)
        packet=packetLight*(.74*shell*balance+.21*core+.02*ease((1.05-trail)/.68))
      }
      const light=clamp((base+normal*(recording*field*wave+mix*packet))*edge)
      if(dot(cr,xs[i],y,1.06,light))painted++
    }
    drawCancel(cr,grid.width,grid.height,hover)
    return painted
  }
  paintSurface(cr,pixelWidth,pixelHeight,logicalWidth,model,hover=0) {
    if(pixelWidth<=0 || pixelHeight<=0 || logicalWidth<=0) return 0
    const scale=pixelWidth/logicalWidth
    cr.scale(scale,scale)
    return this.paint(cr,pixelWidth/scale,pixelHeight/scale,model,hover)
  }
  getCacheSize() { return this._cache.size }
  clear() { this._cache.clear(); this._temporary=null }
}
