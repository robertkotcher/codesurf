import {formatChatMessage} from './canvas-chat.js';
import {icon} from './canvas-icons.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeURL(value,host){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname===host?url.href:null}catch{return null}}
function avatar(user){const url=safeURL(user?.avatar||user?.avatar_url,'avatars.githubusercontent.com');return url?`<img class="pr-comment-avatar" src="${esc(url)}" alt="" width="22" height="22" loading="lazy">`:`<span class="pr-comment-avatar avatar-fallback" aria-hidden="true">${esc((user?.login||'?').slice(0,1).toUpperCase())}</span>`}
function timestamp(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}
export function commentDraftKey(selection,replyTo){return JSON.stringify([selection.anchorId,selection.path,selection.line,selection.snapshot,replyTo||null])}
export function mergeCommentThreads(prior,incoming){const threads=new Map(prior.map(thread=>[JSON.stringify([thread.id,thread.path,thread.line,thread.snapshot]),thread]));for(const thread of incoming){const key=JSON.stringify([thread.id,thread.path,thread.line,thread.snapshot]),old=threads.get(key);threads.set(key,{...thread,comments:[...new Map([...(old?.comments||[]),...thread.comments].map(comment=>[comment.id,comment])).values()]})}return [...threads.values()]}
export function renderCanvasComments({world,threads=[],drafts={},user,sourceForRow,onEdit,onPost,onCancel,onReply}){
 function composer(draft){
  const form=document.createElement('form');form.className='pr-comment-composer';form.dataset.commentForm=draft.key;form.setAttribute('aria-label',draft.replyTo?'Reply to pull request comment':'Leave a pull request comment');
  form.innerHTML=`<div class="pr-composer-heading">${avatar(user)}<strong>${draft.replyTo?'Reply':'Write a comment'}</strong><span>GitHub</span></div><textarea data-comment-input="${esc(draft.key)}" aria-label="${draft.replyTo?'Reply':'Comment'}" placeholder="${draft.replyTo?'Write a reply…':'Leave a comment…'}" rows="3" maxlength="10000" ${draft.busy?'readonly':''}></textarea><p class="pr-comment-error" role="status" ${draft.error?'':'hidden'}>${esc(draft.error)}</p><div class="pr-comment-actions"><span>${draft.preparing?'Checking this line…':draft.ready?'Posts immediately to this pull request':''}</span><button type="button" data-cancel-comment ${draft.busy?'disabled':''}>Cancel</button><button class="primary" type="submit" ${!draft.ready||draft.busy||!draft.body?.trim()?'disabled':''}>${draft.busy?'Posting…':draft.replyTo?'Reply on GitHub':'Comment on GitHub'}</button></div>`;
  const input=form.querySelector('textarea');input.value=draft.body||'';input.oninput=()=>{onEdit(draft.key,input.value);form.querySelector('[type="submit"]').disabled=!draft.ready||draft.busy||!input.value.trim()};
  form.onsubmit=event=>{event.preventDefault();if(draft.ready&&!draft.busy&&input.value.trim())onPost(draft.key)};form.querySelector('[data-cancel-comment]').onclick=()=>onCancel(draft.key);input.onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();form.requestSubmit()}};return form;
 }
 for(const row of world.querySelectorAll('.code-row:not(.removed)')){
  const source=sourceForRow(row);if(!source)continue;const {selection}=source;let cursor=row;
  const relevant=threads.filter(thread=>thread.path===selection.path&&thread.line===selection.line&&thread.snapshot===selection.snapshot);
  for(const thread of relevant){
   const element=document.createElement('section');element.className='pr-inline-thread';element.dataset.commentThread=thread.id;element.setAttribute('aria-label','Pull request comment thread');
   element.innerHTML=thread.comments.map(comment=>{const url=safeURL(comment.url,'github.com');return `<article class="pr-posted-comment" data-github-comment="${comment.id}"><header>${avatar(comment.author)}<strong>${esc(comment.author.login)}</strong><time datetime="${esc(comment.createdAt)}">${esc(timestamp(comment.createdAt))}</time>${url?`<a href="${esc(url)}" target="_blank" rel="noopener" aria-label="View comment on GitHub" title="View on GitHub">${icon('external')}</a>`:''}</header><div class="pr-comment-body">${formatChatMessage(comment.body)}</div></article>`}).join('');
   const reply=Object.values(drafts).find(draft=>draft.replyTo===thread.id&&draft.selection.anchorId===selection.anchorId&&draft.selection.snapshot===selection.snapshot&&draft.selection.line===selection.line);
   if(reply)element.append(composer(reply));else{const button=document.createElement('button');button.type='button';button.className='pr-comment-reply';button.textContent='Reply…';button.onclick=()=>onReply(selection,thread.id);element.append(button)}
   cursor.after(element);cursor=element;
  }
  for(const draft of Object.values(drafts).filter(draft=>!draft.replyTo&&draft.selection.anchorId===selection.anchorId&&draft.selection.line===selection.line&&draft.selection.snapshot===selection.snapshot)){const element=composer(draft);cursor.after(element);cursor=element}
 }
}
