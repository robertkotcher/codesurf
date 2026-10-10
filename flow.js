import {cleanPath} from './lib.js';
export function validateFlow(input,index){
  if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>5)throw new Error('Provide one to five relevant code blocks.');
  const steps=input.steps.map((s,i)=>{
    cleanPath(s.path);const source=index.files.get(s.path);if(source===undefined)throw new Error('Read the source before showing it.');
    const lines=source.split('\n');
    if(!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<1||s.end<s.start||s.end>lines.length||s.end-s.start>79)throw new Error('Use exact source ranges of at most 80 lines.');
    const entryLine=s.entryLine??s.start;if(!Number.isInteger(entryLine)||entryLine<s.start||entryLine>s.end)throw new Error('Entry line must be within the source block.');
    const previous=input.steps[i-1];
    // Recover an omitted call coordinate only when the supplied symbol occurs
    // exactly once as a call in the preceding source block.
    if(previous&&s.relation==='related'&&typeof s.symbol==='string'&&s.symbol){
      const escaped=s.symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const callPattern=new RegExp('(?:^|[^\\w$])'+escaped+'\\s*\\(');
      const candidates=index.files.get(previous.path).split('\n').slice(previous.start-1,previous.end).map((line,n)=>callPattern.test(line)?previous.start+n:null).filter(n=>n!==null);
      if(candidates.length===1)s={...s,relation:'call',callerLine:candidates[0]};
    }
    if(i&&s.relation==='call'){
      if(previous.path===s.path&&previous.start===s.start&&previous.end===s.end)throw new Error('Use the actual callee block, not the same caller range.');
      if(!Number.isInteger(s.callerLine)||s.callerLine<previous.start||s.callerLine>previous.end||typeof s.symbol!=='string'||!s.symbol||s.symbol.length>120)throw new Error('A call needs its exact call-site line in the preceding block.');
      const line=index.files.get(previous.path).split('\n')[s.callerLine-1];
      const symbol=s.symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if(!new RegExp('(?:^|[^\\w$])'+symbol+'\\s*\\(').test(line))throw new Error('The call symbol was not found at that line. Use related for a non-call relationship.');
    }
    return {path:s.path,start:s.start,end:s.end,entryLine,label:String(s.label||s.path).slice(0,100),relation:i?(s.relation==='call'?'call':'related'):'entry',callerLine:i&&s.relation==='call'?s.callerLine:null,symbol:s.symbol||null};
  });
  return {title:String(input.title||'Code flow').slice(0,100),summary:String(input.summary||'').slice(0,300),steps};
}
