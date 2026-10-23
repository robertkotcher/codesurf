import {commentLines} from './browser/comment-lines.js';
import {stateAt,manifestAt} from './public/transformations.js';
import {validateReview} from './reviews.js';
const problem=(message,status=400)=>Object.assign(new Error(message),{status});
function safeURL(value,host){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname===host?url.href:null}catch{return null}}
export function publicPRComment(comment){
 return {id:comment.id,replyTo:comment.in_reply_to_id||null,body:String(comment.body||''),path:comment.path,line:comment.line,side:comment.side||'RIGHT',createdAt:comment.created_at,url:safeURL(comment.html_url,'github.com'),author:{login:String(comment.user?.login||'GitHub user'),avatar:safeURL(comment.user?.avatar_url,'avatars.githubusercontent.com')}};
}
export function inlineCommentTarget(plan,count,selection,files,sourceFiles){
 const file=plan.files.find(file=>file.path===selection.path||file.previousPath===selection.path),current=sourceFiles.get(selection.path);
 if(!file||file.unavailable||typeof file.after!=='string'||typeof current!=='string')throw problem('GitHub only accepts inline comments on files in this pull request’s diff. Ask AI about this line instead.');
 const mapped=commentLines(current,file.after,selection.line);
 if(!mapped)throw problem('This line changes again later in the review and cannot be commented on yet. Open its final version to leave a comment.',409);
 try{return validateReview({body:'',event:'COMMENT',comments:[{path:file.path,line:mapped.start,side:'RIGHT',body:'Comment'}]},files).comments[0]}
 catch(error){if(error.status===400)throw problem('This line is outside GitHub’s pull request diff. Inline comments can be posted on changed lines and the surrounding diff context.');throw error}
}
export function reviewCommentThreads(raw,plan,count){
 const comments=raw.map(publicPRComment),byId=new Map(comments.map(comment=>[comment.id,comment])),groups=new Map();
 function rootFor(comment){const seen=new Set();while(comment.replyTo&&byId.has(comment.replyTo)&&!seen.has(comment.id)){seen.add(comment.id);comment=byId.get(comment.replyTo)}return comment}
 for(const comment of comments){const root=rootFor(comment);if(root.replyTo)continue;const group=groups.get(root.id)||{root,comments:[]};group.comments.push(comment);groups.set(root.id,group)}
 const threads=[];
 for(const {root,comments:entries}of groups.values()){
  // GitHub's current diff coordinates are authoritative. Outdated and removed
  // lines have no current right-side anchor and must not attach to another line.
  if(root.side!=='RIGHT'||!Number.isInteger(root.line)||root.line<1)continue;
  const file=plan.files.find(file=>file.path===root.path);if(!file||file.unavailable||typeof file.after!=='string')continue;
  for(const [snapshot,step]of [['after',count],['before',count-1]]){
   const state=stateAt(plan,step),manifest=manifestAt(plan,step),entry=manifest.find(entry=>entry.key===file.path),text=state[file.path];if(!entry?.exists||typeof text!=='string')continue;
   const mapped=commentLines(file.after,text,root.line);if(!mapped)continue;
   threads.push({id:root.id,path:entry.path,line:mapped.start,snapshot,comments:entries.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||a.id-b.id)});
  }
 }
 return threads;
}
