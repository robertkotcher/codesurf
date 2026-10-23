import {reviewOutline} from './review-outline.js';
import {reviewLocation,reviewChangeURL} from './review-url.js';
import {createSidebarResizer} from './resize-sidebar.js';
import {mergeVariableBindings} from './variable-data.js';
import {createReviewLoading} from './review-loading.js';
import {commentDraftKey,mergeCommentThreads} from './canvas-comments.js';
import {reviewFileURL} from './files-route.js';
import {createCanvasChats} from './canvas-chat.js';
import {readChatStream} from './chat-stream.js';
import {icon} from './canvas-icons.js';
import {canvasConnectionKey,preparedCanvasPage} from './canvas-preload.js';
import {canvasChanges} from './canvas-model.js';
import {createReviewCanvas,escapeHTML as esc} from './review-canvas.js';
import {sortSavedPulls} from './saved-pulls.js';
const $=id=>document.getElementById(id),post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
let pr=null,session=null,plan=null,count=0,done=false,generation=0,pending=null,nextError='',moving=false,saved=[],user=null,library=[],libraryKind='my',older=false,libraryGeneration=0,status={},abort=new AbortController(),contextData={relations:[]},saveBusy=false,saveRevision=0;
let chats,outlineMarkup='';
$('resizeOutline').innerHTML=icon('resize');
createSidebarResizer({sidebar:$('reviewOutline'),handle:$('resizeOutline'),container:$('canvasShell')});
const loading=createReviewLoading({surface:$('reviewSurface'),overlay:$('reviewLoading'),regions:[$('reviewSubheader'),$('canvasShell')]});
const loadingTasks=(changes='done')=>[{id:'pull',label:'Pull request',status:'done'},{id:'changes',label:'Logical changes',status:changes},{id:'comments',label:'Comments',status:'waiting'},{id:'connections',label:'Callers and callees',status:'waiting'}];
const graph=createReviewCanvas({viewport:$('canvas'),stage:$('canvasStage'),world:$('canvasWorld'),fileURL:path=>pr?reviewFileURL(pr,path):null,onExpand:confirmExpansion,onChat:openCanvasChat,onExcerpt:expandExcerpt,commentActions:{onOpen:openLineComment,onEdit:editLineComment,onPost:postLineComment,onCancel:cancelLineComment,onReply:replyToComment},onLayout:()=>chats?.layout()});
chats=createCanvasChats({viewport:$('canvas'),stage:$('canvasStage'),geometry:graph.geometry,request:streamCanvasChat});
const commentReads=new Map(),stepContexts=new Map(),preparedContexts=new Map(),preloadTasks=new Map();let pendingSelection=null;
async function api(path,options={}){const response=await fetch(path,options);const body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.error||'The request could not be completed.'),{status:response.status,code:body.code});return body}
let toastTimer;function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000)}
function reviewMode(enabled){document.body.classList.toggle('reviewing',enabled);$('openForm').hidden=enabled}
function showState(title,message='',loading=false,retry=null){$('reviewOutline').hidden=true;$('reviewSubheader').hidden=true;$('canvasControls').hidden=true;$('canvasStage').hidden=true;$('canvasState').hidden=false;$('canvasState').innerHTML=`${loading?'<span class="spinner" aria-hidden="true"></span>':'<div class="welcome-mark" aria-hidden="true">≈</div>'}<h1>${esc(title)}</h1><p role="status">${esc(message)}</p>${retry?'<button id="retryLoad" class="primary">Try again</button>':''}`;if(retry)$('retryLoad').onclick=retry}
function offerSignIn(){const link=document.createElement('a');link.href='/auth/github';link.className='github-sign';link.innerHTML='<img src="/github-mark.svg" width="18" height="18" alt="">Continue with GitHub';$('canvasState').append(link)}
function route(url){return '/github'+new URL(url).pathname}
function rememberReview(url,position){try{sessionStorage.setItem('codesurf-pending-pr',url);sessionStorage.setItem('codesurf-pending-review-position',JSON.stringify({url,...position}))}catch{}}
function directPR(){const match=location.pathname.match(/^\/github(\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?)$/);return match?'https://github.com'+match[1]:null}
function syncReviewURL(mode='push'){
 const url=reviewChangeURL(pr.url,count,pr.head,plan.base);if(location.pathname+location.search!==url)history[mode==='replace'?'replaceState':'pushState']({},'',url);
}
function showRevisionChanged(message){
 const url=pr?.url||directPR();abort.abort();++generation;pending=null;moving=false;plan=null;session=null;count=0;loading.clear();chats.clear();$('connectionDialog').close();$('emptyConnectionDialog').close();
 showState('This pull request has changed.',message||'New commits are available. Load the updated pull request to prepare its changes.');
 const button=document.createElement('button');button.className='primary';button.textContent='Load updated changes';button.onclick=()=>openPR(url);$('canvasState').append(button);controls();
}
function controls(){renderOutline();const ready=!!plan&&count<plan.steps.length;$('previous').disabled=loading.busy()||moving||count<=1;$('next').disabled=loading.busy()||moving||!plan||!ready&&done&&!nextError;$('next').textContent=nextError?'Retry':!ready&&pending?'Preparing…':'Next';$('next').title=done&&!ready?'All available changes reviewed':nextError||'Next logical change';$('savePR').disabled=!pr||!user||saveBusy;$('savePR').hidden=!pr;$('completeReview').disabled=loading.busy()||!pr;if(plan&&count>0){$('stepCounter').textContent=done?`Change ${count} of ${plan.steps.length}`:`Change ${count}`}}
function renderOutline(){
 const visible=!!plan&&count>0&&!$('canvasStage').hidden,items=reviewOutline(plan,count),list=$('outlineList');
 $('reviewOutline').hidden=!visible;$('reviewSubheader').hidden=!visible;
 $('outlineCount').textContent=items.length?String(items.length):'';
 // Keep focused outline buttons intact as background preparation finishes.
 const html=items.map(item=>`<li class="${item.active?'active':item.reviewed?'reviewed':''}">${item.step?`<button type="button" data-outline-step="${item.step}" ${item.active?'aria-current="step"':''} ${moving||loading.busy()?'disabled':''}>`:'<div class="outline-upcoming">'}<span class="outline-number" aria-hidden="true">${item.number}.</span><span class="outline-description">${esc(item.title)}</span>${item.step?'</button>':'</div>'}</li>`).join('');if(outlineMarkup!==html){list.innerHTML=html;outlineMarkup=html}
}
$('outlineList').onclick=event=>{const button=event.target.closest('[data-outline-step]');if(button)navigateChange(Number(button.dataset.outlineStep))};
function savedState(){const exists=pr&&saved.some(item=>item.url.toLowerCase()===pr.url.toLowerCase());$('savePR').innerHTML=icon(exists?'saved':'bookmark');$('savePR').setAttribute('aria-pressed',String(!!exists));$('savePR').title=exists?'Remove saved pull request':'Save pull request';$('savePR').setAttribute('aria-label',$('savePR').title)}
async function openPR(url,navigate=true,position={change:1}){
 reviewMode(true);loading.clear();
 abort.abort();abort=new AbortController();const signal=abort.signal,g=++generation;pr=null;session=null;plan=null;count=0;pending=null;moving=false;done=false;nextError='';commentReads.clear();stepContexts.clear();preparedContexts.clear();preloadTasks.clear();chats.clear();pendingSelection=null;$('connectionDialog').close();$('emptyConnectionDialog').close();$('reviewDialog').close();$('reviewBody').value='';$('postedReview').hidden=true;controls();$('prHeading').hidden=true;showState('Breaking this change into logical chunks…','Fetching the pull request and finding connected changes.',true);
 const tasks=loadingTasks('waiting');tasks[0].status='loading';const ticket=loading.begin(tasks);
 try{
  pr=await api('/api/pr?'+new URLSearchParams({url}),{signal});if(g!==generation)return;if(position.head&&position.head!==pr.head){showRevisionChanged('New commits are available. Load the updated pull request to prepare its changes.');return}loading.update(ticket,'pull','done');loading.update(ticket,'changes','loading');
  $('url').value=pr.url;$('repo').textContent=pr.repo;$('prTitle').textContent=pr.title;$('prNumber').textContent='#'+pr.number;$('prTitle').title=pr.title;$('prHeading').hidden=false;if(navigate&&location.pathname+location.search!==route(pr.url))history.pushState({},'',route(pr.url));savedState();controls();
  const result=await api('/api/reviews',{...post({url:pr.url,head:pr.head,pace:'moderate',...position.base?{base:position.base}:{}}),signal});if(g!==generation)return;
  session=result.id;plan=result.plan;count=0;done=result.done;
  if(!plan.operations.length){loading.clear();showState('No reviewable changes.','This PR has no available text changes to break apart.');controls();return}
  if(!plan.steps.length&&!done)await prepareNext();if(g!==generation)return;
  if(position.change>plan.steps.length){loading.clear();showState('This change is unavailable.',`This review has ${plan.steps.length} changes.`);const button=document.createElement('button');button.className='primary';button.textContent='Go to the first change';button.onclick=()=>openPR(pr.url);$('canvasState').append(button);return}
  await navigateChange(position.change,{historyMode:'replace',ticket});
 }catch(error){if(g!==generation||error.name==='AbortError')return;if(error.code==='PR_REVISION_CHANGED'){showRevisionChanged(error.message);return}loading.clear();showState('This pull request could not be opened.',error.message,false,()=>openPR(url,false,position));if(error.status===401){rememberReview(url,position);offerSignIn()}if(error.status===404){const button=document.createElement('button');button.textContent='Check repository connections';button.onclick=openSettings;$('canvasState').append(button)}controls()}
}
async function prepareNext(){
 if(!plan)return;if(plan.steps.length>count){preloadConnections(count+1).catch(()=>{});return}if(done)return;if(pending)return pending;
 const g=generation,id=session,index=plan.steps.length;nextError='';
 const work=(async()=>{try{const result=await api('/api/reviews/'+id+'/next',{...post({index}),signal:abort.signal});if(g!==generation)return;if(Array.isArray(result.story))plan.story=result.story;if(result.step&&!plan.steps[index])plan.steps.push(result.step);if(result.step)preloadConnections(index+1).catch(()=>{});done=result.done}catch(error){if(g!==generation||error.name==='AbortError')return;if(error.code==='PR_REVISION_CHANGED'){showRevisionChanged(error.message);return}nextError=error.message;toast(error.message);if(!count){loading.clear();showState('This change could not be prepared.',error.message,false,()=>openPR(pr.url,false))}}finally{if(g===generation){pending=null;controls()}}})();
 pending=work;controls();return work;
}
async function advance(delta){return navigateChange(count+delta)}
async function navigateChange(target,{historyMode='push',ticket:initialTicket}={}){
 if(!plan||moving||loading.busy()&&count>0||!Number.isInteger(target)||target<1||target===count||target>plan.steps.length+1)return;const g=generation;moving=true;const ticket=initialTicket||loading.begin(loadingTasks('loading'));controls();
 try{
  if(target>plan.steps.length){if(done){loading.clear();return}await prepareNext();if(g!==generation)return;if(target>plan.steps.length){loading.clear();return}}
  if(target>count)await api('/api/reviews/'+session+'/progress',{...post({cursor:target}),signal:abort.signal});if(g!==generation)return;count=target;if(historyMode!=='none')syncReviewURL(historyMode);await showChange(ticket);
 }catch(error){if(g===generation&&error.name!=='AbortError'){if(error.code==='PR_REVISION_CHANGED'){showRevisionChanged(error.message);return}loading.update(ticket,'changes','error');loading.fail(ticket,error.message,()=>{loading.clear();navigateChange(target)})}}finally{if(g===generation){moving=false;controls()}}
}
function preloadConnections(step){
 if(preparedContexts.has(step))return Promise.resolve(preparedContexts.get(step));
 if(preloadTasks.has(step))return preloadTasks.get(step);
 const g=generation,id=session,url=pr.url,head=pr.head;
 const work=api('/api/reviews/'+id+'/canvas/preload',{...post({url,head,step}),signal:abort.signal}).then(data=>{if(g===generation){preparedContexts.set(step,data);if(step===count&&step>0)graph.affordances(data.affordances,data.excerpts)}return data}).finally(()=>{if(preloadTasks.get(step)===work)preloadTasks.delete(step)});
 preloadTasks.set(step,work);return work;
}
async function showChange(ticket=loading.begin(loadingTasks())){
 const change=canvasChanges(plan,count);change.counter=done?`${count} / ${plan.steps.length}`:String(count);change.complete=done&&count===plan.steps.length;change.unavailable=plan.files.filter(file=>file.unavailable);pendingSelection=null;$('connectionDialog').close();$('emptyConnectionDialog').close();$('canvasState').hidden=true;$('canvasStage').hidden=false;$('reviewSubheader').hidden=false;$('canvasControls').hidden=false;graph.show(change);chats.showStep(count);contextData=stepContexts.get(count)||{relations:[],requests:[]};contextData.commentUser=user;stepContexts.set(count,contextData);if(contextData.relations.length||contextData.requests.length||Object.keys(contextData.excerpts||{}).length||contextData.threads?.length||Object.keys(contextData.commentDrafts||{}).length)graph.context(contextData);controls();
 const ready=preparedContexts.get(count);if(ready)graph.affordances(ready.affordances,ready.excerpts);
 await readyChange(ticket);
}
async function readyChange(ticket){
 const g=generation,c=count;loading.update(ticket,'changes','done');controls();
 const run=async(id,task)=>{loading.update(ticket,id,'loading');try{await task();if(g===generation&&c===count)loading.update(ticket,id,'done')}catch(error){if(g===generation&&c===count&&error.name!=='AbortError')loading.update(ticket,id,'error');throw error}};
 const results=await Promise.allSettled([run('comments',()=>loadLineComments(c)),run('connections',()=>preloadConnections(c))]);
 if(g!==generation||c!==count)return;
 const failed=results.find(result=>result.status==='rejected');
 if(failed?.reason.code==='PR_REVISION_CHANGED'){showRevisionChanged(failed.reason.message);return}
 if(failed){loading.fail(ticket,failed.reason.message,()=>{const retry=loading.begin(loadingTasks());readyChange(retry)});controls();return}
 // Include the DOM updates and layout in readiness, not just the HTTP responses.
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 if(g!==generation||c!==count)return;loading.finish(ticket);controls();prepareNext();
}
function commentState(){const state=stepContexts.get(count);if(state){state.commentDrafts||={};state.commentUser=user}return state}
function updateComments(state,step){if(step===count){contextData=state;graph.context(state)}}
function loadLineComments(step){
 if(commentReads.has(step))return commentReads.get(step);
 const g=generation,state=stepContexts.get(step);if(!pr||!session||!state)return Promise.reject(new Error('Reopen the review to load comments.'));
 // Revisited changes can use a recent successful read, including an empty list.
 if(Date.now()-(state.commentsLoadedAt||0)<30000)return Promise.resolve();
 const work=api('/api/reviews/'+session+'/comments/list',{...post({url:pr.url,head:pr.head,step}),signal:abort.signal}).then(data=>{if(g!==generation)return;const threads=mergeCommentThreads(data.threads,state.confirmedThreads||[]);state.commentsLoadedAt=Date.now();if(JSON.stringify(threads)!==JSON.stringify(state.threads||[])){state.threads=threads;updateComments(state,step)}}).finally(()=>{if(commentReads.get(step)===work)commentReads.delete(step)});commentReads.set(step,work);return work;
}
async function openLineComment(selection){
 selection={...selection,direction:'callees'};
 if(!pr||!session)return;const state=commentState(),step=count,g=generation,key=commentDraftKey(selection);let draft=state.commentDrafts[key];
 if(draft){graph.focusComment(key);return}
 draft={key,selection:{...selection},body:'',preparing:true,ready:false,error:'',requestId:crypto.randomUUID()};state.commentDrafts[key]=draft;graph.context(state);graph.focusComment(key);
 try{await api('/api/reviews/'+session+'/comments/context',{...post({url:pr.url,head:pr.head,step,selection}),signal:abort.signal});if(g!==generation||state.commentDrafts[key]!==draft)return;draft.ready=true}
 catch(error){if(g!==generation||error.name==='AbortError'||state.commentDrafts[key]!==draft)return;draft.error=error.message}
 finally{draft.preparing=false;if(g===generation&&state.commentDrafts[key]===draft)updateComments(state,step)}
}
function editLineComment(key,body){const draft=commentState()?.commentDrafts[key];if(draft&&!draft.busy){draft.body=body;draft.requestId=crypto.randomUUID()}}
function cancelLineComment(key){const state=commentState();if(state?.commentDrafts[key]&&!state.commentDrafts[key].busy){delete state.commentDrafts[key];graph.context(state)}}
function replyToComment(selection,replyTo){const state=commentState();if(!state)return;const key=commentDraftKey(selection,replyTo);state.commentDrafts[key]||={key,selection:{...selection},replyTo,body:'',ready:true,requestId:crypto.randomUUID()};graph.context(state);graph.focusComment(key)}
async function postLineComment(key){
 const state=commentState(),draft=state?.commentDrafts[key];if(!draft||!draft.ready||draft.busy||!draft.body.trim())return;
 const g=generation,step=count;draft.busy=true;draft.error='';graph.context(state);
 try{
  const data=await api('/api/reviews/'+session+'/comments',{...post({url:pr.url,head:pr.head,step,selection:draft.selection,body:draft.body,requestId:draft.requestId,...draft.replyTo?{replyTo:draft.replyTo}:{}}),signal:abort.signal});if(g!==generation)return;
  // Keep the confirmed comment inline even if GitHub's list endpoint lags.
  const fallback={id:draft.replyTo||data.comment.id,path:draft.selection.path,line:draft.selection.line,snapshot:draft.selection.snapshot,comments:[data.comment]},threads=mergeCommentThreads(data.threads||[],[fallback]);
  state.confirmedThreads=mergeCommentThreads(state.confirmedThreads||[],threads);state.threads=mergeCommentThreads(state.threads||[],threads);delete state.commentDrafts[key];toast(draft.replyTo?'Reply posted to GitHub.':'Comment posted to GitHub.');
 }catch(error){if(g!==generation||error.name==='AbortError')return;draft.error=error.message}
 finally{draft.busy=false;if(g===generation)updateComments(state,step)}
}
async function expandExcerpt({selection,range,direction}){
 if(!pr||!session)return;const g=generation,step=count,state=stepContexts.get(step),id=selection.anchorId;
 state.excerptLoading||={};if(state.excerptLoading[id])return;state.excerptLoading[id]=true;state.excerptErrors||={};delete state.excerptErrors[id];graph.context(state);
 try{
  const data=await api('/api/reviews/'+session+'/canvas/excerpt',{...post({url:pr.url,head:pr.head,step,selection,range,direction}),signal:abort.signal});if(g!==generation)return;
  state.excerpts||={};const prior=state.excerpts[id],a=prior?.affordances,b=data.affordances;
  state.excerpts[id]={...data,rows:[...new Map([...(prior?.rows||[]),...data.rows].map(row=>[(selection.snapshot==='before'?row.old:row.line),row])).values()].sort((a,b)=>(selection.snapshot==='before'?a.old-b.old:a.line-b.line)),affordances:{...b,variables:mergeVariableBindings(a?.variables,b.variables),calls:[...new Set([...(a?.calls||[]),...b.calls])],tokens:[...new Map([...(a?.tokens||[]),...b.tokens].map(token=>[token.line+':'+token.column,token])).values()]}};
 }catch(error){if(g!==generation||error.name==='AbortError')return;state.excerptErrors[id]=error.message}
 finally{state.excerptLoading[id]=false;if(g===generation&&step===count){graph.context(state);graph.reveal(id,direction)}}
}
function openCanvasChat(selection){if(pr&&session)chats.open({...selection,step:count,url:pr.url,head:pr.head,reviewId:session})}
async function streamCanvasChat({context,question,history,signal,onEvent}){const response=await fetch('/api/ask',{...post({surface:'canvas',url:context.url,head:context.head,reviewId:context.reviewId,step:context.step,anchor:{path:context.path,line:context.line,snapshot:context.snapshot},question,history}),signal});await readChatStream(response,onEvent)}
function confirmExpansion(selection,{confirmed=false}={}){
 if(confirmed){startExpansion({selection,step:count,generation});return}
 if(!pr||!session)return;if(preparedCanvasPage(preparedContexts.get(count),selection)?.total===0){showEmptyConnections(selection.direction);return}pendingSelection={selection,step:count,generation};$('connectionTitle').textContent=`Show ${selection.direction}?`;$('connectionTarget').textContent=`${selection.symbol} · ${selection.path}:${selection.line}`;$('confirmConnection').textContent=`Show ${selection.direction}`;openDialog('connectionDialog');
}
$('cancelConnection').onclick=()=>{$('connectionDialog').close();pendingSelection=null};
$('confirmConnection').onclick=()=>{const request=pendingSelection;pendingSelection=null;$('connectionDialog').close();startExpansion(request)};
function startExpansion(request){if(!pr||!session)return;if(!request||request.generation!==generation||request.step!==count)return;const selection=request.selection,id=canvasConnectionKey(selection),state=stepContexts.get(count),prior=state.requests.find(request=>request.id===id);if(prior?.status==='loading'||prior?.status==='done')return;const item=prior||{id,selection,status:'loading'};if(!prior)state.requests.push(item);loadContext(state,item,count)}
function mergeRelations(prior,incoming){const nodes=new Map(prior.map(node=>[node.id,node]));for(const node of incoming){const old=nodes.get(node.id);if(old){const edges=[...new Map([...old.edges,...node.edges].map(edge=>[JSON.stringify([edge.blockId,edge.anchorLine,edge.callLine,edge.targetLine]),edge])).values()];nodes.set(node.id,{...old,...node,text:old.clipped?node.text:old.text,end:old.clipped?node.end:old.end,clipped:old.clipped&&node.clipped,edges})}else nodes.set(node.id,node)}return [...nodes.values()]}
function showEmptyConnections(direction){$('emptyConnectionTitle').textContent=`No ${direction} found.`;openDialog('emptyConnectionDialog')}
$('closeEmptyConnection').onclick=()=>$('emptyConnectionDialog').close();
async function loadContext(state,request,step,page=0){
 if(request.status==='loading'&&request.started)return;const g=generation,id=session,url=pr.url,head=pr.head;request.started=true;request.error='';
 const cached=preparedCanvasPage(preparedContexts.get(step),request.selection,page);
 if(!cached){request.status='loading';if(step===count)graph.context(state)}
 try{
  const data=cached||await api('/api/reviews/'+id+'/canvas',{...post({url,head,step,page,selection:request.selection}),signal:abort.signal});if(g!==generation)return;
  state.relations=mergeRelations(state.relations,data.relations.map(node=>({...node,loadSelection:request.selection})));request.status=data.total?'done':'empty';request.total=data.total;request.nextPage=data.nextPage;
  if(!data.total&&step===count)showEmptyConnections(request.selection.direction);
 }catch(error){if(g!==generation||error.name==='AbortError')return;request.status='error';request.error=error.message}
 finally{request.started=false;if(g===generation&&step===count){contextData=state;graph.context(state)}}
}
$('canvasWorld').addEventListener('click',async event=>{
 const expand=event.target.closest('[data-expand-node]');if(expand){const g=generation,c=count,state=contextData,node=state.relations.find(node=>node.id===expand.dataset.expandNode);if(!node)return;expand.disabled=true;try{const result=await api('/api/reviews/'+session+'/canvas',{...post({url:pr.url,head:pr.head,step:c,selection:node.loadSelection,expandNode:node.id}),signal:abort.signal});if(g!==generation)return;state.relations=state.relations.map(prior=>prior.id===result.node.id?{...result.node,loadSelection:node.loadSelection}:prior);if(c===count)graph.context(state)}catch(error){if(error.name!=='AbortError')toast(error.message);expand.disabled=false}return}
 const button=event.target.closest('[data-retry-request],[data-more-request]');if(button){const request=contextData.requests.find(request=>request.id===(button.dataset.retryRequest||button.dataset.moreRequest));if(request)loadContext(contextData,request,count,button.dataset.moreRequest?request.nextPage:0)}
});
$('openForm').onsubmit=event=>{event.preventDefault();openPR($('url').value.trim())};$('previous').onclick=()=>advance(-1);$('next').onclick=()=>advance(1);$('fitCanvas').onclick=graph.fit;$('zoomIn').onclick=graph.zoomIn;$('zoomOut').onclick=graph.zoomOut;
for(const [id,name]of Object.entries({savePR:'bookmark',fitCanvas:'fit',wrapCode:'wrap',zoomIn:'zoomIn',zoomOut:'zoomOut',accountButton:'user'}))$(id).innerHTML=icon(name);
let wrapCode=false;try{wrapCode=localStorage.getItem('codesurf-canvas-wrap')==='true'}catch{}
function applyWrap(){graph.wrap(wrapCode);$('wrapCode').setAttribute('aria-pressed',String(wrapCode));$('wrapCode').title=wrapCode?'Turn off line wrapping':'Wrap code lines'}
$('wrapCode').onclick=()=>{wrapCode=!wrapCode;try{localStorage.setItem('codesurf-canvas-wrap',String(wrapCode))}catch{}applyWrap()};applyWrap();
document.querySelectorAll('.dialog-close').forEach(button=>{button.innerHTML=icon('close');button.onclick=()=>button.closest('dialog').close()});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
$('accountButton').onclick=()=>{$('accountMenu').hidden=!$('accountMenu').hidden;$('accountButton').setAttribute('aria-expanded',String(!$('accountMenu').hidden))};
document.addEventListener('click',event=>{if(!event.target.closest('.account')){$('accountMenu').hidden=true;$('accountButton').setAttribute('aria-expanded','false')}});document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('accountMenu').hidden=true;$('accountButton').setAttribute('aria-expanded','false')}});
function openDialog(id){$('accountMenu').hidden=true;$('accountButton').setAttribute('aria-expanded','false');if(!$(id).open)$(id).showModal()}
let repositoryChoices=[],repositoryPulls=[],selectedRepository=null,repositoryPage=null,pickerGeneration=0;
function pickerMessage(message,loading=false){$('repositoryChoices').innerHTML=`<div class="picker-message">${loading?'<span class="spinner" aria-hidden="true"></span>':''}<span>${esc(message)}</span></div>`}
function renderRepositories(){
 const query=$('repositoryFilter').value.toLowerCase();
 if(selectedRepository){const items=repositoryPulls.filter(item=>[item.title,item.number,item.author].join(' ').toLowerCase().includes(query));$('repositoryChoices').innerHTML=items.length?items.map(item=>`<article class="library-pr"><a data-picker-pr="${esc(item.url)}" href="${esc(route(item.url))}"><b>${esc(item.title)}</b><small>#${item.number} · ${esc(item.author||'')}${item.draft?' · Draft':''}</small></a></article>`).join(''):`<div class="picker-message">${query?'No matching pull requests.':'No open pull requests in this repository.'}</div>`;return}
 const items=repositoryChoices.filter(repo=>repo.name.toLowerCase().includes(query));$('repositoryChoices').innerHTML=items.length?items.map(repo=>`<button class="repository-choice" data-repository="${esc(repo.name)}"><span>${esc(repo.name)}</span>${repo.private?'<small>Private</small>':''}${icon('right')}</button>`).join(''):`<div class="picker-message">${query?'No matching repositories.':'No repositories connected yet. Connect a repository to get started.'}</div>`;
}
async function openRepositoryPicker(){
 const n=++pickerGeneration;selectedRepository=null;repositoryChoices=[];repositoryPulls=[];repositoryPage=null;openDialog('repositoryDialog');$('repositoryPickerTitle').textContent='Select repository';$('repositoryBack').hidden=true;$('repositoryMore').hidden=true;$('repositoryFilter').hidden=false;$('repositoryFilter').value='';$('repositoryFilter').placeholder='Search connected repositories…';$('repositoryFilter').setAttribute('aria-label','Search connected repositories');$('pickerConnect').href=status.installUrl||'https://github.com/apps/codesurf-io/installations/new';$('pickerConnect').hidden=false;$('pickerRefresh').hidden=false;pickerMessage('Loading connected repositories…',true);
 try{const data=await api('/api/repositories');if(n!==pickerGeneration)return;repositoryChoices=[...new Map(data.items.flatMap(item=>item.repositories).map(repo=>[repo.name.toLowerCase(),repo])).values()].sort((a,b)=>a.name.localeCompare(b.name));renderRepositories();$('repositoryFilter').focus()}
 catch(error){if(n!==pickerGeneration)return;pickerMessage(error.status===401?'Sign in with GitHub to choose your connected repositories.':error.message);if(error.status===401){$('repositoryFilter').hidden=true;$('pickerConnect').hidden=true;$('pickerRefresh').hidden=true;$('repositoryChoices').querySelector('.picker-message').insertAdjacentHTML('beforeend','<a class="github-sign" href="/auth/github"><img src="/github-mark.svg" width="18" height="18" alt="">Continue with GitHub</a>')}else $('repositoryChoices').querySelector('.picker-message').insertAdjacentHTML('beforeend','<button data-picker-retry>Try again</button>')}
}
async function openRepositoryPulls(repo,page=1){
 const n=++pickerGeneration;selectedRepository=repo;if(page===1){repositoryPulls=[];$('repositoryFilter').value='';pickerMessage('Loading pull requests…',true)}$('repositoryPickerTitle').textContent=repo;$('repositoryBack').hidden=false;$('repositoryFilter').placeholder='Search pull requests…';$('repositoryFilter').setAttribute('aria-label','Search pull requests');$('repositoryMore').hidden=true;
 try{const data=await api('/api/prs?'+new URLSearchParams({repo,page}));if(n!==pickerGeneration)return;repositoryPulls=[...new Map([...repositoryPulls,...data.items].map(item=>[item.url,item])).values()];repositoryPage=data.nextPage;renderRepositories();$('repositoryMore').hidden=repositoryPage==null}
 catch(error){if(n!==pickerGeneration)return;pickerMessage(error.message);$('repositoryChoices').querySelector('.picker-message').insertAdjacentHTML('beforeend','<button data-picker-retry>Try again</button>');repositoryPage=page}
}
$('canvasState').addEventListener('click',event=>{if(event.target.closest('#selectRepository'))openRepositoryPicker()});
$('repositoryFilter').oninput=renderRepositories;$('repositoryBack').onclick=openRepositoryPicker;$('pickerRefresh').onclick=()=>selectedRepository?openRepositoryPulls(selectedRepository):openRepositoryPicker();$('repositoryMore').onclick=()=>{if(repositoryPage!=null)openRepositoryPulls(selectedRepository,repositoryPage)};
$('repositoryChoices').onclick=event=>{const repo=event.target.closest('[data-repository]'),link=event.target.closest('[data-picker-pr]');if(repo)openRepositoryPulls(repo.dataset.repository);if(event.target.closest('[data-picker-retry]'))selectedRepository?openRepositoryPulls(selectedRepository,repositoryPage||1):openRepositoryPicker();if(link&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();$('repositoryDialog').close();openPR(link.dataset.pickerPr)}};
async function openSettings(){openDialog('settingsDialog');$('connectRepositories').href=status.installUrl||'https://github.com/apps/codesurf-io/installations/new';$('repositoryList').textContent='Loading connections…';try{const data=await api('/api/repositories');$('repositoryList').innerHTML=data.items.length?data.items.map(item=>`<section class="repository-item"><b>${esc(item.account)}</b> · <a href="${esc(item.manageUrl)}" target="_blank" rel="noopener">Choose repositories / disconnect</a><ul>${item.repositories.map(repo=>`<li>${esc(repo.name)}</li>`).join('')}</ul></section>`).join(''):'<p class="muted">No repositories connected yet. Use Connect repositories above.</p>'}catch(error){$('repositoryList').textContent=error.message}}
$('settingsButton').onclick=openSettings;$('refreshRepositories').onclick=openSettings;
$('savePR').onclick=async()=>{if(!pr||!user||saveBusy)return;saveBusy=true;++saveRevision;const current=pr,exists=saved.some(item=>item.url.toLowerCase()===pr.url.toLowerCase());$('savePR').disabled=true;try{const result=await api('/api/saved-prs',post({url:current.url,saved:!exists}));++saveRevision;saved=saved.filter(item=>item.url.toLowerCase()!==current.url.toLowerCase());if(result.item)saved.push(result.item);savedState();toast(exists?'Removed from saved pull requests.':'Pull request saved.')}catch(error){toast(error.message)}finally{saveBusy=false;controls()}};
function renderLibrary(){const query=$('libraryFilter').value.toLowerCase(),items=libraryKind==='saved'?sortSavedPulls(library,query):library.filter(item=>[item.repo,item.title,item.number].join(' ').toLowerCase().includes(query)).sort((a,b)=>a.repo.localeCompare(b.repo)||String(b.updated).localeCompare(String(a.updated)));$('libraryList').innerHTML=items.length?items.map(item=>`<article class="library-pr status-${esc(item.status||'open')}"><a data-pr="${esc(item.url)}" href="${esc(route(item.url))}"><b>${esc(item.title)}</b><small>${esc(item.repo)} · #${item.number}</small></a>${libraryKind==='saved'?`<span class="status">${esc(item.statusUnavailable?'Last known: ':'')}${esc(item.status==='merged'?'Merged':item.status==='closed'?'Closed':item.draft?'Draft':'Open')}</span><button class="icon-button" data-remove-save="${esc(item.url)}" aria-label="Remove saved pull request">${icon('close')}</button>`:''}</article>`).join(''):'<p class="muted">'+(query?'No matching pull requests.':libraryKind==='saved'?'Use the bookmark in the header to save a pull request.':'No recent pull requests assigned to you.')+'</p>'}
async function openLibrary(kind,includeOlder=false){
 libraryKind=kind;older=includeOlder;$('libraryFilter').value='';const n=++libraryGeneration;openDialog('libraryDialog');$('libraryTitle').textContent=kind==='saved'?'Saved pull requests':'My pull requests';$('libraryStatus').textContent=kind==='saved'?'Refreshing status…':older?'All dates':'Assigned to you · Last two weeks';$('libraryList').textContent='Loading pull requests…';$('showOlder').hidden=kind==='saved'||older;
 try{if(kind==='saved'){const data=await api('/api/saved-prs');if(n!==libraryGeneration)return;saved=data.items;library=[...saved];renderLibrary();for(let i=0;i<library.length;i+=20){const data=await api('/api/saved-prs/refresh',post({urls:library.slice(i,i+20).map(item=>item.url)}));if(n!==libraryGeneration)return;const updates=new Map(data.items.map(item=>[item.url,item]));library=library.map(item=>updates.get(item.url)||item);saved=[...library];renderLibrary()}$('libraryStatus').textContent='Unmerged first · Merged below';savedState()}else{const since=new Date(Date.now()-14*864e5).toISOString(),recent=await api('/api/prs?'+new URLSearchParams({relation:'assigned',since}));if(n!==libraryGeneration)return;library=recent.items;if(older){const data=await api('/api/prs?'+new URLSearchParams({relation:'assigned',since,older:'1'}));if(n!==libraryGeneration)return;library=[...library,...data.items]}renderLibrary()}}catch(error){if(n===libraryGeneration)$('libraryList').textContent=error.message}
}
$('myPulls').onclick=()=>openLibrary('my');$('savedPulls').onclick=()=>openLibrary('saved');$('showOlder').onclick=()=>openLibrary('my',true);$('libraryFilter').oninput=renderLibrary;
$('libraryList').onclick=async event=>{const remove=event.target.closest('[data-remove-save]');if(remove){remove.disabled=true;try{await api('/api/saved-prs',post({url:remove.dataset.removeSave,saved:false}));library=library.filter(item=>item.url!==remove.dataset.removeSave);saved=saved.filter(item=>item.url!==remove.dataset.removeSave);renderLibrary();savedState()}catch(error){toast(error.message);remove.disabled=false}return}const link=event.target.closest('[data-pr]');if(link&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();$('libraryDialog').close();openPR(link.dataset.pr)}};
$('completeReview').onclick=()=>{if(!pr)return;$('reviewTarget').textContent=pr.repo+' #'+pr.number;$('reviewError').textContent='';$('postedReview').hidden=true;$('publishReview').disabled=false;openDialog('reviewDialog')};
$('publishReview').onclick=async()=>{if(!pr)return;const current=pr,button=$('publishReview');if(button.disabled)return;button.disabled=true;try{const result=await api('/api/review',post({url:current.url,head:current.head,body:$('reviewBody').value,event:$('reviewEvent').value,comments:[]}));if(pr!==current)return;$('postedReview').href=result.url;$('postedReview').hidden=false;toast('Review published on GitHub.')}catch(error){$('reviewError').textContent=error.message;button.disabled=false}};
$('signOut').onclick=async()=>{await api('/auth/logout',post({}));location.href='/'};
window.addEventListener('popstate',()=>{const url=directPR(),position=reviewLocation(location.href);if(url&&url===pr?.url&&plan&&!moving&&!loading.busy()&&position.head===pr.head&&position.base===plan.base&&position.change<=plan.steps.length){navigateChange(position.change,{historyMode:'none'});return}if(url)openPR(url,false,position);else location.reload()});
async function init(){const initial=directPR();reviewMode(!!initial);if(initial){showState('Breaking this change into logical chunks…','Checking GitHub access and preparing the review.',true);$('url').value=initial;rememberReview(initial,reviewLocation(location.href))}try{status=await api('/api/status');user=await api('/api/me');$('identity').textContent='@'+user.login;$('signInLink').hidden=true;$('signOut').hidden=false;const revision=saveRevision;api('/api/saved-prs').then(data=>{if(revision!==saveRevision)return;saved=data.items;savedState()}).catch(()=>{});let url=directPR(),position=url?reviewLocation(location.href):{change:1};try{url||=sessionStorage.getItem('codesurf-pending-pr');const saved=JSON.parse(sessionStorage.getItem('codesurf-pending-review-position')||'null');if(!directPR()&&saved?.url===url)position=reviewLocation(new URL('/?'+new URLSearchParams(saved),location.origin).href);sessionStorage.removeItem('codesurf-pending-pr');sessionStorage.removeItem('codesurf-pending-review-position')}catch{}if(url&&generation===0)openPR(url,false,position)}catch(error){if(initial){showState('Sign in to review this pull request.','Connect your GitHub account to continue.');offerSignIn()}if(error.status!==401)toast(error.message)}}
init();
