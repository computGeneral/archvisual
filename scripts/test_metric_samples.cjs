/* node --test scripts/test_metric_samples.cjs */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {plan}=require('../dataviewer/static/js/metric_samples.js');
const plain=value=>JSON.parse(JSON.stringify(value));

test('partial overlap queries only missing metrics and merges in selection order',()=>{
    const a=Object.freeze([1,null,3]),b=Object.freeze([-1,0,2]);
    const groups={G:{Sig:['b','a'],Max:20,Stack:true,Heat:{color:'row'}}};
    const p=plan(groups,new Map([['a',a]]));
    assert.deepEqual(plain(p.query),{G:{...groups.G,Sig:['b']}});
    const response={G:{...groups.G,Sig:{b}}},merged=p.merge(response);
    assert.deepEqual(Object.keys(merged.G.Sig),['b','a']);
    assert.equal(merged.G.Sig.a,a);assert.equal(merged.G.Sig.b,b);
    assert.equal(merged.G.Heat,groups.G.Heat);assert.equal(merged.G.Stack,true);
    assert.deepEqual(groups.G.Sig,['b','a']);assert.deepEqual(Object.keys(response.G.Sig),['b']);
});

test('fully reused groups require no query and retain independent settings',()=>{
    const values=Object.freeze([0,2]);
    const groups={A:{Sig:['p'],Max:10},B:{Sig:['p'],Max:100}};
    const p=plan(groups,new Map([['p',values]])),data=p.merge({});
    assert.deepEqual(Object.keys(p.query),[]);
    assert.equal(data.A.Sig.p,values);assert.equal(data.B.Sig.p,values);
    assert.equal(data.A.Max,10);assert.equal(data.B.Max,100);
});

test('captured references survive source deletion while later plans see eviction',()=>{
    const values=[1,2],available=new Map([['p',values]]),groups={A:{Sig:['p']}};
    const first=plan(groups,available);available.clear();
    assert.equal(first.merge({}).A.Sig.p,values);
    assert.deepEqual(plain(plan(groups,available).query),groups);
});

test('empty groups and missing backend values preserve their original validation behavior',()=>{
    const groups={Empty:{Sig:[]},Absent:{Sig:['missing']}};
    const p=plan(groups,new Map());assert.deepEqual(plain(p.query),groups);
    assert.deepEqual(plain(p.merge({Empty:{Sig:{}},Absent:{Sig:{}}})),{Empty:{Sig:{}},Absent:{Sig:{}}});
});

test('metric and group names cannot alias JavaScript object prototypes',()=>{
    const groups=JSON.parse('{"__proto__":{"Sig":["__proto__","constructor"]}}');
    const p=plan(groups,new Map([['__proto__',[1]],['constructor',[2]]]));
    assert.deepEqual(plain(p.merge({})),JSON.parse('{"__proto__":{"Sig":{"__proto__":[1],"constructor":[2]}}}'));
});
