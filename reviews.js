import {stateAt} from './public/transformations.js';
import {commentLines} from './browser/comment-lines.js';
import {cleanPath,parsePatch} from './lib.js';
export function validateReview(input,files){
  const {body,event='COMMENT',comments=[]}=input;
  if(!['COMMENT','APPROVE','REQUEST_CHANGES'].includes(event))throw Object.assign(new Error('Choose a review action.'),{status:400});
  if(typeof body!=='string'||body.length>20000||!Array.isArray(comments)||comments.length>30)throw Object.assign(new Error('Review is too large.'),{status:400});
  if(!body.trim()&&!comments.length&&event!=='APPROVE')throw Object.assign(new Error('Write a review or add a line comment.'),{status:400});
  const checked=comments.map(c=>{
    cleanPath(c.path);const f=files.find(f=>f.filename===c.path);
    const side=c.side==='LEFT'?'LEFT':'RIGHT',line=Number(c.line),start=Number(c.start_line||line);
    if(!f||!Number.isInteger(line)||!Number.isInteger(start)||start<1||start>line||typeof c.body!=='string'||!c.body.trim()||c.body.length>10000)throw Object.assign(new Error('Invalid line comment.'),{status:400});
    const valid=new Set(parsePatch(f.patch||'').filter(r=>side==='LEFT'?r.kind!=='add':r.kind!=='del').map(r=>side==='LEFT'?r.old:r.line));
    for(let n=start;n<=line;n++)if(!valid.has(n))throw Object.assign(new Error('Line comments must be within the current PR diff. Use a general review for other code.'),{status:400});
    return {path:c.path,side,line,body:c.body.trim(),...(start<line?{start_line:start,start_side:side}:{})};
  });
  return {body:body.trim(),event,comments:checked};
}

// Resolve comments against the immutable PR head before placing them in a draft.
export function draftReview(args,files,{plan,count,snapshot='head'}={}){
  let {path,start,end,body}=args;
  if(path!==null&&typeof path!=='string')throw Object.assign(new Error('Choose a file or a general PR comment.'),{status:400});
  if(path!==null){
    cleanPath(path);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start)throw Object.assign(new Error('Choose an existing line range.'),{status:400});
    if(snapshot==='review'&&plan){
      const file=plan.files.find(f=>f.path===path||f.previousPath===path);
      if(file){
        const current=stateAt(plan,count)[file.path];
        if(typeof current!=='string'||typeof file.after!=='string')throw Object.assign(new Error('This file is unavailable for an inline comment.'),{status:400});
        const mapped=commentLines(current,file.after,start,end);
        if(!mapped)throw Object.assign(new Error('These lines change later in the review. Open the final code to comment, or leave a general PR comment.'),{status:400});
        path=file.path;({start,end}=mapped);
      }
    }
  }
  return validateReview({body:path===null?body:'',event:'COMMENT',comments:path===null?[]:[{path,line:end,start_line:start,side:'RIGHT',body}]},files);
}
