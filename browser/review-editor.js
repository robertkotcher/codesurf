import {EditorView,basicSetup} from 'codemirror';
import {Decoration} from '@codemirror/view';
import {RangeSet} from '@codemirror/state';
import {EditorState,StateField,StateEffect} from '@codemirror/state';
import {unifiedMergeView,getChunks} from '@codemirror/merge';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {json} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {sql} from '@codemirror/lang-sql';
import {createElement,File,FileCode,FileJson,FileText,Folder,FolderOpen,ChevronRight,ChevronDown,MessageCircle,MessagesSquare,GitPullRequest} from 'lucide';
export function icon(name){return createElement(({file:File,code:FileCode,json:FileJson,text:FileText,folder:Folder,open:FolderOpen,right:ChevronRight,down:ChevronDown,comment:MessageCircle,chat:MessagesSquare,pulls:GitPullRequest})[name]||File,{'aria-hidden':'true',width:15,height:15,'stroke-width':1.6}).outerHTML}
export function fileIcon(path){return icon(/\.json$/.test(path)?'json':/\.(md|txt|rst)$/.test(path)?'text':/\.(ts|tsx|js|jsx|py|go|rs|java|css|html|sql|yml|yaml)$/.test(path)?'code':'file')}
export function mountEditor(parent,{before='',after='',path='',onSelect=()=>{},diff=true,line=1,notes=[],onComment=()=>{}}){
  const language=/\.[cm]?[jt]sx?$/.test(path)?javascript({typescript:/tsx?$/.test(path),jsx:/[jt]sx$/.test(path)}):/\.py$/.test(path)?python():/\.json$/.test(path)?json():/\.html?$/.test(path)?html():/\.css$/.test(path)?css():/\.sql$/.test(path)?sql():[];
  const highlight=StateEffect.define();
  const marks=StateField.define({create:()=>Decoration.none,update(value,tr){for(const effect of tr.effects)if(effect.is(highlight))return Decoration.set(effect.value);return value.map(tr.changes)},provide:field=>EditorView.decorations.from(field)});
  let anchor=null, range=null;
  const lineAt=(view,event)=>{const pos=view.posAtCoords({x:event.clientX,y:event.clientY});return pos===null?null:view.state.doc.lineAt(pos).number};
  const select=(view,end)=>{range={start:Math.min(anchor,end),end:Math.max(anchor,end)};const decorations=[];for(let n=range.start;n<=range.end;n++)decorations.push(Decoration.line({class:'cm-question-line'}).range(view.state.doc.line(n).from));view.dispatch({effects:highlight.of(decorations)})};
  const pointer=EditorView.domEventHandlers({
    mousedown(event,view){if(event.button!==0||event.target.closest('.cm-deletedChunk'))return false;const n=lineAt(view,event);if(!n)return false;anchor=n;select(view,n);event.preventDefault();return true},
    mousemove(event,view){if(anchor!==null){const n=lineAt(view,event);if(n)select(view,n)}},
  });
  const view=new EditorView({parent,state:EditorState.create({doc:after,extensions:[basicSetup,marks,pointer,language,EditorView.contentAttributes.of({'aria-label':path+' source editor'}),EditorState.readOnly.of(true),EditorView.editable.of(false),...(diff?[unifiedMergeView({original:before,mergeControls:false,highlightChanges:true,gutter:true,allowInlineDiffs:false,syntaxHighlightDeletions:true})]:[]),EditorView.theme({'&':{height:'100%',fontSize:'12px'},'.cm-scroller':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'20px',overflow:'auto'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{background:'#fafaf9',color:'#aaa4b1',borderRight:'1px solid #f0edf3'},'.cm-line':{padding:'0 12px'},'.cm-changedLine':{background:'#f1f8f3'},'.cm-deletedChunk':{background:'#fcf2f1'},'.cm-deletedText':{textDecoration:'none'},'.cm-insertedLine':{textDecoration:'none'},'.cm-insertedText':{textDecoration:'none'},'&.cm-merge-b .cm-changedText':{background:'transparent'},'.cm-line:hover':{backgroundColor:'rgba(151,123,187,.035)'},'.cm-question-line':{backgroundColor:'rgba(151,123,187,.10) !important'},'.cm-selectionBackground':{background:'rgba(151,123,187,.10) !important'},'&.cm-focused':{outline:'none'}})]})});
  const finish=event=>{if(anchor===null)return;anchor=null;const start=view.state.doc.line(range.start).from,end=view.state.doc.line(range.end).to;onSelect({...range,text:view.state.sliceDoc(start,end),x:event.clientX,y:event.clientY})};
  view.clearQuestionSelection=()=>{anchor=null;range=null;view.dispatch({effects:highlight.of([])})};
  document.addEventListener('mouseup',finish);
  const destroy=view.destroy.bind(view);view.destroy=()=>{document.removeEventListener('mouseup',finish);destroy()};
  requestAnimationFrame(()=>{const changes=diff?getChunks(view.state)?.chunks:[];const pos=changes?.[0]?.fromB??view.state.doc.line(Math.min(line,view.state.doc.lines)).from;view.dispatch({effects:EditorView.scrollIntoView(Math.min(pos,view.state.doc.length),{y:'start',yMargin:60})})});return view;
}
