import {languageForPath} from './languages.js';
import {highlightTree,classHighlighter} from '@lezer/highlight';
const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function highlightCodeLines(path,text){
 const support=languageForPath(path),parser=(support?.language||support)?.parser;if(!parser)return text.split('\n').map(escape);
 const tree=parser.parse(text);let at=0,result='';
 highlightTree(tree,classHighlighter,(from,to,classes)=>{result+=escape(text.slice(at,from));result+=text.slice(from,to).split('\n').map(part=>`<span class="${classes}">${escape(part)}</span>`).join('\n');at=to});
 result+=escape(text.slice(at));return result.split('\n');
}
