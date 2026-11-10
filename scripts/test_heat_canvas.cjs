'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const canvas=require('../dataviewer/static/js/metric_heat_canvas.js');
const ec=require('../dataviewer/static/js/echarts.min.js');
const palette=['#f7fbff','#c6dbef','#6baed6','#2171b5','#fdae61','#d73027'];
test('CSS coordinate hit testing uses axis centers and keeps first/last and shared edges precise',()=>{
 for(const size of [1,4,16,8.375]) {
  const f={x:Array.from({length:7},(_,i)=>340+(i+.5)*size),y:[60,76],bandWidth:size,bandHeight:16};
  for(let c=0;c<7;c++)for(let r=0;r<2;r++)assert.deepEqual(canvas.hitTest(f,f.x[c],f.y[r]),{col:c,row:r});
  assert.deepEqual(canvas.hitTest(f,340,52),{col:0,row:0});
  assert.deepEqual(canvas.hitTest(f,340+size,68),{col:1,row:1});
  assert.equal(canvas.hitTest(f,340+7*size,60),null);assert.equal(canvas.hitTest(f,339,60),null);
  assert.equal(canvas.hitTest(f,350,84),null);
 }
 assert.equal(canvas.hitTest(null,0,0),null);
 assert.equal(canvas.hitTest({x:[],y:[],bandWidth:16,bandHeight:16},0,0),null);
});
test('color interpolation equals the real ECharts visual mapping, including bounds, negatives and fractions',()=>{
 const values=[-100,-50,-49.75,-1,-0,0,.25,.5,1,25,49.75,50,100,1e8];
 const chart=ec.init(null,null,{renderer:'svg',ssr:true,width:500,height:200});
 try {
  const fill=canvas.colorMap(ec,palette);
  for(const scale of [[-50,100],[0,1],[0,50]]) {
   chart.setOption({xAxis:{type:'category',data:values.map((_,i)=>i)},yAxis:{type:'category',data:['row']},
    visualMap:{min:scale[0],max:scale[1],dimension:2,inRange:{color:palette}},
    series:[{type:'heatmap',data:values.map((v,i)=>[i,0,v])}]});
   for(let i=0;i<values.length;i++)assert.equal(fill(values[i],scale),chart.getVisual({seriesIndex:0,dataIndex:i},'color'));
  }
  assert.equal(fill(null,[0,1]),'#b9bec5');assert.notEqual(fill(0,[0,1]),fill(null,[0,1]));
 } finally {chart.dispose();}
});
