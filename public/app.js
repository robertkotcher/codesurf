import {startVoiceChat} from './voice-chat.js';
import {syncFilePanes,movePaneFile,bindPaneDragging} from './file-panes.js';
import {attachSidebarResize} from './sidebar-resize.js';
import {reviewBlocks} from './review-notes.js';
import {groupPullRequests} from './pull-list.js';
import {buildCallIndex,indexedCalls,overlayCallIndex,initCallParsers} from './source-index.js';
import {selectedFunction,functionParameters,functionData} from './data-shapes.js';
import {openDataCanvas} from './data-canvas.js';
import {openCallCanvas} from './call-canvas.js';
import {stateAt,validatePlan,manifestAt,stepFiles,notesAt} from './transformations.js';
import {mountEditor,icon,fileIcon,setEditorWrapping,setEditorTheme,commentLines} from './vendor/review-editor.js';
import {layoutFlow} from './flow-layout.js';
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demo=new URLSearchParams(location.search).has('demo')&&['localhost','127.0.0.1'].includes(location.hostname);
let pr=null,user=null,status={},columns=[],activeColumn=0,selection=null,anchor=null,dragging=false,turns=[],busy=false,focused=new Map(),streamAbort=null,prGeneration=0;
let chats=[], activeChat=null;
function newChat(context=null,open=true){
  const chat={id:crypto.randomUUID(),title:context?.path?context.path.split('/').pop()+':'+context.start+'–'+context.end:'New chat',turns:[],context,draft:'',abort:null};
  chats.push(chat);if(open)setConversationCollapsed(false);activateChat(chat.id);return chat;
}
function activateChat(id){
  if(activeChat)activeChat.draft=$('followQuestion').value;
  activeChat=chats.find(c=>c.id===id);turns=activeChat?.turns||[];
  $('followQuestion').value=activeChat?.draft||'';
  renderChatTabs();renderTurns();
}
function renderChatTabs(){
  $('chatTabs').hidden=!chats.length;
  $('chatTabs').innerHTML=chats.map(c=>`<div class="chat-tab ${c===activeChat?'is-active':''}"><button id="chat-tab-${c.id}" role="tab" aria-selected="${c===activeChat}" aria-controls="messages" tabindex="${c===activeChat?0:-1}" data-chat="${c.id}" title="${esc(c.title)}">${esc(c.title)}${c.abort?' · ●':''}</button><button type="button" data-delete-chat="${c.id}" aria-label="Delete chat ${esc(c.title)}" title="Delete chat">×</button></div>`).join('');
  if(activeChat)$('messages').setAttribute('aria-labelledby','chat-tab-'+activeChat.id);else $('messages').removeAttribute('aria-labelledby');
}
function deleteChat(id){if(voiceChat?.id===id)stopVoice();
  const index=chats.findIndex(c=>c.id===id);if(index<0)return;
  const chat=chats[index];chat.abort?.abort();chats.splice(index,1);
  if(chat===activeChat){activeChat=null;turns=[];$('followQuestion').value='';if(chats.length)activateChat(chats[Math.min(index,chats.length-1)].id);else {renderChatTabs();renderTurns()}}
  else renderChatTabs();
  if(activeChat)$('chat-tab-'+activeChat.id)?.focus();else $('messages').querySelector('[data-new-chat]')?.focus();
}
$('chatTabs').onclick=e=>{const close=e.target.closest('[data-delete-chat]'),tab=e.target.closest('[data-chat]');if(close)deleteChat(close.dataset.deleteChat);else if(tab){activateChat(tab.dataset.chat);$('chat-tab-'+activeChat.id)?.focus()}};
$('chatTabs').onkeydown=event=>{
  const tab=event.target.closest('[data-chat]');if(!tab)return;
  const index=chats.findIndex(c=>c.id===tab.dataset.chat);let next=index;
  if(event.key==='ArrowRight')next=(index+1)%chats.length;
  else if(event.key==='ArrowLeft')next=(index-1+chats.length)%chats.length;
  else if(event.key==='Home')next=0;else if(event.key==='End')next=chats.length-1;
  else if(event.key==='Delete'){event.preventDefault();deleteChat(tab.dataset.chat);return}else return;
  event.preventDefault();activateChat(chats[next].id);$('chat-tab-'+activeChat.id)?.focus();
};
let inputSelectionVersion=0;
async function selectionSources(context){
 if(demo){const plan=await api('/api/demo-plan?pace='+reviewPace);return new Map(plan.files.map(f=>[f.path,context.intermediate!==false&&reviewPlan?stateAt(reviewPlan,reviewCount)[f.path]??f.after:f.after]));}
 const text=context.intermediate!==false&&reviewPlan?stateAt(reviewPlan,reviewCount)[context.path]:(await getFile(context.path)).text;
 return new Map([[context.path,text??(await getFile(context.path,context.intermediate!==false&&reviewPlan?'base':'head')).text]]);
}
async function updateSampleAction(context){
 const version=++inputSelectionVersion,button=$('sampleInputButton');button.hidden=true;
 try{const files=await selectionSources(context),block=selectedFunction(files,context.path,context.start,context.end||context.start);if(version===inputSelectionVersion)button.hidden=!(block&&functionParameters(block).length);}catch{}
}
$('sampleInputButton').onclick=async()=>{
 const context=reviewSelection||selection;if(!context||!pr)return;closePopover();
 let files;if(demo){const plan=await api('/api/demo-plan?pace='+reviewPace);files=new Map(plan.files.map(f=>[f.path,f.after]));}
 let line=context.start;
 try{const source=files?.get(context.path)??(await getFile(context.path)).text;const snippet=context.text?.trim();if(snippet){const offset=source.indexOf(snippet);if(offset>=0&&source.indexOf(snippet,offset+1)<0)line=source.slice(0,offset).split('\n').length;}}
 catch(error){toast(error.message);return}
 openDataCanvas({host:document.querySelector('.code-stage'),path:context.path,line,
 load:async(path,line)=>files?functionData(files,{path,line}):api('/api/function-data?'+new URLSearchParams({url:pr.url,head:pr.head,path,line})),
 onSelect:value=>selectReviewLines(value,value.path,false)});
};
const callIndexes=new Map();
function preloadCallIndex(snapshot='head',scope={}){
 if(!pr)return null;const current=pr,key=current.repo+':'+current.head+':'+snapshot+':'+JSON.stringify(scope);
 if(callIndexes.has(key))return callIndexes.get(key);
 const promise=(demo?api('/api/demo-plan').then(async plan=>{await initCallParsers();return buildCallIndex(new Map(plan.files.map(f=>[snapshot==='base'?f.previousPath||f.path:f.path,snapshot==='base'?f.before:f.after])))}):api('/api/call-index?'+new URLSearchParams({url:current.url,head:current.head,snapshot,...scope}))).catch(error=>{callIndexes.delete(key);throw error});
 callIndexes.set(key,promise);if(callIndexes.size>8)callIndexes.delete(callIndexes.keys().next().value);promise.catch(()=>{});return promise;
}

async function launchCallCanvas(){
 const context=reviewSelection||selection||{path:reviewPath,start:1,intermediate:true};if(!pr||!context.path)return;
 closePopover();const current=pr,plan=reviewPlan,count=reviewCount,intermediate=context.intermediate!==false&&!!plan;
 const snapshot=intermediate?'base':'head',label=intermediate?'Review step '+count:'PR head',overrides=new Map();
 if(intermediate){const state=stateAt(plan,count),manifest=manifestAt(plan,count);for(const file of plan.files){if(file.unavailable)continue;overrides.set(file.path,null);if(file.previousPath)overrides.set(file.previousPath,null);const entry=manifest.find(m=>m.key===file.path);if(entry?.exists)overrides.set(entry.path,state[file.path]);}}
 try{
 await initCallParsers();const files=await selectionSources(context),local=buildCallIndex(files),root=indexedCalls(local,{path:context.path,line:context.start}).blocks[0];
 root.snapshot=label;
 openCallCanvas({host:document.querySelector('.code-stage'),path:context.path,line:context.start,root,
 load:async(path,line,direction,symbol,node)=>{
 const base=await preloadCallIndex(snapshot,{path,line,direction,symbol:symbol||''});const graph=intermediate?overlayCallIndex(base,overrides):base;if(pr!==current)throw new Error('The pull request changed.');
 const result=indexedCalls(graph,{path,line,direction,symbol});
 const blocks=await Promise.all(result.blocks.map(async block=>{if(block.text)return {...block,snapshot:label};const text=overrides.get(block.path)??(await getFile(block.path,snapshot)).text;return {...block,text:text.split('\n').slice(block.start-1,block.end).join('\n'),snapshot:label};}));
 return {...result,blocks};
 },onSelect:value=>selectReviewLines(value,value.path,value.snapshot?.startsWith('Review step'))});
 }catch(error){toast(error.message)}
}

