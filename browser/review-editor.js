export {commentLines} from './comment-lines.js';
import {foldService,foldEffect,unfoldEffect,foldedRanges,HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {defaultFunctionFolds} from './function-folds.js';
import {contextField,collapseContext} from './diff-context.js';
import {readNote,stopNoteSpeech} from './note-speech.js';
import {EditorView,basicSetup} from 'codemirror';
import {Decoration,WidgetType,lineNumbers} from '@codemirror/view';
import {RangeSet} from '@codemirror/state';
import {EditorState,StateField,StateEffect,Compartment} from '@codemirror/state';
import {unifiedMergeView,getChunks} from '@codemirror/merge';
import {languageForPath} from './languages.js';
import {createElement,File,FileCode,FileJson,FileText,Folder,FolderOpen,ChevronRight,ChevronDown,MessageCircle,GitPullRequest,WrapText,Volume2,Sun,Moon,GitGraph,Mic,Square,ChevronLeft,Eye,PanelLeftClose,PanelLeftOpen,X,CheckCheck,MessageSquareWarning,Bookmark,BookmarkCheck,MessageSquare,RefreshCw,Plus,ArrowUp,ArrowUpRight,Columns2,UserRound,Ellipsis,GitMerge,GitPullRequestClosed} from 'lucide';
export function icon(name){return createElement(({file:File,code:FileCode,json:FileJson,text:FileText,folder:Folder,open:FolderOpen,left:ChevronLeft,right:ChevronRight,down:ChevronDown,comment:MessageCircle,chat:MessageSquare,pulls:GitPullRequest,wrap:WrapText,speaker:Volume2,sun:Sun,moon:Moon,graph:GitGraph,mic:Mic,stop:Square,eye:Eye,collapse:PanelLeftClose,expand:PanelLeftOpen,close:X,approve:CheckCheck,changes:MessageSquareWarning,bookmark:Bookmark,saved:BookmarkCheck,refresh:RefreshCw,plus:Plus,send:ArrowUp,external:ArrowUpRight,columns:Columns2,user:UserRound,more:Ellipsis,merged:GitMerge,closed:GitPullRequestClosed})[name]||File,{'aria-hidden':'true',width:15,height:15,'stroke-width':1.6}).outerHTML}
export function fileIcon(path){return icon(/\.json$/.test(path)?'json':/\.(md|txt|rst)$/.test(path)?'text':/\.(ts|tsx|js|jsx|py|go|rs|java|css|html|sql|yml|yaml)$/.test(path)?'code':'file')}
const darkHighlight=syntaxHighlighting(HighlightStyle.define([{tag:tags.keyword,color:'#c4a7e7'},{tag:[tags.string,tags.special(tags.string)],color:'#a3d5b0'},{tag:tags.comment,color:'#919baa',fontStyle:'italic'},{tag:[tags.number,tags.bool,tags.atom],color:'#e3b38b'},{tag:[tags.typeName,tags.className],color:'#e1c391'},{tag:[tags.function(tags.variableName),tags.definition(tags.variableName)],color:'#9cbff0'},{tag:[tags.propertyName,tags.attributeName],color:'#a8c3df'},{tag:tags.variableName,color:'#d9dfe8'}]));
const darkTheme=EditorView.theme({'&':{backgroundColor:'#20242c',color:'#d9dfe8'},'.cm-content':{caretColor:'#d9dfe8'}},{dark:true});
let editorDark=false;
export function setEditorTheme(dark){editorDark=dark;for(const view of mountedEditors)view.setTheme(dark)}
let wrapEnabled=true;const mountedEditors=new Set();
export function setEditorWrapping(enabled){wrapEnabled=enabled;for(const view of mountedEditors)view.setWrapping(enabled)}
export function mountEditor(parent,{before='',after='',path='',onSelect=()=>{},diff=true,line=1,notes=[],onComment=()=>{},explanation='',blockExplanations=[],onExplain=()=>{},firstLine=1}){
  const language=languageForPath(path)||[];
  const highlight=StateEffect.define();
  const marks=StateField.define({create:()=>Decoration.none,update(value,tr){for(const effect of tr.effects)if(effect.is(highlight))return Decoration.set(effect.value);return value.map(tr.changes)},provide:field=>EditorView.decorations.from(field)});
  const annotate=StateEffect.define();
  const annotations=StateField.define({create:()=>Decoration.none,update(value,tr){for(const effect of tr.effects)if(effect.is(annotate))return effect.value;return value.map(tr.changes)},provide:field=>EditorView.decorations.from(field)});
  class Explanation extends WidgetType{
    constructor(start,end,text,label='AI note'){super();this.start=start;this.end=end;this.text=text;this.label=label}
    toDOM(){
      const block=document.createElement('div');block.className='ai-code-note-block';const box=document.createElement('div');box.className='ai-code-note';
      const ask=document.createElement('button');ask.type='button';ask.className='ai-code-note-ask';ask.setAttribute('aria-label','Ask about this change: '+this.text);
      const label=document.createElement('span');label.className='ai-code-note-label';label.textContent=this.label;const text=document.createElement('span');text.className='ai-code-note-text';text.textContent=this.text;ask.append(label,text);
      box.onclick=event=>{const bounds=box.getBoundingClientRect();onExplain({start:this.start,end:this.end,text:view.state.doc.sliceString(view.state.doc.line(this.start).from,view.state.doc.line(this.end).to),explanation:this.text,x:event.clientX||bounds.left,y:event.clientY||bounds.bottom})};
      const speaker=document.createElement('button');speaker.type='button';speaker.className='ai-note-speak';speaker.innerHTML=icon('speaker');speaker.setAttribute('aria-label','Read note aloud · AI-generated voice');speaker.setAttribute('aria-pressed','false');speaker.title='Read note aloud · AI-generated voice';
      speaker.disabled=typeof Audio==='undefined';if(speaker.disabled)speaker.title='Read aloud is unavailable in this browser';
      speaker.onclick=event=>{event.stopPropagation();readNote(this.text,speaker)};box.append(ask,speaker);block.append(box);return block;
    }
    ignoreEvent(){return true}
  }
  let anchor=null, range=null;
  const lineAt=(view,event)=>{const pos=view.posAtCoords({x:event.clientX,y:event.clientY});return pos===null?null:view.state.doc.lineAt(pos).number};
  const select=(view,end)=>{range={start:Math.min(anchor,end),end:Math.max(anchor,end)};const decorations=[];for(let n=range.start;n<=range.end;n++)decorations.push(Decoration.line({class:'cm-question-line'}).range(view.state.doc.line(n).from));view.dispatch({effects:highlight.of(decorations)})};
  const pointer=EditorView.domEventHandlers({
    mousedown(event,view){if(event.button!==0||event.target.closest('.cm-deletedChunk,.ai-code-note-block,.diff-context-gap,.cm-foldPlaceholder,.cm-foldGutter'))return false;const n=lineAt(view,event);if(!n)return false;anchor=n;select(view,n);event.preventDefault();return true},
    mousemove(event,view){if(anchor!==null){const n=lineAt(view,event);if(n)select(view,n)}},
  });
  const wrapping=new Compartment(),theme=new Compartment();
  const view=new EditorView({parent,state:EditorState.create({doc:after,extensions:[basicSetup,...(firstLine>1?[lineNumbers({formatNumber:n=>String(n+firstLine-1)})]:[]),theme.of(editorDark?[darkTheme,darkHighlight]:[]),wrapping.of(wrapEnabled?EditorView.lineWrapping:[]),marks,annotations,contextField,pointer,language,EditorView.contentAttributes.of({'aria-label':path+' source editor'}),EditorState.readOnly.of(true),EditorView.editable.of(false),...(diff?[unifiedMergeView({original:before,mergeControls:false,highlightChanges:true,gutter:true,allowInlineDiffs:false,syntaxHighlightDeletions:true})]:[]),EditorView.theme({'&':{height:'100%',fontSize:'12px'},'.cm-scroller':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'20px',overflow:'auto'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{background:'#fafaf9',color:'#aaa4b1',borderRight:'1px solid #f0edf3'},'.cm-line':{padding:'0 12px'},'.cm-changedLine':{background:'#f1f8f3'},'.cm-deletedChunk':{background:'#fcf2f1'},'.cm-deletedText':{textDecoration:'none'},'.cm-insertedLine':{textDecoration:'none'},'.cm-insertedText':{textDecoration:'none'},'&.cm-merge-b .cm-changedText':{background:'transparent'},'.cm-line:hover':{backgroundColor:'rgba(151,123,187,.035)'},'.cm-question-line':{backgroundColor:'rgba(151,123,187,.10) !important'},'.cm-selectionBackground':{background:'rgba(151,123,187,.10) !important'},'&.cm-focused':{outline:'none'}})]})});
  if((explanation||blockExplanations.length)&&diff){const chunks=getChunks(view.state)?.chunks||[];const positions=new Set();const widgets=[];for(const chunk of chunks){const pos=Math.min(chunk.fromB,view.state.doc.length);const start=view.state.doc.lineAt(pos).number,end=view.state.doc.lineAt(Math.min(Math.max(pos,chunk.toB-1),view.state.doc.length)).number;const from=view.state.doc.line(start).from;if(positions.has(from))continue;positions.add(from);const notes=blockExplanations.filter(n=>n.from<Math.max(chunk.toB,chunk.fromB+1)&&n.to>=chunk.fromB);const text=notes.length?[...new Set(notes.map(n=>n.text))].join(' '):explanation;if(!text)continue;widgets.push(Decoration.widget({widget:new Explanation(start,end,text,notes.length&&notes.every(n=>n.label==='Change note')?'Change note':'AI note'),block:true,side:-1}).range(from))}view.dispatch({effects:annotate.of(Decoration.set(widgets,true))})}
  if(diff)collapseContext(view,getChunks(view.state)?.chunks);
  view.setTheme=dark=>view.dispatch({effects:theme.reconfigure(dark?[darkTheme,darkHighlight]:[])});
  view.setWrapping=enabled=>view.dispatch({effects:wrapping.reconfigure(enabled?EditorView.lineWrapping:[])});mountedEditors.add(view);
  const measureNotes=()=>view.requestMeasure({read:()=>Math.max(80,view.scrollDOM.clientWidth-(view.dom.querySelector('.cm-gutters')?.getBoundingClientRect().width||0)),write:width=>{if(view.dom.style.getPropertyValue('--review-note-width')!==width+'px'){view.dom.style.setProperty('--review-note-width',width+'px');view.requestMeasure()}}});
  const noteObserver=new ResizeObserver(measureNotes);noteObserver.observe(view.dom);measureNotes();
  const finish=event=>{if(anchor===null)return;anchor=null;const start=view.state.doc.line(range.start).from,end=view.state.doc.line(range.end).to;onSelect({...range,text:view.state.sliceDoc(start,end),x:event.clientX,y:event.clientY})};
  view.sourcePath=path;
  view.sourceRange=(start,end=start)=>{
   const first=start-firstLine+1,last=end-firstLine+1;if(first<1||first>view.state.doc.lines)return null;
   const a=view.coordsAtPos(view.state.doc.line(first).from),b=view.coordsAtPos(view.state.doc.line(Math.min(last,view.state.doc.lines)).from);if(!a)return null;
   const bounds=view.scrollDOM.getBoundingClientRect();if(a.top>bounds.bottom||(b||a).bottom<bounds.top)return null;
   return {left:bounds.left+3,right:bounds.right-3,top:Math.max(bounds.top,a.top),bottom:Math.min(bounds.bottom,(b||a).bottom)};
  };
  let flashTimer;
  const revealRange=(start,end)=>{const effects=[];foldedRanges(view.state).between(0,view.state.doc.length,(from,to)=>{if(from<=view.state.doc.line(Math.min(end,view.state.doc.lines)).to&&to>=view.state.doc.line(Math.max(1,start)).from)effects.push(unfoldEffect.of({from,to}))});if(effects.length)view.dispatch({effects})};
  view.flashRange=(start,end)=>{revealRange(start,end);clearTimeout(flashTimer);const decorations=[];for(let n=Math.max(1,start);n<=Math.min(end,view.state.doc.lines);n++)decorations.push(Decoration.line({class:'voice-code-flash'}).range(view.state.doc.line(n).from));view.dispatch({effects:highlight.of(decorations)});flashTimer=setTimeout(()=>{if(!view.destroyed)view.dispatch({effects:highlight.of([])})},2200)};
  view.clearQuestionSelection=()=>{anchor=null;range=null;view.dispatch({effects:highlight.of([])})};
  document.addEventListener('mouseup',finish);
  const destroy=view.destroy.bind(view);view.destroy=()=>{clearTimeout(flashTimer);stopNoteSpeech(view.dom);noteObserver.disconnect();mountedEditors.delete(view);document.removeEventListener('mouseup',finish);destroy()};
  if(diff)import(/* @vite-ignore */ new URL('/source-index.js',location.href).href).then(async({initCallParsers,buildCallIndex})=>{await initCallParsers();if(view.destroyed)return;const blocks=buildCallIndex(new Map([[path,after]])).blocks;view.dispatch({effects:StateEffect.appendConfig.of(foldService.of((state,start)=>{const n=state.doc.lineAt(start).number,block=blocks.filter(b=>b.start===n&&b.end>b.start+1).sort((a,b)=>a.end-b.end)[0];return block?{from:state.doc.line(n).to,to:state.doc.line(Math.min(block.end-1,state.doc.lines)).to}:null}))});const ranges=defaultFunctionFolds(view.state.doc,blocks,getChunks(view.state)?.chunks||[]);if(ranges.length){collapseContext(view,getChunks(view.state)?.chunks,ranges);view.dispatch({effects:ranges.map(r=>foldEffect.of(r))})}}).catch(()=>{});
  requestAnimationFrame(()=>{const changes=diff?getChunks(view.state)?.chunks:[];const pos=changes?.[0]?.fromB??view.state.doc.line(Math.min(line,view.state.doc.lines)).from;view.dispatch({effects:EditorView.scrollIntoView(Math.min(pos,view.state.doc.length),{y:'start',yMargin:60})})});return view;
}

export {stopNoteSpeech} from './note-speech.js';
