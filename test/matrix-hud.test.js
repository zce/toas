import { MatrixSignal, MatrixRenderer, MatrixHoverIntent, contour, RECORD_WIDTH, PROCESS_WIDTH, MATRIX_HEIGHT, MATRIX_STEP, MATRIX_FPS } from '../ui/matrix-hud.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const ctx=()=>{const dots=[];let color=[]
 return {dots,setSourceRGBA:(...v)=>{color=v},arc:(x,y,r)=>dots.push({x,y,r,color}),fill(){},scale(){}}}
const signal=()=>{const s=new MatrixSignal();for(let i=0;i<28;i++){s.pushRms(.004+.02*Math.abs(Math.sin(i*.3)));s.advance(.1,'recording')}return s}
test('final HUD dimensions and angular contour',()=>{
 expectEqual(RECORD_WIDTH,164);expectEqual(PROCESS_WIDTH,136)
 expectEqual(MATRIX_HEIGHT,40);expectEqual(MATRIX_STEP,3.5);expectEqual(MATRIX_FPS,30)
 expectTruthy(Math.abs(contour(Math.PI/2)-1)<.00001)
 expectTruthy(Math.abs(contour(Math.PI))<.00001)
})
test('CANCEL uses exactly the same grid cells at both widths',()=>{
 const r=new MatrixRenderer()
 for(const width of [164,136]){
  const g=r._grid(width)
  expectEqual(g.edge.length,506)
  expectEqual(g.glyph.reduce((a,b)=>a+b,0),63)
  const lit=[];for(let i=0;i<506;i++)if(g.glyph[i])lit.push(g.xy[2*i])
  expectTruthy(Math.max(...lit)-Math.min(...lit)>85)
 }
})
test('recording and processing draw within one Cairo surface',()=>{
 const s=signal(),r=new MatrixRenderer(),a=ctx(),b=ctx()
 const rec=r.paint(a,164,40,s)
 for(let i=0;i<18;i++)s.advance(1/30,'busy')
 const proc=r.paint(b,136,40,s)
 expectTruthy(rec>350&&proc>280&&rec>proc)
 expectTruthy(a.dots.every(d=>d.r>0&&d.color[3]<=1))
})
test('hover changes existing dots to amber, no separate text layer',()=>{
 const s=signal(),r=new MatrixRenderer(),a=ctx(),b=ctx()
 r.paint(a,164,40,s,0);r.paint(b,164,40,s,1)
 expectTruthy(b.dots.some(d=>Math.abs(d.color[0]-216/255)<.001))
 expectTruthy(a.dots.every(d=>Math.abs(d.color[0]-216/255)>.001))
})
test('quiet and loud RMS differ; silence is not amplified to full',()=>{
 const s=new MatrixSignal()
 for(let i=0;i<28;i++)s.pushRms(.002)
 const quiet=s.goal
 for(let i=0;i<28;i++)s.pushRms(.02)
 expectTruthy(s.goal>quiet)
 for(let i=0;i<60;i++)s.pushRms(0)
 expectTruthy(s.goal<.2)
})
test('pointer cancel intent and voice history reset',()=>{
 const m=new MatrixHoverIntent();m.reset(100,200);m.move(101,200)
 expectEqual(m.active,false);m.move(105,200);expectEqual(m.active,true)
 m.reset(105,200);m.move(105,200);expectEqual(m.active,false)
 const s=signal();s.reset();expectEqual(s.time,0);expectEqual(s.goal,0)
})
test('a new recording clears cached phosphor from previous session',()=>{
 const s=signal(),r=new MatrixRenderer()
 r.paint(ctx(),164,40,s,0)
 const grid=r._grid(164)
 expectTruthy(grid.tail.some(x=>x>0))
 r.reset()
 expectTruthy(grid.tail.every(x=>x===0))
 expectTruthy(grid.head.every(x=>x===0))
})

test('same dot count at 1x and 2x; single contraction dims dots',()=>{
 const s=signal(),r=new MatrixRenderer(),a=ctx(),b=ctx(),c=ctx()
 expectEqual(r.paintSurface(a,164,40,164,s),r.paintSurface(b,328,80,164,s))
 r.paint(c,164,40,s,0,1)
 const light=o=>o.dots.reduce((n,d)=>n+d.color[3],0)
 expectTruthy(light(c)<light(a));r.clear();expectEqual(r.cache.size,0)
})
await run()