function askInline(question){
  const context=reviewSelection?{...reviewSelection,path:reviewSelection.path||reviewPath,intermediate:reviewSelection.intermediate!==false,step:reviewCount}:selection?{...selection}:null;
  if(!pr)return toast('Open a pull request first.');
  newChat(context);ask(question);
}
function selectReviewLines(value,path=reviewPath,intermediate=true){
  stopVoice();
  reviewSelection={...value,path,intermediate};selection=null;updateSampleAction(reviewSelection);
  $('popcontext').textContent=path+':'+value.start+'–'+value.end;
  const pop=$('askPopover');pop.classList.remove('hidden');
  pop.style.left=Math.max(12,Math.min(value.x||innerWidth/2,innerWidth-420))+'px';
  pop.style.top=Math.max(70,Math.min((value.y||200)+8,innerHeight-245))+'px';$('inlineQuestion').focus();
}
const cache=new Map();
let activeFlow=null;
let reviewComments=[],reviewSummary='',reviewPr=null;
document.querySelector('.account-chevron').innerHTML=icon('down');
function closeAccountMenu(){ $('accountMenu').hidden=true;$('accountButton').setAttribute('aria-expanded','false'); }
$('accountButton').onclick=()=>{const open=$('accountMenu').hidden;$('accountMenu').hidden=!open;$('accountButton').setAttribute('aria-expanded',String(open))};
document.addEventListener('click',event=>{if(!event.target.closest('.account-dropdown'))closeAccountMenu()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeAccountMenu();if(event.target.closest('.account-dropdown'))$('accountButton').focus()}});
$('accountMenu').addEventListener('click',event=>{if(event.target.closest('button,a'))closeAccountMenu()});
async function loadRepositories(){
  const container=$('repositoryConnections');container.textContent='Loading repositories…';
  $('addRepositories').href=status?.installUrl||'https://github.com/settings/installations';
  $('refreshRepositories').disabled=true;
  try{
    if(demo){container.textContent='Repository connections are unavailable in the demo. Sign in with GitHub to manage access.';return}
    const data=await api('/api/repositories');
    container.innerHTML=data.items.length?data.items.map(item=>`<section class="repository-connection"><div><b>${esc(item.account)}</b><a href="${esc(item.manageUrl)}" target="_blank" rel="noopener">Choose repositories / disconnect ↗</a></div>${item.repositories.length?'<ul>'+item.repositories.map(repo=>`<li>${esc(repo.name)}<small>${repo.private?'Private':'Public'}</small></li>`).join('')+'</ul>':'<p>No repositories connected.</p>'}</section>`).join(''):'<p>No repositories connected. Connect a repository to get started.</p>';
  }catch(error){container.textContent=error.message}finally{$('refreshRepositories').disabled=false}
}
function closeSettings(){$('settings').classList.add('hidden');$('accountButton').focus()}
$('settingsButton').onclick=()=>{$('settings').classList.remove('hidden');$('closeSettings').focus();loadRepositories()};
$('closeSettings').onclick=closeSettings;
$('settings').onclick=event=>{if(event.target===$('settings'))closeSettings()};
$('settings').onkeydown=event=>{
  if(event.key==='Escape')closeSettings();
  if(event.key==='Tab'){const controls=[...$('settings').querySelectorAll('button:not(:disabled),a[href]')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
};
$('refreshRepositories').onclick=async()=>{await loadRepositories();if(!demo&&!$('prHome').hidden)await showHome()};
function showAccount(account){
  document.body.dataset.account=account.login;$('identity').textContent='@'+account.login;$('accountSignIn').hidden=true;
  for(const id of ['inboxButton','logout'])$(id).hidden=false;
  const avatar=$('accountAvatar');
  try{const url=new URL(account.avatar);if(url.protocol==='https:'&&url.hostname==='avatars.githubusercontent.com'){avatar.src=url.href;avatar.hidden=false;$('avatarFallback').hidden=true}}catch{}
  avatar.onerror=()=>{avatar.hidden=true;$('avatarFallback').hidden=false};
}
function toast(message){$('toast').textContent=message;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),5000)}
async function api(url,options={}){const r=await fetch(url,options);let b;try{b=await r.json()}catch{throw new Error(r.status>=500?'The server could not finish this request. Please try again.':'The server returned an unreadable response. Please try again.')}if(!r.ok){if(r.status===401)$('signin').classList.remove('hidden');throw new Error(b.error||'Request failed')}return b}
function patchRows(patch=''){let old=0,line=0;const rows=[];for(const t of patch.split('\n')){const m=t.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);if(m){old=+m[1];line=+m[2];rows.push({kind:'hunk',text:t});continue}if(!old&&!line)continue;if(t[0]==='+')rows.push({kind:'add',line:line++,text:t.slice(1)});else if(t[0]==='-')rows.push({kind:'del',old:old++,text:t.slice(1)});else if(t[0]===' ')rows.push({kind:'context',old:old++,line:line++,text:t.slice(1)})}return rows}
function syntax(text){return esc(text).replace(/(&#39;.*?&#39;|&quot;.*?&quot;|\b(?:import|from|export|async|await|function|const|let|if|return|interface|string|number|CREATE|TABLE|NOT|NULL|DEFAULT|PRIMARY|KEY|INDEX|ON)\b)/g,(t)=>`<span class="${t.startsWith('&')?'str':'kw'}">${t}</span>`)}
let treeNodes=new Map(),expandedFolders=new Set(['']),treeLoading=new Set(),treeErrors=new Map();
function tree(){
  if(!pr)return;
  const render=(parent,depth)=>{
    if(treeLoading.has(parent))return `<div class="tree-note" style="padding-left:${16+depth*14}px">Loading…</div>`;
    if(treeErrors.has(parent))return `<button class="tree-note" data-retry="${esc(parent)}" data-sha="${esc(treeErrors.get(parent).sha)}">Retry loading folder</button>`;
    return (treeNodes.get(parent)||[]).map(node=>{
      const path=parent?parent+'/'+node.name:node.name,folder=node.type==='tree',open=expandedFolders.has(path),changed=pr.files.find(f=>f.path===path);
      return `<button role="treeitem" ${folder?`aria-expanded="${open}" data-folder="${esc(path)}" data-sha="${esc(node.sha||'')}"`:`data-file="${esc(path)}" aria-selected="${reviewPlan?reviewPath===path:columns.some(c=>c.active===path)}"`} class="file-item ${folder?'folder-item':''} ${(reviewPlan?reviewPath===path:columns.some(c=>c.active===path))?'active':''}" style="padding-left:${12+depth*14}px" title="${esc(path)}"><span class="tree-chevron">${folder?icon(open?'down':'right'):''}</span><span class="file-icon">${folder?icon(open?'open':'folder'):fileIcon(path)}</span><span>${esc(node.name)}</span>${changed?`<span class="status">${changed.status==='added'?'A':changed.status==='removed'?'D':'M'}</span>`:''}</button>${folder&&open?`<div role="group">${render(path,depth+1)}</div>`:''}`;
    }).join('');
  };
  $('filetree').innerHTML=expandedFolders.has('')?render('',0):'';
  $('repoFolder').innerHTML=icon(expandedFolders.has('')?'down':'right')+'<span>'+esc(pr.repo.split('/').pop().toUpperCase())+'</span>';$('repoFolder').setAttribute('aria-expanded',String(expandedFolders.has('')));
  $('commit').textContent='⑂ '+pr.head.slice(0,7);
}
async function loadTreeFolder(path='',sha=''){
  const generation=prGeneration;treeLoading.add(path);treeErrors.delete(path);tree();
  try{
    let nodes;
    if(demo){const prefix=path?path+'/':'';const entries=new Map();for(const file of window.sampleRepository){if(!file.name.startsWith(prefix))continue;const rest=file.name.slice(prefix.length),name=rest.split('/')[0];entries.set(name,{name,type:rest.includes('/')?'tree':'blob'})}nodes=[...entries.values()]}
    else nodes=sha==='deleted'?[]:(await api('/api/tree?'+new URLSearchParams({url:pr.url,head:pr.head,tree:sha}))).entries;
    if(generation!==prGeneration)return;
    // Keep deleted PR files accessible alongside the current repository tree.
    const prefix=path?path+'/':'';for(const f of pr.files.filter(f=>f.status==='removed'&&f.path.startsWith(prefix))){const rest=f.path.slice(prefix.length),name=rest.split('/')[0];if(!nodes.some(n=>n.name===name))nodes.push({name,type:rest.includes('/')?'tree':'blob',sha:'deleted'})}
    nodes.sort((a,b)=>(b.type==='tree')-(a.type==='tree')||a.name.localeCompare(b.name));treeNodes.set(path,nodes);
  }catch(error){if(generation===prGeneration)treeErrors.set(path,{message:error.message,sha})}finally{if(generation===prGeneration){treeLoading.delete(path);tree()}}
}
$('repoFolder').onclick=()=>{expandedFolders.has('')?expandedFolders.delete(''):expandedFolders.add('');tree()};
async function getFile(path,side='head'){const key=pr.head+':'+side+':'+path;if(cache.has(key))return cache.get(key);if(demo){const f=window.sampleRepository.find(x=>x.name===path);if(!f)throw new Error('This file is outside the sample.');const text=Array.from({length:f.start-1},()=> '// … earlier code …').concat(f.lines.filter(l=>!l.startsWith('-')).map(l=>l.startsWith('+')?l.slice(1):l)).join('\n');const data={path,text};cache.set(key,data);return data}const data=await api('/api/file?'+new URLSearchParams({url:pr.url,path,side,head:pr.head}));cache.set(key,data);return data}
async function openFile(path,range=null,beside=false){if(!pr)return;if(reviewPlan){reviewExploring=false;reviewSelection=null;reviewPath=path;renderWalkthrough();tree();return}if(walkthroughReady)dockWalkthrough();if(activeFlow){activeFlow=null;$('flowHeader').classList.add('hidden');}const generation=prGeneration;if(beside){let idx=columns.findIndex(c=>c.active===path);if(idx<0){if(columns.length>=3)idx=2;else{idx=columns.length;columns.push({tabs:[],active:path,mode:'full'})}}activeColumn=idx}if(!columns.length)columns.push({tabs:[],active:path,mode:'diff'});const col=columns[activeColumn],targetColumn=activeColumn;col.error=null;if(!col.tabs.includes(path))col.tabs.push(path);col.active=path;if(range){col.mode='full';focused.set(path,range)}renderEditors();tree();const changed=pr.files.find(f=>f.path===path);try{await getFile(path,changed?.status==='removed'?'base':'head');if(prGeneration!==generation)return;renderEditors();if(range){const el=document.querySelector(`.editor-col[data-column="${targetColumn}"] .editor-line[data-line="${range.start}"]`);scrollCodeLine(el)}}catch(e){if(prGeneration!==generation)return;col.error=e.message;renderEditors()}}
function renderEditors(){
  if(!columns.length)return;
  const oldScroll=$('editors').scrollTop;
  $('editors').classList.toggle('flow-mode',!!activeFlow);
  $('editors').innerHTML=columns.map((c,ci)=>{
    const path=c.active,changed=pr.files.find(f=>f.path===path),file=cache.get(pr.head+':'+(changed?.status==='removed'?'base':'head')+':'+path),focus=focused.get(path),step=activeFlow?.steps[ci];
    let rows=[];
    if(step&&file)rows=file.text.split('\n').slice(step.start-1,step.end).map((text,i)=>({text,line:step.start+i,kind:'context'}));
    else if(c.mode==='diff'&&changed?.patch)rows=patchRows(changed.patch);
    else if(file)rows=file.text.split('\n').map((text,i)=>({text,line:i+1,kind:'context'}));
    const diffRows=patchRows(changed?.patch||'');
    const addedLines=new Set(diffRows.filter(r=>r.kind==='add').map(r=>r.line));
    const removedBefore=new Map();let removed=[];
    for(const row of diffRows){if(row.kind==='del')removed.push(row.text);else if(row.line&&removed.length){removedBefore.set(row.line,removed);removed=[]}}
    if(removed.length&&file)removedBefore.set(file.text.split('\n').length,removed);
    if(step||c.mode!=='diff')rows=rows.map(r=>({...r,kind:addedLines.has(r.line)||changed?.status==='added'?'add':r.kind,removed:removedBefore.get(r.line)}));
    const commentLines=new Set(diffRows.map(r=>r.line));
    const origin=turns.at(-1)?.origin;
    return `<section class="editor-col ${step?'flow-column':''}" data-column="${ci}" data-pane-index="${ci}">
      <div class="editor-tabs">${c.tabs.map(t=>`<button class="${t===path?'active':''}" data-tab="${esc(t)}" data-column="${ci}" ${!step?`draggable="true" data-pane-file="${esc(t)}"`:""} title="${esc(t)}">${esc(t.split('/').pop())}</button>`).join('')}${ci>0&&!step?`<button class="close-col" data-close-column="${ci}" aria-label="Close editor column">×</button>`:''}</div>
      ${step?`<div class="flow-caption"><div><span class="step-number">${ci+1}</span><b>${esc(step.label)}</b></div><small>${ci?(step.relation==='call'?`Called at ${esc(activeFlow.steps[ci-1].path)}:${step.callerLine}`:'Related source · not a direct call'):'Entry point'}<button data-full-source="${ci}">Full file ↗</button></small></div>`:`<div class="editor-toolbar"><span title="${esc(path)}">${esc(path.split('/').slice(0,-1).join('/')||'Repository root')}</span><button data-mode="${ci}" class="${c.mode==='diff'?'mode-selected':''}">${c.mode==='diff'?'Diff':'Full file'}</button><button data-split="${ci}" title="Open file beside">◫</button>${focus?`<button data-unfocus="${esc(path)}">Clear focus</button>`:''}</div>`}
      <div class="editor-lines ${step?'flow-lines':''}" ${step?`style="padding-top:${12+step.offset}px"`:''}>${c.error?`<div class="editor-loading error">${esc(c.error)}</div>`:!rows.length?`<div class="editor-loading">Loading source…</div>`:rows.map(r=>{
        if(r.kind==='hunk')return `<div class="hunk">${esc(r.text)}</div>`;
        const selected=selection?.path===path&&selection.column===ci&&r.line>=selection.start&&r.line<=selection.end;
        const relevant=step||(focus&&(focus.ranges||[focus]).some(range=>r.line>=range.start&&r.line<=range.end));
        const next=activeFlow?.steps[ci+1],callSite=next?.relation==='call'&&r.line===next.callerLine;
        const pin=origin?.path===path&&r.line===origin.start;
        return `<div class="editor-line ${r.kind} ${r.removed?'deletion-boundary':''} ${selected?'selected':''} ${relevant?'focused':''} ${callSite?'call-site':''} ${step&&r.line===(step.entryLine||step.start)?'callee-entry':''}" tabindex="0" role="button" aria-label="Select ${esc(path)} line ${r.line||'deleted '+r.old}" data-path="${esc(path)}" data-column="${ci}" data-line="${r.line||0}" data-old="${r.old||0}"><span class="line-number">${r.line||r.old}</span><span class="line-sign" title="${r.removed?esc(r.removed.length+' line(s) removed here:\n'+r.removed.join('\n')):r.kind==='add'?'Added in this pull request':r.kind==='del'?'Deleted in this pull request':''}">${r.kind==='add'?'+':r.kind==='del'?'−':r.removed?'▾':' '}</span><span class="code-text">${syntax(r.text)}</span>${pin?`<button class="thread-pin" data-thread title="${esc(turns.at(-1).q)}" aria-label="Open conversation at this line">✧</button>`:''}${changed&&(r.line?commentLines.has(r.line):r.kind==='del')?`<button class="line-comment" aria-label="Comment on ${r.line?'current':'deleted'} line ${r.line||r.old}" title="Add review comment" data-comment-path="${esc(path)}" data-comment-line="${r.line||r.old}" data-comment-side="${r.line?'RIGHT':'LEFT'}">＋</button>`:''}<button class="line-ask" aria-label="Ask AI about line ${r.line||r.old}" title="Ask AI">✧</button></div>`;
      }).join('')}</div>
      <div class="editor-footer">${step?`${esc(path)}:${step.start}–${step.end}`:focus?`Relevant: ${(focus.ranges||[focus]).map(r=>r.start+'–'+r.end).join(', ')}`:c.mode==='diff'?'Changes against base':'Full source'} · ${pr.head.slice(0,7)}</div>
    </section>`;
  }).join('')+(activeFlow?'<svg class="flow-links" id="flowLinks" aria-hidden="true"></svg>':'');
  $('editors').scrollTop=oldScroll;
  if(activeFlow)requestAnimationFrame(drawFlowLinks);
}
function selectLine(el,shift=false){reviewSelection=null;const line=Number(el.dataset.line);if(!line){toast('Deleted code is visible for comparison. Select current code to ask a question.');return false}const path=el.dataset.path,column=Number(el.dataset.column);activeColumn=column;if(!shift||anchor?.path!==path||anchor.column!==column)anchor={path,column,line};selection={path,column,start:Math.min(line,anchor.line),end:Math.max(line,anchor.line)};document.querySelectorAll('.editor-line').forEach(x=>x.classList.toggle('selected',x.dataset.path===path&&Number(x.dataset.column)===column&&Number(x.dataset.line)>=selection.start&&Number(x.dataset.line)<=selection.end));return true}
function openPopover(x,y){if(!selection)return;updateSampleAction({...selection,intermediate:false});$('popcontext').textContent=selection.path+' : '+selection.start+'–'+selection.end;const p=$('askPopover');p.classList.remove('hidden');p.style.left=Math.max(12,Math.min(x-50,innerWidth-420))+'px';p.style.top=Math.max(70,Math.min(y+10,innerHeight-230))+'px';$('inlineQuestion').focus()}
let voiceConversation=null,voiceChat=null,voiceReference=null;
function resetVoiceUI(){
 $('voiceListening').hidden=true;$('inlineQuestion').hidden=false;$('inlineAsk').disabled=false;$('commentSelection').disabled=false;
 $('voiceChatButton').innerHTML=icon('mic');$('voiceChatButton').setAttribute('aria-pressed','false');$('voiceChatButton').setAttribute('aria-label','Start voice conversation');$('voiceChatButton').title='Start voice conversation';
}
async function showVoiceCode(reference,origin,current){
 if(pr?.head!==current.head||pr?.url!==current.url)return;
 const generation=prGeneration;await getFile(reference.path);
 if(generation!==prGeneration)return;
 voiceReference=reference;
 if(reviewPlan){await renderWalkthrough();}
 else {
  if(!columns.length)columns=[{tabs:[origin.path],active:origin.path,mode:'full'}];
  let index=columns.findIndex(c=>c.active===reference.path);
  if(index<0){index=columns.length>1?1:columns.length;if(index===columns.length)columns.push({tabs:[],active:reference.path,mode:'full'});}
  const column=columns[index];if(!column.tabs.includes(reference.path))column.tabs.push(reference.path);column.active=reference.path;column.mode='full';focused.set(reference.path,reference);renderEditors();tree();
  const pane=document.querySelector(`.editor-col[data-column="${index}"]`);
  const lines=[...(pane?.querySelectorAll('.editor-line')||[])].filter(el=>+el.dataset.line>=reference.start&&+el.dataset.line<=reference.end);
  scrollCodeLine(lines[0]);for(const line of lines){line.classList.remove('voice-code-flash');void line.offsetWidth;line.classList.add('voice-code-flash')}
 }
}
function stopVoice(){voiceConversation?.stop();voiceConversation=null;if(voiceChat){for(const turn of voiceChat.turns)turn.streaming=false;if(activeChat===voiceChat)renderTurns()}voiceChat=null;resetVoiceUI()}
$('followCallsButton').innerHTML=icon('graph');$('followCallsButton').onclick=launchCallCanvas;
$('voiceChatButton').innerHTML=icon('mic');$('endVoice').onclick=stopVoice;
$('voiceChatButton').onclick=()=>{
 if(voiceConversation?.active){stopVoice();return}
 const selected=reviewSelection||selection;if(!selected||!pr)return toast('Select code first.');if(demo)return toast('Voice chat is available on connected pull requests.');
 const context={...selected,intermediate:selected.intermediate!==false&&!!reviewPlan},current=pr,step=reviewCount;
 $('inlineQuestion').hidden=true;$('voiceListening').hidden=false;$('voiceTranscript').textContent='';$('inlineAsk').disabled=true;$('commentSelection').disabled=true;
 $('voiceChatButton').innerHTML=icon('stop');$('voiceChatButton').setAttribute('aria-pressed','true');$('voiceChatButton').setAttribute('aria-label','End voice conversation');$('voiceChatButton').title='End voice conversation';
 const messages=new Map();let chat=null,lastTurn=null;
 voiceConversation=startVoiceChat({
  request:async(sdp,signal)=>{const response=await fetch('/api/voice',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({url:current.url,head:current.head,selection:context,reviewId:context.intermediate?reviewSession:null,step,sdp})});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Voice chat could not connect.')}return response.text()},
  onTool:async(name,args,signal)=>{
   const result=await api('/api/voice/tool',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({url:current.url,head:current.head,name,args})});
   if(result.reference)await showVoiceCode(result.reference,context,current);
   return result;
  },
  onState:state=>{if(state==='ended'){if(chat){for(const turn of chat.turns)turn.streaming=false;if(activeChat===chat)renderTurns()}resetVoiceUI();return}$('voiceStatus').textContent={connecting:'Connecting…',listening:'Listening…',thinking:'Thinking…',speaking:'Speaking…'}[state]||state;$('voiceListening').dataset.state=state},
  onLevel:level=>$('voiceListening').style.setProperty('--voice-level',String(level)),
  onReady:()=>{chat=newChat({...context,step});chat.title='Voice · '+context.path.split('/').pop();voiceChat=chat;renderChatTabs()},
  onTranscript:message=>{
   if(!chat||!message.text)return;$('voiceTranscript').textContent=message.text;
   let turn=messages.get(message.id);
   if(message.role==='user'){
    if(!turn){turn=lastTurn&&!lastTurn.voiceQuestion?lastTurn:{q:'',a:'',origin:context,head:current.head};if(!chat.turns.includes(turn))chat.turns.push(turn);messages.set(message.id,turn)}turn.q=message.text;turn.voiceQuestion=true;lastTurn=turn;
   }else {
    if(!turn){turn=lastTurn&&!lastTurn.voiceAnswer?lastTurn:{q:'Voice question',a:'',origin:context,head:current.head};if(!chat.turns.includes(turn))chat.turns.push(turn);messages.set(message.id,turn);turn.voiceAnswer=true;lastTurn=turn}turn.a=message.done?message.text:turn.a+message.text;turn.streaming=!message.done;
   }
   if(activeChat===chat)renderTurns();
  },onError:message=>toast(message)
 });
};
window.addEventListener('pagehide',stopVoice);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVoice()});
function closePopover(){stopVoice();$('askPopover').classList.add('hidden')}
function dismissPopover(){
 closePopover();selection=null;reviewSelection=null;anchor=null;dragging=false;inputSelectionVersion++;
 for(const view of reviewViews)view.clearQuestionSelection?.();
 document.querySelectorAll('.call-canvas').forEach(canvas=>canvas.dispatchEvent(new Event('clear-question-selection')));
 document.querySelectorAll('.editor-line.selected').forEach(line=>line.classList.remove('selected'));
}
let dismissingPopoverGesture=false;
const stopPopoverGesture=event=>{event.preventDefault();event.stopImmediatePropagation()};
document.addEventListener('pointerdown',event=>{
 dismissingPopoverGesture=false;
 if(!$('askPopover').classList.contains('hidden')&&!event.target.closest('#askPopover')){dismissingPopoverGesture=true;dismissPopover();stopPopoverGesture(event)}
},true);
for(const type of ['mousedown','pointerup','mouseup'])document.addEventListener(type,event=>{if(dismissingPopoverGesture)stopPopoverGesture(event)},true);
document.addEventListener('pointercancel',()=>{dismissingPopoverGesture=false},true);
document.addEventListener('click',event=>{
 if(dismissingPopoverGesture){dismissingPopoverGesture=false;stopPopoverGesture(event)}
},true);

