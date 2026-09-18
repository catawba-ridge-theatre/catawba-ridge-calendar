import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeRound, escapeHTML, safeColor, calendarIdentity, createApi, SESSION_KEY} from '../site/core.mjs';

const user = {id:'11111111-1111-4111-8111-111111111111'};
const session = {user, access_token:'old', refresh_token:'refresh', expires_at:9999999999};
function setup(fetcher, initial = session) {
  const values = new Map(initial === null ? [] : [[SESSION_KEY, JSON.stringify(initial)]]);
  const storage = {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)};
  let expired = 0;
  return {api:createApi({storage,fetcher,onExpired:()=>expired++}), values, expired:()=>expired};
}
const round = n => Array.from({length:30}, (_,i)=>({round:n,day:i+1,amount:i+1}));

test('escapes text and attributes; rejects injected CSS', () => {
  assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(safeColor('red; background:url(https://example.com)'), '#123d2c');
  assert.equal(safeColor('#123d2c'), '#123d2c');
});
test('blank/markup names rejected; Unicode names get stable safe links', () => {
  assert.throws(()=>calendarIdentity('   ', user.id));
  assert.throws(()=>calendarIdentity('<img>', user.id));
  assert.equal(calendarIdentity(' 李 明 ',user.id).slug, `fundraiser-${user.id}`);
});
test('$465 stays accumulated toward $930 in encore round', () => {
  const result = activeRound({goal:465}, round(1));
  assert.equal(result.raised,465); assert.equal(result.goal,930); assert.equal(result.round,2);
});
test('reopened older rounds become available without losing later donations', () => {
  const result=activeRound({goal:465},[...round(1).filter(x=>x.day!==5),{round:2,day:10,amount:10}]);
  assert.equal(result.round,1); assert.equal(result.raised,470); assert.equal(result.goal,930);
  assert.ok(!result.sponsored.includes(5));
});
test('totals decrease after removal; stale raised field cannot inflate totals', () => {
  assert.equal(activeRound({goal:465,raised:900},[]).raised,0);
});
test('round 100 does not offer an invalid round 101', () => {
  const r=activeRound({goal:465},Array.from({length:100},(_,i)=>round(i+1)).flat());
  assert.equal(r.full,true); assert.equal(r.round,100);
});
test('empty successful responses never cause JSON parsing errors', async () => {
  const {api}=setup(async()=>new Response(null,{status:204}));
  assert.equal(await api.request('rest/v1/sponsored_days',{method:'POST'}),null);
});
test('bad session storage recovers safely', () => {
  const {api,values}=setup(async()=>{}); values.set(SESSION_KEY,'{broken');
  assert.equal(api.getSession(),null); assert.equal(values.size,0);
});
test('parallel expired requests share one refresh and use the new token', async () => {
  let refreshes=0; const headers=[];
  const {api}=setup(async(path, options)=>{
    if(path.includes('refresh_token')){refreshes++; await new Promise(r=>setTimeout(r,5)); return Response.json({...session,access_token:'new'});}
    headers.push(options.headers.Authorization); return Response.json([]);
  },{...session,expires_at:1});
  await Promise.all([api.request('rest/v1/a',{},true),api.request('rest/v1/b',{},true)]);
  assert.equal(refreshes,1); assert.deepEqual(headers,['Bearer new','Bearer new']);
});
test('network failure never retries a reservation POST', async () => {
  let calls=0;const {api}=setup(async()=>{calls++;throw new Error('offline');});
  await assert.rejects(api.request('rest/v1/sponsored_days',{method:'POST'}), /Refresh/);
  assert.equal(calls,1);
});
test('a 401 refreshes once; rejected refresh clears the session',async()=>{
  const {api,expired}=setup(async()=>Response.json({message:'expired'},{status:401}));
  await assert.rejects(api.request('rest/v1/participants',{},true));
  assert.equal(api.getSession(),null);assert.equal(expired(),1);
});
test('signing out during refresh does not resurrect a session', async()=>{
  let resolve;const gate=new Promise(r=>resolve=r);
  const {api}=setup(async()=>{await gate;return Response.json(session);},{...session,expires_at:1});
  const pending=api.request('rest/v1/a',{},true);
  api.clearSession();resolve();await assert.rejects(pending);
  assert.equal(api.getSession(),null);
});
test('conflict errors are readable and hide database details', async()=>{
  const {api}=setup(async()=>Response.json({code:'23505',message:'internal unique constraint name'},{status:409}));
  await assert.rejects(api.request('rest/v1/sponsored_days'),e=>e.status===409 && !e.message.includes('constraint'));
});
test('pagination includes reservations beyond the first API page',async()=>{
  let calls=0;const {api}=setup(async()=>Response.json(Array.from({length:++calls===1?500:2},(_,i)=>({id:i}))));
  assert.equal((await api.list('rest/v1/sponsored_days?select=id')).length,502);
  assert.equal(calls,2);
});
