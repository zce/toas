// Headless tests for the production Cairo painter and 100 ms RMS history.
import { MatrixSignal, MatrixRenderer, MatrixHoverIntent, recordingLevel,
  RECORD_WIDTH, PROCESS_WIDTH, MATRIX_HEIGHT, MATRIX_STEP, MATRIX_FPS } from '../ui/matrix-hud.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

function context() {
  const dots=[]
  let color=[]
  let scale=1
  return {
    dots,
    setSourceRGBA: (...values) => { color=values },
    arc: (x,y,r) => { dots.push({x,y,r,color:[...color]}) },
    fill: () => {},
    scale: v => { scale=v },
    get scaleValue() { return scale }
  }
}

function signal(rms=.02, mode='recording') {
  const s=new MatrixSignal()
  for(let i=0;i<18;i++){s.pushRms(rms);s.advance(.1,'recording')}
  if(mode==='busy')for(let i=0;i<8;i++)s.advance(1/30,'busy')
  return s
}

test('v7.3 geometry: 174x42 has exactly 47 columns and 11 rows', () => {
  expectEqual(RECORD_WIDTH,174)
  expectEqual(PROCESS_WIDTH,116)
  expectEqual(MATRIX_HEIGHT,42)
  expectEqual(MATRIX_STEP,3.7)
  expectEqual(MATRIX_FPS,30)
  const r=new MatrixRenderer(),cr=context()
  r.paint(cr,RECORD_WIDTH,MATRIX_HEIGHT,signal(),0)
  const g=r._grid(RECORD_WIDTH,MATRIX_HEIGHT)
  expectEqual(g.cols,47)
  expectEqual(g.rows,11)
  expectTruthy(cr.dots.length>=400)
  expectTruthy(cr.dots.every(d => Number.isFinite(d.x)&&Number.isFinite(d.y)&&d.r===1.06))
})

test('all three strands anchor to the baseline at both endpoints', () => {
  const r=new MatrixRenderer(),s=signal(.025),cr=context()
  r.paint(cr,RECORD_WIDTH,MATRIX_HEIGHT,s,0)
  const g=r._grid(RECORD_WIDTH,MATRIX_HEIGHT),last=g.cols-1,base=MATRIX_HEIGHT/2
  for(const strand of [g.a,g.b,g.c]) {
    expectTruthy(Math.abs(strand[0]-base)<.00001)
    expectTruthy(Math.abs(strand[last]-base)<.00001)
    expectTruthy(strand.some((v,i)=>i>1&&i<last-1&&Math.abs(v-base)>1))
  }
})

test('fixed RMS mapping is monotonic without self-normalizing steady speech', () => {
  const values=[.0025,.004,.008,.016,.032,.064].map(recordingLevel)
  expectTruthy(values.every((v,i)=>v>0&&v<1&&(i===0||v>values[i-1])))
  expectEqual(recordingLevel(0),0)
  expectEqual(recordingLevel(NaN),0)
  expectEqual(recordingLevel(Infinity),0)
  expectEqual(recordingLevel(.5),1)
})

test('left to right history of 100 ms audio inputs is smoothed and bounded', () => {
  const s=new MatrixSignal()
  for(let i=0;i<18;i++){s.pushRms(i%4===0?.065:.003);s.advance(.1,'recording')}
  const slices=[0,.2,.5,.8,1].map(u=>s.audioHistory(u))
  expectTruthy(slices.every(v=>v>=0&&v<=1))
  expectTruthy(new Set(slices.map(v=>v.toFixed(4))).size>2)
  const historyBefore=s.history[s.history.length-1]
  s.pushRms(.03)
  expectEqual(s.history[s.history.length-2],historyBefore)
  expectTruthy(s.audioHistory(0)!==s.audioHistory(1))
})

test('two nested processing diamonds have different breath phases', () => {
  const r=new MatrixRenderer(),s=signal(.015,'busy'),cr=context()
  r.paint(cr,PROCESS_WIDTH,MATRIX_HEIGHT,s,0)
  const g=r._grid(PROCESS_WIDTH,MATRIX_HEIGHT)
  expectTruthy(s.processMix>.65)
  expectTruthy(g.outerX.some(v=>v>.1))
  expectTruthy(g.innerX.some(v=>v>.1))
  const old=g.outerX[Math.floor(g.cols*.25)],oldInner=g.innerX[Math.floor(g.cols*.25)]
  s.advance(.5,'busy');r.paint(context(),PROCESS_WIDTH,MATRIX_HEIGHT,s,0)
  expectTruthy(Math.abs(g.outerX[Math.floor(g.cols*.25)]-old)>.0001)
  expectTruthy(Math.abs(g.innerX[Math.floor(g.cols*.25)]-oldInner)>.0001)
})

test('inner shadow keeps top and bottom dot rows dim but not empty', () => {
  const r=new MatrixRenderer(),g=r._grid(RECORD_WIDTH,MATRIX_HEIGHT)
  const centerCol=Math.floor(g.cols/2),first=centerCol*g.rows
  const top=g.edges[first],middle=g.edges[first+Math.floor(g.rows/2)]
  const bottom=g.edges[first+g.rows-1]
  expectTruthy(top>0 && top<middle)
  expectTruthy(bottom>0 && bottom<middle)
})

test('CANCEL is centered amber dot typography with no extra line primitive', () => {
  const r=new MatrixRenderer(),s=signal(),a=context(),b=context()
  r.paint(a,RECORD_WIDTH,MATRIX_HEIGHT,s,0)
  r.paint(b,RECORD_WIDTH,MATRIX_HEIGHT,s,1)
  const isAmber=d=>d.color[0]===216/255
  expectEqual(a.dots.filter(isAmber).length,0)
  const glyph=b.dots.filter(isAmber)
  expectTruthy(glyph.length>30)
  expectTruthy(glyph.every(d=>Math.abs(d.x-RECORD_WIDTH/2)<40))
  expectTruthy(glyph.every(d=>Math.abs(d.y-MATRIX_HEIGHT/2)<9))
})

test('fresh motion is required for CANCEL on each new run', () => {
  const m=new MatrixHoverIntent()
  m.reset(100,200);m.move(100,200);m.move(101,201)
  expectEqual(m.active,false)
  m.move(105,203);expectEqual(m.active,true)
  m.reset(105,203);m.move(105,203)
  expectEqual(m.active,false)
  m.move(110,203);expectEqual(m.active,true)
})

test('1x and 2x Cairo canvases paint identical dot counts', () => {
  const r=new MatrixRenderer(),s=signal(),a=context(),b=context()
  r.paintSurface(a,174,42,174,s,0)
  r.paintSurface(b,348,84,174,s,0)
  expectEqual(a.dots.length,b.dots.length)
  expectEqual(a.scaleValue,1)
  expectEqual(b.scaleValue,2)
  expectEqual(r.getCacheSize(),1)
  r.paint(context(),PROCESS_WIDTH,MATRIX_HEIGHT,s,0)
  expectEqual(r.getCacheSize(),2)
  r.clear()
  expectEqual(r.getCacheSize(),0)
})

test('processing approaches one and then resets for the next recording', () => {
  const s=signal()
  for(let i=0;i<14;i++)s.advance(1/30,'busy')
  expectTruthy(s.processMix>.85)
  s.reset()
  expectEqual(s.processMix,0)
  expectEqual(s.time,0)
  expectEqual(s.audioHistory(.5),0)
  expectEqual(s.target,.06)
})

test('zero-size surface skips Cairo calls', () => {
  const r=new MatrixRenderer()
  expectEqual(r.paintSurface({},0,0,0,new MatrixSignal(),0),0)
})

await run()
