'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const canvas=require('../dataviewer/static/js/metric_heat_canvas.js');
const ec=require('../dataviewer/static/js/echarts.min.js');
const palette=['#f7fbff','#c6dbef','#6baed6','#2171b5','#fdae61','#d73027'];
test('device geometry and CSS half-open hits follow the independent nominal grid without changing raw data',()=>{
 const api=canvas;
 const result={counts:{boundaries:0,hitProbes:0,pixelCenterProbes:0},maxObservedSnapError:0};
 function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function closeMetadata(actual, expected, label) {
  assert(Number.isFinite(actual), label + ': finite metadata required');
  // This checks only reported floating-point metadata, never a pixel or hit.
  const ulps = 16 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected));
  assert(Math.abs(actual - expected) <= ulps, `${label}: ${actual} != ${expected}`);
}
function expectedAxis(start, span, count, dpr, border) {
  const step = span / count;
  const expected = {nominal: [], fill: {start: [], end: []}, normal: {}, emphasis: {}};
  for (const group of ['normal', 'emphasis'])
    for (const edge of ['outerStart', 'innerStart', 'innerEnd', 'outerEnd']) expected[group][edge] = [];
  for (let i = 0; i <= count; ++i) expected.nominal.push((start + i * step) * dpr);
  for (let i = 0; i < count; ++i) {
    // Derive both sides independently from nominal-grid endpoints. Width is
    // never rounded separately, and no candidate helper supplies expectations.
    const low = start + i * step - 0.25;
    const high = start + (i + 1) * step + 0.25;
    expected.fill.start.push(low * dpr); expected.fill.end.push(high * dpr);
    for (const [group, width] of [['normal', border], ['emphasis', border * 2]]) {
      expected[group].outerStart.push((low - width / 2) * dpr);
      expected[group].innerStart.push((low + width / 2) * dpr);
      expected[group].innerEnd.push((high - width / 2) * dpr);
      expected[group].outerEnd.push((high + width / 2) * dpr);
    }
  }
  return {step, expected};
}
function checkAxis(axis, start, span, count, dpr, border, label) {
  const {step, expected} = expectedAxis(start, span, count, dpr, border);
  assert.equal(axis.count, count, label + '.count'); closeMetadata(axis.stepCss, step, label + '.stepCss');
  let max = 0;
  function edges(actual, ideal, errors, values, edgeLabel) {
    assert.equal(actual.length, values.length, edgeLabel + ': actual count');
    assert.equal(ideal.length, values.length, edgeLabel + ': ideal count');
    assert.equal(errors.length, values.length, edgeLabel + ': error count');
    for (let i = 0; i < values.length; ++i) {
      const name = `${edgeLabel}[${i}]`;
      assert(Number.isInteger(actual[i]), name + ': integer device boundary');
      // Math.round(-0.25) can be -0; +/-0 denote the same geometric boundary.
      assert(actual[i] === Math.round(values[i]), `${name}: ${actual[i]} != round(${values[i]})`);
      closeMetadata(ideal[i], values[i], name + '.ideal');
      const error = Math.abs(actual[i] - ideal[i]);
      assert(error <= 0.5, name + ': displacement exceeds 0.5 device pixel');
      closeMetadata(errors[i], actual[i] - ideal[i], name + '.error');
      max = Math.max(max, error); ++result.counts.boundaries;
    }
  }
  edges(axis.nominal, axis.ideal.nominal, axis.error.nominal, expected.nominal, label + '.nominal');
  for (const group of ['fill', 'normal', 'emphasis'])
    for (const edge of Object.keys(expected[group]))
      edges(axis[group][edge], axis.ideal[group][edge], axis.error[group][edge], expected[group][edge], label + '.' + group + '.' + edge);
  for (let i = 0; i < count; ++i) {
    assert(axis.nominal[i + 1] > axis.nominal[i], label + ': every cell owns >=1 device pixel');
    assert(axis.fill.end[i] > axis.fill.start[i], label + ': fill does not disappear');
    for (const group of ['normal', 'emphasis']) {
      const a = axis[group];
      assert(a.outerStart[i] <= a.innerStart[i] && a.innerStart[i] <= a.innerEnd[i] && a.innerEnd[i] <= a.outerEnd[i], label + '.' + group + ': ordered stroke boundaries');
    }
  }
  closeMetadata(axis.maxError, max, label + '.maxError');
  result.maxObservedSnapError = Math.max(result.maxObservedSnapError, max);
  return expected.nominal.map(Math.round);
}
function makeFrame(dpr, rowSize, columnWidth, origin, shape) {
  const [cols, rows] = shape, firstCol = 23, firstRow = 17;
  const times = Array.from({length: firstCol + cols}, (_, i) => i * 100);
  const data = Array.from({length: firstRow + rows}, (_, row) => ({
    name: 'geometry_metric_' + row,
    values: times.map((_, col) => (row + col) % 7 === 0 ? null : (row * 17 + col * 11) % 101 - 50),
    min: -50, max: 50
  }));
  return {
    rows: data, times, firstCol, lastCol: firstCol + cols, firstRow, lastRow: firstRow + rows,
    left: origin[0], top: origin[1], width: 1200, height: 760,
    gridWidth: cols * columnWidth, gridHeight: rows * rowSize,
    columnWidth, bandWidth: columnWidth, bandHeight: rowSize,
    x: Array.from({length: cols}, (_, i) => origin[0] + (i + 0.5) * columnWidth),
    y: Array.from({length: rows}, (_, i) => origin[1] + (i + 0.5) * rowSize),
    dpr, normal: false, scale: [-50, 50], hoverLayer: false
  };
}
function checkHit(api, frame, xs, ys) {
  const xcss = xs.map(x => x / frame.dpr), ycss = ys.map(y => y / frame.dpr);
  const xmid = (xcss[0] + xcss[1]) / 2, ymid = (ycss[0] + ycss[1]) / 2;
  function hit(x, y, expected, label) {
    assert.deepEqual(api.hitTest(frame, x, y), expected, label); ++result.counts.hitProbes;
  }
  function sweep(edges, horizontal) {
    // Compare CSS coordinates directly at b/DPR: multiplying back into device
    // coordinates can turn an exact edge into its predecessor through roundoff.
    const epsilon = 1e-7 / frame.dpr;
    edges.forEach((edge, i) => {
      for (const [delta, index] of [[-epsilon, i - 1], [0, i], [epsilon, i]]) {
        const wanted = index < 0 || index >= edges.length - 1 ? null :
          horizontal ? {col: index, row: 0} : {col: 0, row: index};
        hit(horizontal ? edge + delta : xmid, horizontal ? ymid : edge + delta, wanted,
          `${horizontal ? 'x' : 'y'} boundary ${i}, delta ${delta}`);
      }
    });
  }
  sweep(xcss, true); sweep(ycss, false);
  for (let y = 0; y < ycss.length - 1; ++y)
    for (let x = 0; x < xcss.length - 1; ++x)
      hit((xcss[x] + xcss[x + 1]) / 2, (ycss[y] + ycss[y + 1]) / 2, {col: x, row: y}, 'cell center');
  // Every device-pixel center across both axes belongs to exactly one interval.
  for (const [bounds, horizontal] of [[xs, true], [ys, false]]) {
    let index = 0;
    for (let pixel = bounds[0]; pixel < bounds.at(-1); ++pixel) {
      while (pixel >= bounds[index + 1]) ++index;
      const coordinate = (pixel + 0.5) / frame.dpr;
      hit(horizontal ? coordinate : xmid, horizontal ? ymid : coordinate,
        horizontal ? {col: index, row: 0} : {col: 0, row: index}, 'device pixel center');
      ++result.counts.pixelCenterProbes;
    }
  }
  for (const [x, y] of [[xcss[0] - 1, ymid], [xcss.at(-1), ymid], [xmid, ycss[0] - 1], [xmid, ycss.at(-1)]])
    hit(x, y, null, 'outside grid');
  hit(NaN, ymid, null, 'NaN x'); hit(xmid, NaN, null, 'NaN y');
  hit(Infinity, ymid, null, 'infinite x'); hit(xmid, -Infinity, null, 'infinite y');
}
 assert.equal(api.hitTest(null,0,0),null);
 let cases=0, normalCases=0, deviceFloorCases=0;
 for(const dpr of [1,1.25,1.3,1.5,2,.5,.75,.8])for(const rowSize of [16,8])
  for(const requestedWidth of [1,1.2,3.99,4,4.01,rowSize])
   for(const origin of [[0,0],[140.125,32.375],[140.5,48.5],[141.75,31.25],[140.8,32.4]])
    for(const shape of [[11,5],[1,1]]){
     const columnWidth=Math.max(requestedWidth,dpr>=1?1:(Math.ceil(100/dpr)+1)/100);
     const frame=freeze(makeFrame(dpr,rowSize,columnWidth,origin,shape));
     const before=JSON.stringify(frame),g=api.geometry(frame),border=columnWidth>=4?1:0;
     assert.equal(g.unit,'global-device-pixels');assert.equal(g.dpr,dpr);assert.equal(g.borderCss,border);
     assert.deepEqual(g.origin,{x:Math.floor((frame.left-2)*dpr),y:Math.floor((frame.top-2)*dpr)});
     assert.equal(g.width,Math.ceil((frame.left+frame.gridWidth+2)*dpr)-g.origin.x);
     assert.equal(g.height,Math.ceil((frame.top+frame.gridHeight+2)*dpr)-g.origin.y);
     const xs=checkAxis(g.x,frame.left,frame.gridWidth,shape[0],dpr,border,'x');
     const ys=checkAxis(g.y,frame.top,frame.gridHeight,shape[1],dpr,border,'y');
     closeMetadata(g.maxError,Math.max(g.x.maxError,g.y.maxError),'geometry.maxError');
     checkHit(api,frame,xs,ys);assert(g.maxError<=.5);
     assert.deepEqual(api.geometry(frame),g,'Repeated geometry is deterministic');
     assert.equal(JSON.stringify(frame),before,'Frozen frame and raw samples remain unchanged');
     const noisy=freeze({...frame,x:frame.x.map((v,i)=>v+(i%2?1:-1)*1e-10),y:frame.y.map(v=>v+1e-10)});
     assert.deepEqual(api.geometry(noisy),g,'ECharts center rounding cannot shift nominal geometry');++cases;
     if(dpr>=1)++normalCases;else ++deviceFloorCases;
    }
 assert.equal(normalCases,600);assert.equal(deviceFloorCases,360);assert.equal(cases,960);
 assert.equal(result.maxObservedSnapError,.5);
 // A direct reciprocal can place two rounded edges on one device pixel at
 // half-pixel ties. These reproduce the independently found positions.
 for(const [dpr,left,count]of[[.7,145,1],[.75,142,100],[.67,150,100],[.625,140,43],[.78125,144,13],[100/104,143,127]])for(const rowSize of[16,8]){
  const width=(Math.ceil(100/dpr)+1)/100,frame=freeze(makeFrame(dpr,rowSize,width,[left,32.375],[count,5]));
  const before=JSON.stringify(frame),g=api.geometry(frame),border=width>=4?1:0;
  const xs=checkAxis(g.x,frame.left,frame.gridWidth,count,dpr,border,'tie x');
  const ys=checkAxis(g.y,frame.top,frame.gridHeight,5,dpr,border,'tie y');
  checkHit(api,frame,xs,ys);assert.equal(JSON.stringify(frame),before);
 }
 const empty=freeze(makeFrame(1,16,16,[140,32],[0,0]));
 assert.equal(api.hitTest(empty,0,0),null);
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