$('editors').addEventListener('mousedown',e=>{const line=e.target.closest('.editor-line');if(!line||e.target.closest('.line-comment,.thread-pin'))return;closePopover();if(selectLine(line,e.shiftKey)){e.preventDefault();dragging=true}});
$('editors').addEventListener('mouseover',e=>{if(!dragging)return;const l=e.target.closest('.editor-line');if(l&&l.dataset.path===anchor.path&&Number(l.dataset.column)===anchor.column)selectLine(l,true)});
document.addEventListener('mouseup',e=>{if(dragging){dragging=false;openPopover(e.clientX,e.clientY)}});
$('editors').addEventListener('keydown',e=>{if(e.target.classList.contains('line-ask')&&e.key==='Enter')return;const l=e.target.closest('.editor-line');if(l&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(selectLine(l,e.shiftKey)){const r=l.getBoundingClientRect();openPopover(r.x+100,r.y)}}});
bindPaneDragging($('editors'),{move:(path,source,target)=>{if(activeFlow)return;columns=movePaneFile(columns,path,source,target);activeColumn=Math.max(0,columns.findIndex(c=>c.active===path));selection=null;renderEditors();tree()},split:(path,source)=>{if(activeFlow)return;if(columns.length>=3)return toast('Up to three editor columns are open.');const mode=columns[source]?.mode||'full';columns=movePaneFile(columns,path,source);columns.at(-1).mode=mode;activeColumn=columns.length-1;selection=null;renderEditors();tree()}});
$('editors').addEventListener('click',e=>{const x=e.target.closest('button');if(!x)return;if(x.hasAttribute('data-thread')){showLineThread(x)}else if(x.dataset.fullSource!==undefined){leaveFlow(+x.dataset.fullSource)}else if(x.classList.contains('line-comment')){addLineComment({path:x.dataset.commentPath,line:+x.dataset.commentLine,side:x.dataset.commentSide,body:''})}else if(x.classList.contains('line-ask')){const l=x.closest('.editor-line');selectLine(l);const r=x.getBoundingClientRect();openPopover(r.x,r.y)}else if(x.dataset.tab){activeColumn=Number(x.dataset.column);openFile(x.dataset.tab)}else if(x.dataset.mode!==undefined){const c=columns[+x.dataset.mode];c.mode=c.mode==='full'?'diff':'full';renderEditors()}else if(x.dataset.split!==undefined){const c=columns[+x.dataset.split];if(columns.length<3){columns.push({...c,tabs:[...c.tabs]});renderEditors()}else toast('Up to three editor columns are open.')}else if(x.dataset.closeColumn){columns.splice(+x.dataset.closeColumn,1);activeColumn=0;renderEditors()}else if(x.dataset.unfocus){focused.delete(x.dataset.unfocus);renderEditors()}});
function parseRef(value){const m=value.trim().match(/^(.+?):L?(\d+)(?:-L?(\d+))?$/);if(!m)return null;return {path:m[1],start:+m[2],end:+(m[3]||m[2])}}
function refAttrs(r){return `data-source="${esc(r.path)}" data-start="${r.start}" data-end="${r.end}"`}
function renderMarkdown(text){const parts=text.split(/(```[\s\S]*?(?:```|$))/g);return parts.map((part)=>{if(part.startsWith('```')){const m=part.match(/^```([^\n]*)\n?([\s\S]*?)(?:```)?$/),ref=parseRef(m?.[1]||'');return `<pre ${ref?refAttrs(ref):''} tabindex="0" ${ref?'role="button" aria-label="Open cited code"':''}>${ref?`<span class="snippet-source">↗ ${esc(ref.path)}:${ref.start}–${ref.end}</span>\n`:''}<code>${esc((m?.[2]||'').replace(/```$/,''))}</code></pre>`}return esc(part).replace(/\[([^\]\n]+?):L(\d+)(?:-L?(\d+))?\]/g,(_s,p,a,b)=>{const r={path:p.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'"),start:+a,end:+(b||a)};return `<button class="citation" ${refAttrs(r)}>↗ ${p}:${a}${b?'–'+b:''}</button>`}).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/\n/g,'<br>')}).join('')}
function renderTurns(){$('followup').hidden=!activeChat;if(!activeChat){$('messages').innerHTML=`<div class="chat-empty"><div class="chat-empty-mark" aria-hidden="true"><span>≈</span><i>${icon('comment')}</i></div><h3>Start a new chat.</h3><p>Ask about the PR, or select code<br>to explore a specific change.</p><button type="button" class="chat-empty-new" data-new-chat>＋ New chat</button></div>`;return}if(!turns.length){$('messages').innerHTML=`<div class="chat-empty"><div class="chat-empty-mark" aria-hidden="true"><span>≈</span><i>${icon('comment')}</i></div><h3>Explore this change.</h3><p>Ask about the PR, or select code<br>to start a focused conversation.</p><div class="chat-empty-prompts"><button type="button" data-chat-prompt="Summarize the changes in this PR.">Summarize the changes<span aria-hidden="true">↗</span></button><button type="button" data-chat-prompt="What should I look at first in this PR?">Where should I start?<span aria-hidden="true">↗</span></button></div></div>`;return}const atBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<100;$('messages').innerHTML=turns.map((t,i)=>`<article class="turn"><div class="turn-question">${esc(t.q)}</div><div class="turn-answer ${t.streaming?'streaming':''}">${renderMarkdown(t.a)}</div>${t.drafted?'<button class="draft-link" data-open-review>Review AI draft ↗</button>':''}${t.activity?`<div class="search-activity">${esc(t.activity)}</div>`:''}${t.error?`<p class="error">${esc(t.error)}</p>`:''}<div class="turn-meta">${demo?'Simulated demo':t.head?'PR commit '+t.head.slice(0,7):'Searching repository…'}</div></article>`).join('');if(atBottom)$('messages').scrollTop=$('messages').scrollHeight}
async function focusCitations(text){
  const refs=[...text.matchAll(/\[([^\]\n]+?):L(\d+)(?:-L?(\d+))?\]/g)].map(m=>({path:m[1],start:+m[2],end:+(m[3]||m[2])}));
  const steps=[];
  for(const ref of refs.slice(0,3)){try{const file=await getFile(ref.path);const count=file.text.split('\n').length;if(ref.start<1||ref.start>count||ref.end<ref.start)continue;steps.push({...ref,end:Math.min(ref.end,count,ref.start+79),entryLine:ref.start,label:ref.path.split('/').pop(),relation:steps.length?'related':'entry',callerLine:null})}catch{}}
  if(steps.length)await applyFlow({title:'Relevant source',summary:text.replace(/\[[^\]]+\]/g,'').trim().slice(0,180),steps});
}
async function ask(question){
  if(!pr)return toast('Open a pull request first.');
  setConversationCollapsed(false);const chat=activeChat||newChat();if(chat.abort)return toast('This chat is still answering. Open another tab to ask in parallel.');
  const generation=prGeneration, context=chat.context, prior=chat.turns.filter(t=>!t.error).flatMap(t=>[{role:'user',content:t.q},{role:'assistant',content:t.a}]);
  const turn={q:question,a:'',streaming:true,activity:'Finding relevant source…',origin:context,head:pr.head};chat.turns.push(turn);
  if(chat.turns.length===1&&!context)chat.title=question.slice(0,32);
  const abort=new AbortController();chat.abort=abort;closePopover();renderChatTabs();
  const render=()=>{if(chat===activeChat)renderTurns()};render();
  try{
    if(demo){const text='A failed delivery queues a retry. The delay doubles each attempt; the fifth attempt stops the chain.';for(let i=0;i<text.length;i+=12){if(abort.signal.aborted)throw new DOMException('Stopped','AbortError');turn.a+=text.slice(i,i+12);render();await new Promise(r=>setTimeout(r,40))}}
    else{
      const questionContext=context?.intermediate?'\nSelected intermediate transformation '+context.step+' in '+context.path+' (these are not head coordinates):\n'+context.text.slice(0,2800):'';
      const response=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:pr.url,head:pr.head,question:question+questionContext,selection:context&&!context.intermediate?{path:context.path,start:context.start,end:context.end}:null,history:prior}),signal:abort.signal});
      if(!response.ok){const body=await response.json();throw new Error(body.error||'Could not start answer')}
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
      while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});const events=pending.split('\n\n');pending=events.pop();for(const raw of events){const event=raw.match(/^event: (.+)$/m)?.[1],data=raw.match(/^data: (.+)$/m)?.[1];if(!data)continue;const body=JSON.parse(data);if(generation!==prGeneration)return;if(event==='delta')turn.a+=body.text;if(event==='activity')turn.activity=body.text;if(event==='scope')turn.activity='Exploring '+body.indexedFiles+' repository files';if(event==='flow')turn.flow=body;if(event==='draft'){mergeDraft(body);turn.drafted=true}if(event==='error')throw new Error(body.message);render()}}
    }
  }catch(error){turn.error=error.name==='AbortError'?'Answer stopped.':error.message}
  finally{turn.streaming=false;turn.activity='';chat.abort=null;render();renderChatTabs()}
}
function prRoute(url){return '/github'+new URL(url).pathname}
function routePR(){const match=location.pathname.match(/^\/github(\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?)$/);return match?'https://github.com'+match[1]:null}
let homeItems=[],homeCutoff='',homeShowOlder=false,homeOlderLoaded=false,homeRequest=0;
function renderHomePulls(){
 const groups=groupPullRequests(homeItems,{query:$('filterPulls').value,cutoff:Date.parse(homeCutoff),includeOlder:homeShowOlder});
 $('homeRange').textContent=homeShowOlder?'Assigned to you · All dates.':'Assigned to you · Updated in the last two weeks.';
 $('homePulls').innerHTML=groups.length?groups.map(group=>`<section class="home-repository"><h2>${icon('folder')}<span>${esc(group.repo)}</span><small>${group.items.length}</small></h2><div>${group.items.map(p=>`<a class="home-pr" href="${esc(prRoute(p.url))}"><span class="home-pr-number">#${p.number}</span><b title="${esc(p.title)}">${esc(p.title)}</b><span class="home-pr-author">${esc(p.author||'')}</span><time datetime="${esc(p.updated)}" title="Updated ${esc(new Date(p.updated).toLocaleString())}">${esc(new Date(p.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</time></a>`).join('')}</div></section>`).join(''):`<div class="home-empty">${$('filterPulls').value.trim()?'No pull requests match your filter.':homeShowOlder?'No open pull requests assigned to you or requesting your review.':'No pull requests assigned to you or requesting your review in the last two weeks.'}</div>`;
 $('showMorePulls').textContent=homeShowOlder?'Show fewer pull requests':'Show more pull requests';$('showMorePulls').setAttribute('aria-expanded',String(homeShowOlder));
}
async function showHome(){
  setConversationCollapsed(true);$('prHome').hidden=false;$('openPulls').setAttribute('aria-expanded','true');$('openPulls').classList.add('active');
  homeItems=[];homeShowOlder=false;homeOlderLoaded=false;homeCutoff=new Date(Date.now()-14*864e5).toISOString();
  $('inbox').classList.add('hidden');$('prHome').classList.add('pulls-loading');$('homePulls').innerHTML='<p class="pulls-loading-message" role="status">Loading pull requests…</p>';$('showMorePulls').hidden=true;$('refreshPulls').disabled=true;
  $('homeRange').textContent='Assigned to you · Updated in the last two weeks.';
  const generation=++homeRequest;
  try{const result=await api('/api/prs?'+new URLSearchParams({relation:'assigned',since:homeCutoff}));if(generation!==homeRequest)return;homeItems=result.items;renderHomePulls();$('showMorePulls').hidden=false;$('showMorePulls').disabled=false}catch(error){if(generation===homeRequest)$('homePulls').textContent=error.message}finally{if(generation===homeRequest){$('refreshPulls').disabled=false;$('prHome').classList.remove('pulls-loading')}}
}
$('showMorePulls').onclick=async()=>{
 if(homeOlderLoaded){homeShowOlder=!homeShowOlder;renderHomePulls();return}
 const generation=++homeRequest;$('showMorePulls').disabled=true;$('showMorePulls').textContent='Loading older pull requests…';
 try{const result=await api('/api/prs?'+new URLSearchParams({relation:'assigned',since:homeCutoff,older:'1'}));if(generation!==homeRequest)return;
  homeItems=[...new Map([...homeItems,...result.items].map(item=>[item.url,item])).values()];homeOlderLoaded=true;homeShowOlder=true;renderHomePulls();
 }catch(error){if(generation===homeRequest){$('showMorePulls').textContent='Retry loading older pull requests';toast(error.message)}}finally{if(generation===homeRequest)$('showMorePulls').disabled=false}
};
$('refreshPulls').onclick=showHome;$('filterPulls').oninput=renderHomePulls;
$('homePulls').onclick=event=>{const link=event.target.closest('a.home-pr');if(link&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();loadPR('https://github.com'+new URL(link.href).pathname.slice('/github'.length))}};
window.addEventListener('popstate',()=>{const url=routePR();url?loadPR(url,false):showHome()});
async function loadPR(url,navigate=true){streamAbort?.abort();const generation=++prGeneration;toast('Loading pull request…');try{const data=await api('/api/pr?'+new URLSearchParams({url}));if(generation!==prGeneration)return;if(navigate&&location.pathname!==prRoute(data.url))history.pushState({},'',prRoute(data.url));setPR(data);$('inbox').classList.add('hidden');if(pr.limited)toast('GitHub returned a partial file list. This walkthrough cannot cover the entire PR.')}catch(e){toast(e.message)}}
function setPR(data){stopVoice();voiceReference=null;document.querySelectorAll('.call-canvas').forEach(el=>el.remove());document.body.classList.remove('home-view');$('prHome').hidden=true;chats.forEach(c=>c.abort?.abort());chats=[];activeChat=null;pr=data;activeFlow=null;$('flowHeader').classList.add('hidden');$('inlineThread').classList.add('hidden');setExplorerCollapsed(false);setConversationCollapsed(true);reviewComments=[];reviewSummary='';reviewPr=pr.head;$('reviewBody').value='';treeNodes=new Map();expandedFolders=new Set(['']);treeLoading=new Set();treeErrors=new Map();columns=[];activeColumn=0;turns=[];selection=null;focused.clear();cache.clear();$('repo').textContent=pr.repo;$('prTitle').textContent=pr.title+' #'+pr.number;$('prTitle').title=pr.title+' #'+pr.number;$('prMeta').textContent=`${pr.author} · ${pr.changedFiles} changed files · ${pr.head.slice(0,7)}`;$('url').value=pr.url;newChat(null,false);showReviewSetup();loadTreeFolder();if(pr.files.length)openFile(pr.files[0].path);else $('editors').innerHTML='<div class="editor-empty"><h2>No changed files.</h2></div>'}
async function inbox(relation='review'){$('inbox').classList.remove('hidden');document.querySelectorAll('[data-relation]').forEach(x=>x.classList.toggle('active',x.dataset.relation===relation));$('prs').textContent='Loading…';try{if(demo){$('prs').innerHTML='<button class="pr-item" data-pr="demo"><b>Add retry handling to webhook delivery</b><small>acme/platform · #248 · sample PR</small></button>';return}const data=await api('/api/prs?relation='+relation);$('prs').innerHTML=data.items.length?data.items.map(p=>`<button class="pr-item" data-pr="${esc(p.url)}"><b>${esc(p.title)}</b><small>${esc(p.repo)} · #${p.number}</small></button>`).join(''):'<p class="muted">No open PRs found in connected repositories.</p>'}catch(e){$('prs').textContent=e.message}}
$('openForm').addEventListener('submit',e=>{e.preventDefault();if(demo)return toast('Demo mode uses the sample PR. Sign in on the main app to import GitHub PRs.');loadPR($('url').value.trim())});$('filetree').addEventListener('click',e=>{const folder=e.target.closest('[data-folder]'),retry=e.target.closest('[data-retry]');if(folder){const path=folder.dataset.folder;if(expandedFolders.has(path))expandedFolders.delete(path);else{expandedFolders.add(path);if(!treeNodes.has(path))loadTreeFolder(path,folder.dataset.sha)}tree();return}if(retry){loadTreeFolder(retry.dataset.retry,retry.dataset.sha);return}const f=e.target.closest('[data-file]');if(f)openFile(f.dataset.file)});$('inlineForm').addEventListener('submit',e=>{e.preventDefault();const q=$('inlineQuestion').value.trim();if(q){$('inlineQuestion').value='';askInline(q)}});$('followup').addEventListener('submit',e=>{e.preventDefault();const q=$('followQuestion').value.trim();if(q){$('followQuestion').value='';ask(q)}});for(const id of ['inlineQuestion','followQuestion'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$(id==='inlineQuestion'?'inlineForm':'followup').requestSubmit()}});document.querySelectorAll('[data-ask]').forEach(b=>b.addEventListener('click',()=>askInline(b.dataset.ask)));$('closePopover').addEventListener('click',dismissPopover);document.addEventListener('keydown',e=>{if(e.key==='Escape'){dismissPopover();$('inbox').classList.add('hidden');$('reviewModal').classList.add('hidden')}});$('inboxButton').addEventListener('click',()=>showHome());$('closeInbox').addEventListener('click',()=>$('inbox').classList.add('hidden'));document.querySelectorAll('[data-relation]').forEach(x=>x.addEventListener('click',()=>inbox(x.dataset.relation)));$('prs').addEventListener('click',e=>{const p=e.target.closest('[data-pr]');if(p){$('inbox').classList.add('hidden');if(!demo)loadPR(p.dataset.pr)}});$('resetConversation').addEventListener('click',()=>{newChat();$('followQuestion').focus()});$('logout').addEventListener('click',async()=>{await api('/auth/logout',{method:'POST'});location.href='/'});
let previewTimer;function sourceEvent(e){if(e.target.closest('[data-open-review]')){if(e.type==='click')showReview();return}const r=e.target.closest('[data-source]');if(!r)return;clearTimeout(previewTimer);const action=()=>openFile(r.dataset.source,{start:+r.dataset.start,end:+r.dataset.end},true);if(e.type==='mouseover')previewTimer=setTimeout(action,450);else action()}
$('messages').addEventListener('click',event=>{if(event.target.closest('[data-new-chat]')){newChat();$('followQuestion').focus();return}const prompt=event.target.closest('[data-chat-prompt]');if(!prompt)return;$('followQuestion').value=prompt.dataset.chatPrompt;$('followQuestion').focus();if(activeChat)activeChat.draft=prompt.dataset.chatPrompt});
$('messages').addEventListener('click',sourceEvent);$('messages').addEventListener('mouseover',sourceEvent);$('messages').addEventListener('mouseout',()=>clearTimeout(previewTimer));$('messages').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('[data-source]'))sourceEvent(e)});
async function init(){if(demo){$('signin').classList.add('hidden');showAccount({login:'demo'});const files=window.sampleFiles.map(f=>({path:f.name,status:'modified',patch:'@@ -'+f.start+','+f.lines.length+' +'+f.start+','+f.lines.length+' @@\n'+f.lines.map(l=>l.startsWith('+')||l.startsWith('-')?l:' '+l).join('\n')}));setPR({url:'https://github.com/acme/platform/pull/248',title:'Add retry handling to webhook delivery',number:248,repo:'acme/platform',head:'a81fc9ed000000000000000000000000000000000',author:'maya',changedFiles:5,files});return}try{status=await api('/api/status');$('connectRepos').href=status.installUrl||'https://github.com/settings/installations';if(!status.github){$('setupStatus').textContent='GitHub connection setup is in progress.';$('githubSign').removeAttribute('href')}user=await api('/api/me');showAccount(user);$('logout').hidden=false;$('signin').classList.add('hidden');const direct=routePR();if(direct)await loadPR(direct,false);else await showHome()}catch(e){if(e.message!=='Sign in with GitHub')$('setupStatus').textContent=e.message}}
function mergeDraft(draft){if(draft.body)reviewSummary+=(reviewSummary?'\n\n':'')+draft.body;for(const c of draft.comments||[])if(!reviewComments.some(x=>x.path===c.path&&x.line===c.line&&x.body===c.body))reviewComments.push({...c})}
function addLineComment(c){if(!pr)return;const file=pr.files.find(f=>f.path===c.path),lines=new Set(patchRows(file?.patch||'').map(r=>c.side==='LEFT'?r.old:r.line));for(let n=c.start_line||c.line;n<=c.line;n++)if(!lines.has(n))return toast('Inline comments belong on PR diff lines. Use a general review for unchanged code.');reviewComments.push(c);closePopover();showReview();$('reviewComments').querySelector('textarea:last-of-type')?.focus()}
function showReview(){if(!pr)return toast('Open a pull request first.');$('reviewModal').classList.remove('hidden');$('reviewTarget').textContent=pr.repo+' #'+pr.number+' · '+pr.head.slice(0,7);$('reviewBody').value=reviewSummary;$('reviewError').textContent='';$('postedReview').hidden=true;renderReviewComments()}
function renderReviewComments(){$('reviewComments').innerHTML=reviewComments.map((c,i)=>`<div class="review-comment"><div><button data-review-source="${i}">${esc(c.path)}:${c.start_line||c.line}${c.start_line&&c.start_line!==c.line?'–'+c.line:''} ${c.side==='LEFT'?'(original)':''}</button><button data-remove-comment="${i}" aria-label="Remove line comment">×</button></div><textarea data-edit-comment="${i}" aria-label="Comment on ${esc(c.path)} line ${c.line}" placeholder="Write a comment on these lines…">${esc(c.body)}</textarea></div>`).join('')}
$('closeReview').onclick=()=>$('reviewModal').classList.add('hidden');$('reviewBody').oninput=e=>{reviewSummary=e.target.value};
$('reviewComments').addEventListener('input',e=>{if(e.target.dataset.editComment!==undefined)reviewComments[+e.target.dataset.editComment].body=e.target.value});
$('reviewComments').onclick=e=>{const remove=e.target.closest('[data-remove-comment]');if(remove){reviewComments.splice(+remove.dataset.removeComment,1);renderReviewComments();return}const source=e.target.closest('[data-review-source]');if(source){const c=reviewComments[+source.dataset.reviewSource];$('reviewModal').classList.add('hidden');openFile(c.path,c.side==='LEFT'?null:{start:c.start_line||c.line,end:c.line},true)}};
$('commentSelection').onclick=()=>{
 const context=reviewSelection||selection;if(!context)return;
 let range={start:context.start,end:context.end||context.start};
 if(reviewSelection&&context.intermediate!==false&&reviewPlan){const file=reviewPlan.files.find(f=>f.path===context.path);const current=stateAt(reviewPlan,reviewCount)[context.path];if(!file||typeof current!=='string')return toast('This source is unavailable for an inline comment.');range=commentLines(current,file.after,range.start,range.end);if(!range)return toast('These lines change again later in the review. Open the final code before commenting.');}
 addLineComment({path:context.path,...(range.start!==range.end?{start_line:range.start}:{}),line:range.end,side:'RIGHT',body:$('inlineQuestion').value.trim()});
};
$('publishReview').onclick=async()=>{
  if(!pr||reviewPr!==pr.head)return toast('Reopen the current pull request first.');
  if(demo){$('reviewError').textContent='This is a sample draft. Sign in on the production app to publish a real GitHub review.';return}
  const button=$('publishReview');button.disabled=true;$('reviewError').textContent='';
  try{const data=await api('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:pr.url,head:pr.head,body:reviewSummary,event:$('reviewEvent').value,comments:reviewComments})});reviewComments=[];reviewSummary='';$('reviewBody').value='';renderReviewComments();$('postedReview').href=data.url;$('postedReview').hidden=false;toast('Review published on GitHub.')}catch(error){$('reviewError').textContent=error.message}finally{button.disabled=false}
};

function scrollCodeLine(line){if(!line)return;const container=line.closest('.editor-lines');container.scrollTop+=line.getBoundingClientRect().top-container.getBoundingClientRect().top-container.clientHeight/3}
function setExplorerCollapsed(collapsed){if(reviewPlan&&collapsed)return;$('workspace').classList.toggle('explorer-collapsed',collapsed);$('toggleExplorer').setAttribute('aria-expanded',String(!collapsed));$('toggleExplorer').setAttribute('aria-label',collapsed?'Expand explorer':'Collapse explorer');requestAnimationFrame(drawFlowLinks)}
function setConversationCollapsed(collapsed){
 document.body.classList.toggle('chat-collapsed',collapsed);$('conversation').hidden=collapsed;if(!collapsed){$('prHome').hidden=true;$('openPulls').setAttribute('aria-expanded','false')}
 $('openChat').classList.toggle('active',!collapsed);$('openPulls').classList.toggle('active',!$('prHome').hidden);
 $('workspace').classList.toggle('conversation-collapsed',collapsed);
 for(const id of ['toggleConversation','collapseChat','openChat'])$(id).setAttribute('aria-expanded',String(!collapsed));
 $('toggleConversation').setAttribute('aria-label',collapsed?'Expand conversation':'Collapse conversation');
 requestAnimationFrame(drawFlowLinks);
}
$('collapseChat').onclick=()=>{setConversationCollapsed(true);$('openChat').focus()};
$('openChat').innerHTML=icon('chat');$('openPulls').innerHTML=icon('pulls');
$('openChat').onclick=()=>setConversationCollapsed(!$('conversation').hidden);
$('closePulls').onclick=()=>{$('prHome').hidden=true;$('openPulls').setAttribute('aria-expanded','false');$('openPulls').classList.remove('active');$('openPulls').focus()};
$('openPulls').onclick=()=>{if(!$('prHome').hidden){$('closePulls').click();return}if(!homeCutoff){showHome();return}setConversationCollapsed(true);$('prHome').hidden=false;$('openPulls').setAttribute('aria-expanded','true');$('openPulls').classList.add('active')};
$('toggleExplorer').onclick=()=>setExplorerCollapsed(!$('workspace').classList.contains('explorer-collapsed'));
$('toggleConversation').onclick=()=>setConversationCollapsed(!$('workspace').classList.contains('conversation-collapsed'));
async function applyFlow(flow){
  const generation=prGeneration;
  await Promise.all(flow.steps.map(step=>getFile(step.path)));
  if(generation!==prGeneration)return;
  activeFlow={...flow,steps:layoutFlow(flow.steps)};const turn=turns.at(-1);if(turn&&!selection)turn.origin={path:flow.steps[0].path,start:flow.steps[0].entryLine||flow.steps[0].start};
  columns=activeFlow.steps.map(step=>({tabs:[step.path],active:step.path,mode:'flow'}));activeColumn=0;
  focused.clear();activeFlow.steps.forEach(step=>focused.set(step.path,step));
  setExplorerCollapsed(true);$('editors').scrollTop=0;$('editors').scrollLeft=0;
  updateFlowSummary();renderEditors();tree();if(reviewPlan&&reviewExploring)renderWalkthrough();
}
function updateFlowSummary(){
  if(!activeFlow)return;
  $('flowHeader').classList.remove('hidden');
  $('flowHeader').innerHTML=`<div><b>${esc(activeFlow.title)}</b><span>${esc(activeFlow.summary||turns.at(-1)?.a?.slice(0,180)||'')}</span></div><button id="flowFollowup">✧ Follow up</button>`;
  $('flowFollowup').onclick=()=>showLineThread(document.querySelector('[data-thread]')||$('flowHeader'));
}
function drawFlowLinks(){
  const svg=$('flowLinks');if(!svg||!activeFlow)return;
  const container=$('editors'),rect=container.getBoundingClientRect();
  svg.setAttribute('width',container.scrollWidth);svg.setAttribute('height',container.scrollHeight);
  svg.innerHTML='<defs><marker id="flowArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10" fill="#a18abf"/></marker></defs>';
  activeFlow.steps.forEach((step,i)=>{
    if(!i||step.relation!=='call')return;
    const parent=container.querySelector(`.editor-col[data-column="${i-1}"]`),child=container.querySelector(`.editor-col[data-column="${i}"]`);
    const from=parent?.querySelector(`[data-line="${step.callerLine}"]`),to=child?.querySelector(`[data-line="${step.entryLine||step.start}"]`);if(!from||!to)return;
    const a=from.getBoundingClientRect(),b=to.getBoundingClientRect(),pr=parent.getBoundingClientRect(),cr=child.getBoundingClientRect();
    const x1=pr.right-rect.left+container.scrollLeft-15,x2=cr.left-rect.left+container.scrollLeft+9,y1=a.top-rect.top+container.scrollTop+10,y2=b.top-rect.top+container.scrollTop+10;
    svg.innerHTML+=`<path d="M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}" fill="none" stroke="#a18abf" stroke-width="1.5" marker-end="url(#flowArrow)"/>`;
  });
}
function leaveFlow(ci){const path=columns[ci].active,range=activeFlow?.steps[ci];activeFlow=null;$('flowHeader').classList.add('hidden');columns=[{tabs:[path],active:path,mode:'full'}];activeColumn=0;renderEditors();if(range)scrollCodeLine(document.querySelector(`[data-line="${range.start}"]`))}
function showLineThread(anchor){
  const turn=turns.at(-1);if(!turn)return;
  const box=$('inlineThread');box.classList.remove('hidden');$('threadQuestion').textContent=turn.q;$('threadAnswer').textContent=turn.flow?.summary||turn.a||'Finding the relevant code…';
  const rect=anchor.getBoundingClientRect();box.style.left=Math.max(40,Math.min(rect.left,innerWidth-370))+'px';box.style.top=Math.max(80,Math.min(rect.bottom+8,innerHeight-210))+'px';$('threadInput').focus();
}
$('closeThread').onclick=()=>$('inlineThread').classList.add('hidden');
$('threadForm').onsubmit=e=>{e.preventDefault();const question=$('threadInput').value.trim();if(question){$('threadInput').value='';const origin=turns.at(-1)?.origin;if(origin)selection={...origin,column:Math.max(0,columns.findIndex(c=>c.active===origin.path)),end:origin.end||origin.start};ask(question)}};
window.addEventListener('resize',drawFlowLinks);
function demoFlow(question){return {title:'Delivery → retry delay',summary:'A failed delivery queues another attempt using an exponentially increasing delay.',steps:[{path:'src/delivery.ts',start:4,end:20,entryLine:4,label:'deliver(event)',relation:'entry',callerLine:null},{path:'src/retry-policy.ts',start:1,end:6,entryLine:4,label:'retryDelay(attempt)',relation:'call',callerLine:18}]}}

let reviewPanes=[];
let reviewPlan=null,reviewPath='',reviewCount=0,reviewExploring=false,reviewViews=[],reviewSelection=null,reviewVerified=false;
let walkthroughReady=false,walkthroughIndex=0;
let reviewSession=null,reviewDone=false,nextPending=false,nextError='',reviewPace='moderate';
let editorWrap=true;try{editorWrap=localStorage.getItem('codesurf-wrap')!=='false';reviewPace=localStorage.getItem('codesurf-pace')||'moderate'}catch{}
setEditorWrapping(editorWrap);document.body.classList.toggle('code-wrap',editorWrap);$('toggleWrap').innerHTML=icon('wrap');$('toggleWrap').setAttribute('aria-pressed',String(editorWrap));$('toggleWrap').onclick=()=>{editorWrap=!editorWrap;setEditorWrapping(editorWrap);document.body.classList.toggle('code-wrap',editorWrap);$('toggleWrap').setAttribute('aria-pressed',String(editorWrap));try{localStorage.setItem('codesurf-wrap',String(editorWrap))}catch{}};
function updateReviewAnswer(){const box=$('reviewAnswer'),turn=turns.at(-1);if(box&&turn)box.textContent=turn.error||turn.a||turn.activity||(turn.streaming?'Finding relevant code…':'')}
function destroyReviewViews(){for(const view of reviewViews)view.destroy();reviewViews=[]}
function dockWalkthrough(){if(!reviewPlan)return;reviewExploring=true;setExplorerCollapsed(false);renderWalkthrough()}
function returnToWalkthrough(){reviewExploring=false;renderWalkthrough()}
function showReviewSetup(){
 reviewPanes=[];
 reviewPlan=null;reviewSession=null;reviewCount=0;walkthroughReady=false;reviewExploring=false;reviewSelection=null;destroyReviewViews();$('startReview').disabled=true;
 $('workspace').classList.add('review-mode');$('walkthrough').classList.remove('hidden');
 const paces=['guided','moderate','quick'];let position=Math.max(0,paces.indexOf(reviewPace));
 $('walkthrough').innerHTML=`<section class="review-setup"><span class="review-setup-mark" aria-hidden="true">≈</span><h2>Choose your review pace</h2><p>Decide how much detail you want to work through.</p><div class="pace-control"><input id="reviewPace" type="range" min="0" max="2" step="1" value="${position}" aria-label="Review pace"><div class="pace-labels">${['Guided','Moderate','Quick'].map((label,i)=>`<button type="button" data-pace="${i}">${label}</button>`).join('')}</div></div><h3 id="paceTitle"></h3><p id="paceDescription"></p><button id="beginReview" class="primary">Start review →</button><small>Existing review progress is kept. Your pace applies to the remaining changes.</small></section>`;
 const update=()=>{position=Number($('reviewPace').value);reviewPace=paces[position];$('reviewPace').style.setProperty('--pace-progress',position*50+'%');$('reviewPace').setAttribute('aria-valuetext',['Guided','Moderate','Quick'][position]);$('paceTitle').textContent=['One small change at a time','Connected changes, together','A few broader passes'][position];$('paceDescription').textContent=['Small chunks with detailed guidance. Useful when the code is new to you.','Groups related edits into logical changes. A balance of context and speed.','Larger groups for code you already know. Aim for roughly five chunks across the PR.'][position];document.querySelectorAll('[data-pace]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.pace)===position)))};
 $('reviewPace').oninput=update;document.querySelectorAll('[data-pace]').forEach(b=>b.onclick=()=>{$('reviewPace').value=b.dataset.pace;update()});update();
 $('beginReview').onclick=()=>{try{localStorage.setItem('codesurf-pace',reviewPace)}catch{}startWalkthrough()};
}
async function startWalkthrough(){
  const generation=prGeneration;reviewSession=null;reviewDone=false;nextPending=false;nextError='';reviewPlan=null;reviewCount=0;walkthroughIndex=0;walkthroughReady=false;reviewExploring=false;reviewSelection=null;destroyReviewViews();
  $('workspace').classList.remove('walkthrough-active','walkthrough-docked');$('workspace').classList.add('review-mode');$('walkthrough').classList.remove('hidden');$('startReview').disabled=true;
  $('walkthrough').innerHTML='<div class="analysis-loading" role="status"><span class="analysis-spinner"></span><small>PREPARING REVIEW</small><h2>Loading review…</h2><p>Fetching changed files.</p></div>';
  try{
    let plan;
    if(demo){
      plan=await api('/api/demo-plan?pace='+reviewPace);
    }else {const result=await api('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:pr.url,head:pr.head,pace:reviewPace})});if(generation!==prGeneration)return;plan=result.plan;reviewSession=result.id;reviewCount=result.cursor;reviewDone=result.done;}
    if(generation!==prGeneration)return;
    reviewPlan=plan;reviewVerified=reviewSession?false:validatePlan(plan)&&plan.verified;reviewPath=plan.files[0]?.path||'';if(demo){window.sampleRepository=plan.files.map(f=>({name:f.path,start:1,lines:f.after.split('\n')}));pr.files=plan.files.map(f=>({path:f.path,status:f.status}));$('prMeta').textContent='maya · '+plan.files.length+' changed files · '+pr.head.slice(0,7);treeNodes=new Map();loadTreeFolder()}walkthroughReady=true;$('startReview').disabled=!plan.steps.length;if(reviewCount){const op=plan.operations.find(o=>plan.steps[reviewCount-1]?.ids.includes(o.id));if(op)reviewPath=op.path}renderWalkthrough();if(reviewSession)prepareNext(generation,reviewCount===0);
  }catch(error){if(generation!==prGeneration)return;$('walkthrough').innerHTML=`<div class="analysis-loading"><h2>Review could not be prepared.</h2><p>${esc(error.message)}</p><button id="retryPlan">Try again</button></div>`;$('retryPlan').onclick=startWalkthrough}
}
function updateNextControl(){
 const button=$('reviewNext');if(!button)return;
 const ready=reviewCount<reviewPlan.steps.length;
 button.disabled=!ready&&!nextError;
 button.textContent=ready?(reviewCount?'Next →':'Start Review'):nextError?'Retry next step':nextPending?'Preparing next…':'Review complete';
 $('startReview').disabled=!ready;
}
async function prepareNext(generation=prGeneration,autoStart=false){
 if(!reviewSession||nextPending||reviewDone||reviewPlan.steps.length>reviewCount){updateNextControl();return}
 const id=reviewSession,index=reviewPlan.steps.length;nextPending=true;nextError='';updateNextControl();
 try{
  const result=await api('/api/reviews/'+id+'/next',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index})});
  if(generation!==prGeneration||id!==reviewSession)return;
  if(result.step)reviewPlan.steps.push(result.step);reviewDone=result.done;nextPending=false;
  if(autoStart&&result.step&&reviewCount===0){await reviewAdvance(1);return}
  updateNextControl();
 }catch(error){if(generation!==prGeneration||id!==reviewSession)return;nextPending=false;nextError=error.message;updateNextControl();toast(error.message)}
}
async function reviewAdvance(delta){
 if(!reviewPlan)return;
 if(delta>0&&reviewCount>=reviewPlan.steps.length){if(nextError)prepareNext();return}
 const generation=prGeneration,id=reviewSession,target=Math.max(0,Math.min(reviewPlan.steps.length,reviewCount+delta));
 if(id&&delta>0){try{await api('/api/reviews/'+id+'/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cursor:target})})}catch(error){toast(error.message);return}if(generation!==prGeneration||id!==reviewSession)return}
 reviewCount=target;walkthroughIndex=reviewCount-1;reviewExploring=false;reviewSelection=null;
 const first=reviewPlan.operations.find(o=>reviewPlan.steps[reviewCount-1]?.ids.includes(o.id));if(first)reviewPath=first.path;
 renderWalkthrough();tree();if(id)prepareNext();
}
async function verifyReviewHashes(){
  const final=stateAt(reviewPlan,reviewPlan.steps.length);
  for(const file of reviewPlan.files){if(file.unavailable)continue;const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(final[file.path])))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==file.headHash)throw new Error('Checksum mismatch in '+file.path)}
  return true;
}
function showLineNotes(notes){const panel=$('lineExplanation');panel.classList.remove('hidden');panel.innerHTML='<button aria-label="Close line explanation" class="note-close">×</button>'+notes.map(n=>`<small>${n.side==='removed'?'Removed code · ':''}Line ${n.line}${n.endLine>n.line?'–'+n.endLine:''}</small><p>${esc(n.text)}</p>`).join('');panel.querySelector('button').onclick=()=>panel.classList.add('hidden')}
function renderStepTree(plan,count){
  const entries=stepFiles(plan,count),root={};
  for(const file of entries){const parts=file.path.split('/');let node=root;for(const part of parts.slice(0,-1))node=node[part]??={};node[parts.at(-1)]={file}}
  const render=(node)=>Object.entries(node).sort(([a,av],[b,bv])=>Number(!!av.file)-Number(!!bv.file)||a.localeCompare(b)).map(([name,item])=>item.file?`<button data-step-file="${esc(item.file.key)}" class="step-file ${item.file.key===reviewPath?'active':''} status-${item.file.status}" title="${esc(item.file.path)}${item.file.status?' · '+({A:'Added',M:'Modified',D:'Deleted',R:'Renamed'}[item.file.status]):''}">${fileIcon(name)}<span>${esc(name)}</span><b>${item.file.status}</b></button>`:`<details open><summary><span class="folder-chevron">${icon('right')}</span>${icon('folder')}<span>${esc(name)}</span></summary><div>${render(item)}</div></details>`).join('');
  return '<small>FILES AT THIS STEP</small>'+(entries.length?render(root):'<p>No files yet.</p>');
}
async function renderWalkthrough(){
  if(!reviewPlan)return;destroyReviewViews();const plan=reviewPlan,total=plan.steps.length,step=plan.steps[reviewCount-1],current=stateAt(plan,reviewCount),previous=stateAt(plan,Math.max(0,reviewCount-1));
  $('startReview').style.display=reviewCount?'none':'';$('startReview').textContent='Start Review';$('startReview').disabled=reviewCount===total;
  const stepPaths=[...new Set(plan.operations.filter(o=>step?.ids.includes(o.id)).map(o=>o.path))];const tabs=[...new Set([...stepPaths,reviewPath].filter(Boolean))];
  const unavailable=plan.files.filter(f=>f.unavailable),complete=(reviewSession?reviewDone:true)&&reviewCount===total;
  const weight=o=>(o.insert.match(/[^\n]*\n|[^\n]+$/g)||[]).length+(o.deleted.match(/[^\n]*\n|[^\n]+$/g)||[]).length;const selected=new Set(plan.steps.slice(0,reviewCount).flatMap(s=>s.ids));const totalLines=plan.operations.reduce((sum,o)=>sum+weight(o),0),reviewedLines=plan.operations.filter(o=>selected.has(o.id)).reduce((sum,o)=>sum+weight(o),0);const progress=totalLines?Math.floor(100*reviewedLines/totalLines):complete?100:0;const manifest=manifestAt(plan,reviewCount);
  $('walkthrough').innerHTML=`<div class="review-body"><div class="review-code"><div class="review-source-layout"><nav class="step-explorer" aria-label="Files at this transformation">${renderStepTree(plan,reviewCount)}</nav><div class="review-document"><div id="reviewCode" class="review-editor-host"></div></div></div></div><footer class="review-explanation"><button id="reviewBack" aria-label="Previous transformation" ${!reviewCount?'disabled':''}>← Previous</button><div class="footer-copy"><h3>${esc(step?.title||'Ready to review')}</h3>${reviewExploring?'<button id="backToStep">Return to transformation</button>':''}${unavailable.length||plan.limited?`<details class="unavailable-files"><summary>${unavailable.length?unavailable.length+' unavailable '+(unavailable.length===1?'file':'files'):'Partial file list'} ⓘ</summary><div class="unavailable-tooltip">${unavailable.map(file=>`<div><code>${esc(file.path)}</code><span>${esc((file.reason||'Source unavailable.').replace(/\s*Inspect this file on GitHub\.?/g,''))}</span></div>`).join('')}${plan.limited?'<div><span>GitHub returned a partial file list.</span></div>':''}</div></details>`:''}</div><details class="review-line-progress"><summary aria-label="Review progress: ${progress}%"><span class="line-progress-track" role="progressbar" aria-label="Changed lines reviewed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></span><span aria-hidden="true">ⓘ</span></summary><div class="line-progress-tooltip">You’ve reviewed ${reviewedLines} of ${totalLines} available changed lines (about ${progress}%).${unavailable.length||plan.limited?' Unavailable changes are excluded.':''}<span id="reconstructionStatus">${reviewVerified?'Reconstruction verified ✓':complete?'Checking reconstruction…':'Review in progress'}</span></div></details><button id="reviewNext" class="primary" ${complete?'disabled':''}>${reviewCount?'Next →':'Start Review'}</button></footer></div>`;
  attachSidebarResize($('walkthrough').querySelector('.step-explorer'));
  $('walkthrough').querySelectorAll('[data-step-file]').forEach(button=>button.onclick=()=>{reviewPath=button.dataset.stepFile;reviewExploring=false;reviewSelection=null;renderWalkthrough()});
  $('reviewBack').onclick=()=>reviewAdvance(-1);$('reviewNext').onclick=()=>reviewAdvance(1);if(reviewSession)updateNextControl();
  $('walkthrough').querySelectorAll('[data-review-file]').forEach(button=>button.onclick=()=>{reviewPath=button.dataset.reviewFile;renderWalkthrough();tree()});
  if($('backToStep'))$('backToStep').onclick=returnToWalkthrough;
  const host=$('reviewCode');
  if(reviewExploring&&activeFlow){
    host.classList.add('investigation-editors');for(const source of activeFlow.steps){const data=cache.get(pr.head+':head:'+source.path);if(!data)continue;const pane=document.createElement('div');pane.className='investigation-pane';pane.innerHTML=`<div class="investigation-label">${fileIcon(source.path)} ${esc(source.path)} · PR head</div><div class="investigation-mount"></div>`;host.append(pane);reviewViews.push(mountEditor(pane.lastElementChild,{after:data.text,path:source.path,diff:false,line:source.entryLine||source.start,onSelect:s=>selectReviewLines(s,source.path,false)}))}
  }else {
    host.classList.add('review-columns');
    reviewPanes=syncFilePanes(reviewPanes,tabs);
    for(const [paneIndex,group] of reviewPanes.entries()){
      const visible=group.tabs.filter(path=>tabs.includes(path));if(!visible.length)continue;
      const path=visible.includes(reviewPath)?reviewPath:visible.includes(group.active)?group.active:visible[0];group.active=path;
      const source=plan.files.find(f=>f.path===path),entry=manifest.find(f=>f.key===path),inStep=stepPaths.includes(path);
      const column=document.createElement('section');column.className='review-file-column';column.dataset.reviewPath=path;column.dataset.paneIndex=paneIndex;
      column.innerHTML=`<div class="review-tabs review-file-heading" role="tablist" aria-label="Files in pane">${visible.map(file=>`<button type="button" role="tab" aria-selected="${file===path}" draggable="true" data-pane-file="${esc(file)}" data-pane-tab="${esc(file)}" class="review-file-tab ${file===path?'active':''}" title="${esc(manifest.find(f=>f.key===file)?.path||file)} · Drag to another pane to group files">${fileIcon(file)}<span>${esc((manifest.find(f=>f.key===file)?.path||file).split('/').pop())}</span>${manifest.find(f=>f.key===file)?.exists===false?'<small>Deleted</small>':''}</button>`).join('')}${visible.length>1?'<button type="button" class="split-file-pane" aria-label="Move active file to a new pane" title="Move active file to a new pane">◫</button>':''}</div><div class="review-file-mount"></div>`;host.append(column);const pane=column.lastElementChild;
      column.querySelectorAll('[data-pane-tab]').forEach(tab=>tab.onclick=()=>{group.active=tab.dataset.paneTab;reviewPath=group.active;reviewSelection=null;renderWalkthrough();tree()});
      const splitButton=column.querySelector('.split-file-pane');if(splitButton)splitButton.onclick=()=>{reviewPanes=movePaneFile(reviewPanes,path,paneIndex);reviewPath=path;renderWalkthrough()};
      const mount=text=>reviewViews.push(mountEditor(pane,{before:previous[path]||'',after:text,path,diff:reviewCount>0&&inStep,blockExplanations:reviewBlocks(plan,reviewCount,path),onExplain:note=>{selectReviewLines(note,path);$('popcontext').textContent='Change note · '+path;$('inlineQuestion').value='Explain this change in more detail. Note: '+note.explanation},onSelect:s=>selectReviewLines(s,path)}));
      if(source?.unavailable)pane.innerHTML=`<p class="walk-warning">${esc(source.reason||'Source unavailable.')}</p>`;
      else if(source&&entry?.exists===false&&!inStep)pane.innerHTML='<div class="editor-loading">This file does not exist at this step.</div>';
      else if(source)mount(current[path]||'');
      else {pane.innerHTML='<p class="editor-loading">Loading source…</p>';try{const data=await getFile(path);if(pane.isConnected){pane.innerHTML='';mount(data.text)}}catch(error){if(pane.isConnected)pane.textContent=error.message}}
    }
  }

  if(voiceReference){
   const reference=voiceReference,data=cache.get(pr.head+':head:'+reference.path);
   if(data){
    const pane=document.createElement('section');pane.className='review-file-column voice-reference-pane';
    pane.innerHTML=`<div class="review-file-heading">${fileIcon(reference.path)}<span title="${esc(reference.path)}">${esc(reference.path)}</span><small>PR head</small><button type="button" aria-label="Close referenced code">×</button></div><div class="review-file-mount"></div>`;host.append(pane);
    pane.querySelector('button').onclick=()=>{voiceReference=null;renderWalkthrough()};
    const view=mountEditor(pane.lastElementChild,{after:data.text,path:reference.path,diff:false,line:reference.start,onSelect:s=>selectReviewLines(s,reference.path,false)});reviewViews.push(view);view.flashRange(reference.start,reference.end);
   }
  }

  bindPaneDragging(host,{move:(path,source,target)=>{reviewPanes=movePaneFile(reviewPanes,path,source,target);reviewPath=path;reviewSelection=null;renderWalkthrough()},split:(path,source)=>{reviewPanes=movePaneFile(reviewPanes,path,source);reviewPath=path;reviewSelection=null;renderWalkthrough()}});

  if(complete){try{reviewVerified=validatePlan(plan);await verifyReviewHashes();if($('reconstructionStatus'))$('reconstructionStatus').textContent=reviewVerified?'Reconstruction verified ✓':'Available files verified';const finish=$('walkthrough').querySelector('.review-finish');if(finish)finish.textContent=reviewVerified?'Verified: the reconstructed files exactly match the PR head.':'Available text files match. Unavailable files still need review.'}catch(error){reviewVerified=false;$('reconstructionStatus').textContent=error.message}}
}
$('startReview').onclick=()=>reviewAdvance(1);
attachSidebarResize($('explorer'));
newChat(null,false);setConversationCollapsed(true);
init();

document.addEventListener('note-audio-error',event=>toast(event.detail));

let darkEditor=false;try{darkEditor=localStorage.getItem('codesurf-editor-theme')==='dark'}catch{}
function applyEditorTheme(dark){darkEditor=dark;document.body.classList.toggle('editor-dark',dark);setEditorTheme(dark);$('editorLight').setAttribute('aria-pressed',String(!dark));$('editorDark').setAttribute('aria-pressed',String(dark));try{localStorage.setItem('codesurf-editor-theme',dark?'dark':'light')}catch{}}
$('editorLight').innerHTML=icon('sun');$('editorDark').innerHTML=icon('moon');$('editorLight').onclick=()=>applyEditorTheme(false);$('editorDark').onclick=()=>applyEditorTheme(true);applyEditorTheme(darkEditor);
