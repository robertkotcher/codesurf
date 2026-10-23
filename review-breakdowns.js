import crypto from 'node:crypto';
import {pool} from './database.js';
import {checkedStep,remainingEdits,reviewPace} from './review-sessions.js';
import {planStory,reconcileStory} from './review-story.js';
import {validatePlan} from './public/transformations.js';

export async function completeBreakdown(original){
 const plan=structuredClone(original);plan.steps||=[];const remaining=remainingEdits(plan);
 if(!remaining.length){validatePlan(plan);return plan}
 const chapters=reconcileStory(remaining,plan.story||await planStory(plan,remaining));
 if(!plan.story)plan.story=[...plan.steps.map(step=>({ids:step.ids,title:step.title,shortTitle:step.shortTitle,summary:step.summary})),...chapters];
 const size={guided:3,moderate:16,quick:256}[reviewPace(plan.pace)];
 for(const chapter of chapters)for(let from=0;from<chapter.ids.length;from+=size){
  // The story already supplies the narrative and edit IDs. Deterministically
  // materialize it once, rather than asking AI to select each step again.
  plan.steps.push(checkedStep({...chapter,ids:chapter.ids.slice(from,from+size),blocks:[]},remaining,{min:1,max:256}));
 }
 validatePlan(plan);return plan;
}

export async function cachedBreakdown({owner,url,head,base,pace},snapshot){
 if(!pool)throw Object.assign(new Error('Review storage is not configured.'),{status:503});
 reviewPace(pace);const identity=[owner,url,head,base,pace],client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize creation across deployment instances, not just within one process.
  // All queries on this lock use its connection to avoid pool starvation.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(identity)]);
  let row=(await client.query('SELECT * FROM review_breakdowns WHERE owner=$1 AND pr_url=$2 AND head=$3 AND base=$4 AND pace=$5',identity)).rows[0];
  if(row&&remainingEdits(row.plan).length===0){validatePlan(row.plan);await client.query('COMMIT');return {row,hit:true}}
  let plan=row?.plan;
  if(!plan)plan=(await client.query("SELECT plan FROM review_sessions WHERE owner=$1 AND pr_url=$2 AND head=$3 AND plan->>'head'=$3 AND plan->>'base'=$4 AND COALESCE(plan->>'pace','guided')=$5 ORDER BY jsonb_array_length(plan->'steps') DESC,updated_at DESC LIMIT 1",identity)).rows[0]?.plan;
  if(!plan){const other=(await client.query('SELECT plan FROM review_breakdowns WHERE owner=$1 AND pr_url=$2 AND head=$3 AND base=$4 ORDER BY created_at LIMIT 1',identity.slice(0,4))).rows[0]?.plan;if(other)plan={...other,steps:[],story:other.story||other.steps.map(step=>({ids:step.ids,title:step.title,shortTitle:step.shortTitle,summary:step.summary}))}}
  if(!plan)plan={...await snapshot(),steps:[]};
  if(plan.head!==head||plan.base!==base)throw Object.assign(new Error('The pull request comparison changed. Reopen it to review the updated changes.'),{status:409,code:'PR_REVISION_CHANGED'});
  plan=await completeBreakdown({...plan,pace});
  if(row)row=(await client.query('UPDATE review_breakdowns SET plan=$1 WHERE id=$2 RETURNING *',[JSON.stringify(plan),row.id])).rows[0];
  else row=(await client.query('INSERT INTO review_breakdowns(id,owner,pr_url,head,base,pace,plan) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[crypto.randomUUID(),...identity,JSON.stringify(plan)])).rows[0];
  await client.query('COMMIT');return {row,hit:false};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
}
