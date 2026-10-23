import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const connection=process.env.CODESURF_TEST_DATABASE_URL;
test('Postgres serializes durable breakdown creation and keeps commit/base variants separate',{skip:!connection},async()=>{
 // Integration checks are opt-in and restricted to a local test database.
 const target=new URL(connection);assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname));process.env.DATABASE_URL=connection;
 const {cachedBreakdown}=await import('../review-breakdowns.js'),{pool}=await import('../database.js'),{transformationPlan}=await import('../transformations.js');
 const owner='cache-test-'+crypto.randomUUID(),url='https://github.com/acme/cache-tests/pull/1',head=crypto.randomBytes(20).toString('hex'),base=crypto.randomBytes(20).toString('hex'),identity={owner,url,head,base,pace:'moderate'};
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before:'const value = 1;\n',after:'const value = 2;\n'}],{head,base,explain:false});plan.steps=[];plan.story=[{ids:plan.operations.map(op=>op.id),title:'Update the value'}];let snapshots=0;
 const snapshot=async()=>{snapshots++;await new Promise(resolve=>setTimeout(resolve,40));return plan};
 try{
  const results=await Promise.all(Array.from({length:5},()=>cachedBreakdown(identity,snapshot)));assert.equal(snapshots,1);assert.equal(new Set(results.map(result=>result.row.id)).size,1);assert.equal(results.filter(result=>!result.hit).length,1);
  await pool.query("UPDATE review_breakdowns SET created_at=now()-interval '40 days' WHERE owner=$1",[owner]);const warm=await cachedBreakdown(identity,()=>{throw Error('Cached source must not be fetched again')});assert.equal(warm.hit,true);assert.deepEqual(warm.row.plan,results[0].row.plan);
  const otherPace=await cachedBreakdown({...identity,pace:'quick'},()=>{throw Error('Changing pace reuses the saved story and source')});assert.equal(otherPace.row.plan.pace,'quick');
  const newHead=crypto.randomBytes(20).toString('hex'),newBase=crypto.randomBytes(20).toString('hex');
  const updated=await cachedBreakdown({...identity,head:newHead},()=>({...plan,head:newHead})),retargeted=await cachedBreakdown({...identity,base:newBase},()=>({...plan,base:newBase}));assert.notEqual(updated.row.id,warm.row.id);assert.notEqual(retargeted.row.id,warm.row.id);
  const failedIdentity={...identity,head:crypto.randomBytes(20).toString('hex')};await assert.rejects(cachedBreakdown(failedIdentity,()=>{throw Error('Snapshot failed')}),/Snapshot failed/);const retried=await cachedBreakdown(failedIdentity,()=>({...plan,head:failedIdentity.head}));assert.equal(retried.hit,false,'a failed generation rolls back and releases its lock');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM review_breakdowns WHERE owner=$1',[owner])).rows[0].count,5);
 }finally{await pool.query('DELETE FROM review_sessions WHERE owner=$1',[owner]);await pool.query('DELETE FROM review_breakdowns WHERE owner=$1',[owner]);await pool.end()}
});
