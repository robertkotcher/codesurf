import {EditorView,basicSetup} from 'codemirror';
import {Decoration,WidgetType} from '@codemirror/view';
import {RangeSet} from '@codemirror/state';
import {EditorState,StateField,StateEffect,Compartment} from '@codemirror/state';
import {unifiedMergeView,getChunks} from '@codemirror/merge';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {json} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {sql} from '@codemirror/lang-sql';
import {createElement,File,FileCode,FileJson,FileText,Folder,FolderOpen,ChevronRight,ChevronDown,MessageCircle,MessagesSquare,GitPullRequest,WrapText} from 'lucide';
export function icon(name){return createElement(({file:File,code:FileCode,json:FileJson,text:FileText,folder:Folder,open:FolderOpen,right:ChevronRight,down:ChevronDown,comment:MessageCircle,chat:MessagesSquare,pulls:GitPullRequest,wrap:WrapText})[name]||File,{'aria-hidden':'true',width:15,height:15,'stroke-width':1.6}).outerHTML}
export function fileIcon(path){return icon(/\.json$/.test(path)?'json':/\.(md|txt|rst)$/.test(path)?'text':/\.(ts|tsx|js|jsx|py|go|rs|java|css|html|sql|yml|yaml)$/.test(path)?'code':'file')}
let wrapEnabled=true;const mountedEditors=new Set();
export function setEditorWrapping(enabled){wrapEnabled=enabled;for(const view of mountedEditors)view.setWrapping(enabled)}
export function mountEditor(parent,{before='',after='',path='',onSelect=()=>{},diff=true,line=1,notes=[],onComment=()=>{},explanation='',onExplain=()=>{}}){
  const language=/\.[cm]?[jt]sx?$/.test(path)?javascript({typescript:/tsx?$/.test(path),jsx:/[jt]sx$/.test(path)}):/\.py$/.test(path)?python():/\.json$/.test(path)?json():/\.html?$/.test(path)?html():/\.css$/.test(path)?css():/\.sql$/.test(path)?sql():[];
  const highlight=StateEffect.define();
  const marks=StateField.define({create:()=>Decoration.none,update(value,tr){for(const effect of tr.effects)if(effect.is(highlight))return Decoration.set(effect.value);return value.map(tr.changes)},provide:field=>EditorView.decorations.from(field)});
  const annotate=StateEffect.define();
  const annotations=StateField.define({create:()=>Decoration.none,update(value,tr){for(const effect of tr.effects)if(effect.is(annotate))return effect.value;return value.map(tr.changes)},provide:field=>EditorView.decorations.from(field)});
  class Explanation extends WidgetType{
    constructor(start,end){super();this.start=start;this.end=end}
    toDOM(){const block=document.createElement('div');block.className='ai-code-note-block';const box=document.createElement('button');box.type='button';box.className='ai-code-note';box.setAttribute('aria-label','Ask about AI note: '+explanation);const label=document.createElement('span');label.className='ai-code-note-label';label.textContent='AI note';const text=document.createElement('span');text.className='ai-code-note-text';text.textContent=explanation;box.onclick=event=>{const bounds=box.getBoundingClientRect();onExplain({start:this.start,end:this.end,text:view.state.doc.sliceString(view.state.doc.line(this.start).from,view.state.doc.line(this.end).to),explanation,x:event.clientX||bounds.left,y:event.clientY||bounds.bottom})};box.append(label,text);block.append(box);return block}
    ignoreEvent(){return true}
  }
  let anchor=null, range=null;
  const lineAt=(view,event)=>{const pos=view.posAtCoords({x:event.clientX,y:event.clientY});return pos===null?null:view.state.doc.lineAt(pos).number};
  const select=(view,end)=>{range={start:Math.min(anchor,end),end:Math.max(anchor,end)};const decorations=[];for(let n=range.start;n<=range.end;n++)decorations.push(Decoration.line({class:'cm-question-line'}).range(view.state.doc.line(n).from));view.dispatch({effects:highlight.of(decorations)})};
  const pointer=EditorView.domEventHandlers({
    mousedown(event,view){if(event.button!==0||event.target.closest('.cm-deletedChunk,.ai-code-note-block'))return false;const n=lineAt(view,event);if(!n)return false;anchor=n;select(view,n);event.preventDefault();return true},
    mousemove(event,view){if(anchor!==null){const n=lineAt(view,event);if(n)select(view,n)}},
  });
  const wrapping=new Compartment();
  const view=new EditorView({parent,state:EditorState.create({doc:after,extensions:[basicSetup,wrapping.of(wrapEnabled?EditorView.lineWrapping:[]),marks,annotations,pointer,language,EditorView.contentAttributes.of({'aria-label':path+' source editor'}),EditorState.readOnly.of(true),EditorView.editable.of(false),...(diff?[unifiedMergeView({original:before,mergeControls:false,highlightChanges:true,gutter:true,allowInlineDiffs:false,syntaxHighlightDeletions:true})]:[]),EditorView.theme({'&':{height:'100%',fontSize:'12px'},'.cm-scroller':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'20px',overflow:'auto'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{background:'#fafaf9',color:'#aaa4b1',borderRight:'1px solid #f0edf3'},'.cm-line':{padding:'0 12px'},'.cm-changedLine':{background:'#f1f8f3'},'.cm-deletedChunk':{background:'#fcf2f1'},'.cm-deletedText':{textDecoration:'none'},'.cm-insertedLine':{textDecoration:'none'},'.cm-insertedText':{textDecoration:'none'},'&.cm-merge-b .cm-changedText':{background:'transparent'},'.cm-line:hover':{backgroundColor:'rgba(151,123,187,.035)'},'.cm-question-line':{backgroundColor:'rgba(151,123,187,.10) !important'},'.cm-selectionBackground':{background:'rgba(151,123,187,.10) !important'},'&.cm-focused':{outline:'none'}})]})});
  if(explanation&&diff){const chunks=getChunks(view.state)?.chunks||[];const positions=new Set();const widgets=[];for(const chunk of chunks){const pos=Math.min(chunk.fromB,view.state.doc.length);const start=view.state.doc.lineAt(pos).number,end=view.state.doc.lineAt(Math.min(Math.max(pos,chunk.toB-1),view.state.doc.length)).number;const from=view.state.doc.line(start).from;if(positions.has(from))continue;positions.add(from);widgets.push(Decoration.widget({widget:new Explanation(start,end),block:true,side:-1}).range(from))}view.dispatch({effects:annotate.of(Decoration.set(widgets,true))})}
  view.setWrapping=enabled=>view.dispatch({effects:wrapping.reconfigure(enabled?EditorView.lineWrapping:[])});mountedEditors.add(view);
  const measureNotes=()=>view.requestMeasure({read:()=>Math.max(80,view.scrollDOM.clientWidth-(view.dom.querySelector('.cm-gutters')?.getBoundingClientRect().width||0)),write:width=>{if(view.dom.style.getPropertyValue('--review-note-width')!==width+'px'){view.dom.style.setProperty('--review-note-width',width+'px');view.requestMeasure()}}});
  const noteObserver=new ResizeObserver(measureNotes);noteObserver.observe(view.dom);measureNotes();
  const finish=event=>{if(anchor===null)return;anchor=null;const start=view.state.doc.line(range.start).from,end=view.state.doc.line(range.end).to;onSelect({...range,text:view.state.sliceDoc(start,end),x:event.clientX,y:event.clientY})};
  view.clearQuestionSelection=()=>{anchor=null;range=null;view.dispatch({effects:highlight.of([])})};
  document.addEventListener('mouseup',finish);
  const destroy=view.destroy.bind(view);view.destroy=()=>{noteObserver.disconnect();mountedEditors.delete(view);document.removeEventListener('mouseup',finish);destroy()};
  requestAnimationFrame(()=>{const changes=diff?getChunks(view.state)?.chunks:[];const pos=changes?.[0]?.fromB??view.state.doc.line(Math.min(line,view.state.doc.lines)).from;view.dispatch({effects:EditorView.scrollIntoView(Math.min(pos,view.state.doc.length),{y:'start',yMargin:60})})});return view;
}
