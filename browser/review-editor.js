import {EditorView,basicSetup} from 'codemirror';
import {gutter,GutterMarker} from '@codemirror/view';
import {RangeSet} from '@codemirror/state';
import {EditorState} from '@codemirror/state';
import {unifiedMergeView,getChunks} from '@codemirror/merge';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {json} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {sql} from '@codemirror/lang-sql';
import {createElement,File,FileCode,FileJson,FileText,Folder,FolderOpen,ChevronRight,ChevronDown,MessageCircle} from 'lucide';
export function icon(name){return createElement(({file:File,code:FileCode,json:FileJson,text:FileText,folder:Folder,open:FolderOpen,right:ChevronRight,down:ChevronDown,comment:MessageCircle})[name]||File,{'aria-hidden':'true',width:15,height:15,'stroke-width':1.6}).outerHTML}
export function fileIcon(path){return icon(/\.json$/.test(path)?'json':/\.(md|txt|rst)$/.test(path)?'text':/\.(ts|tsx|js|jsx|py|go|rs|java|css|html|sql|yml|yaml)$/.test(path)?'code':'file')}
export function mountEditor(parent,{before='',after='',path='',onSelect=()=>{},diff=true,line=1,notes=[],onComment=()=>{}}){
  const language=/\.[cm]?[jt]sx?$/.test(path)?javascript({typescript:/tsx?$/.test(path),jsx:/[jt]sx$/.test(path)}):/\.py$/.test(path)?python():/\.json$/.test(path)?json():/\.html?$/.test(path)?html():/\.css$/.test(path)?css():/\.sql$/.test(path)?sql():[];
  class NoteMarker extends GutterMarker {constructor(notes){super();this.notes=notes}toDOM(){const button=document.createElement('button');button.className='line-note';button.innerHTML=icon('comment');button.title=this.notes.map(n=>n.text).join('\n');button.setAttribute('aria-label','Explain line '+this.notes[0].line);button.onclick=()=>onComment(this.notes);return button}}
  const noteGutter=gutter({class:'explanation-gutter',markers:view=>{const grouped=new Map();for(const note of notes){const line=Math.max(1,Math.min(note.line,view.state.doc.lines));if(!grouped.has(line))grouped.set(line,[]);grouped.get(line).push(note)}return RangeSet.of([...grouped].sort((a,b)=>a[0]-b[0]).map(([line,items])=>new NoteMarker(items).range(view.state.doc.line(line).from)))}});
  const view=new EditorView({parent,state:EditorState.create({doc:after,extensions:[basicSetup,noteGutter,language,EditorView.contentAttributes.of({'aria-label':path+' source editor'}),EditorState.readOnly.of(true),EditorView.editable.of(false),...(diff?[unifiedMergeView({original:before,mergeControls:false,highlightChanges:true,gutter:true,allowInlineDiffs:false,syntaxHighlightDeletions:true})]:[]),EditorView.updateListener.of(update=>{if(update.selectionSet){const sel=update.state.selection.main;onSelect({start:update.state.doc.lineAt(sel.from).number,end:update.state.doc.lineAt(sel.to).number,text:update.state.sliceDoc(sel.from,sel.to)})}}),EditorView.theme({'&':{height:'100%',fontSize:'12px'},'.cm-scroller':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'20px',overflow:'auto'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{background:'#fafaf9',color:'#aaa4b1',borderRight:'1px solid #f0edf3'},'.cm-line':{padding:'0 12px'},'.cm-changedLine':{background:'#f1f8f3'},'.cm-deletedChunk':{background:'#fcf2f1'},'.cm-deletedText':{textDecoration:'none'},'.cm-insertedLine':{textDecoration:'none'},'.cm-insertedText':{textDecoration:'none'},'&.cm-merge-b .cm-changedText':{background:'transparent'},'.cm-selectionBackground':{background:'#e8def4 !important'},'&.cm-focused':{outline:'none'}})]})});
  requestAnimationFrame(()=>{const changes=diff?getChunks(view.state)?.chunks:[];const pos=changes?.[0]?.fromB??view.state.doc.line(Math.min(line,view.state.doc.lines)).from;view.dispatch({effects:EditorView.scrollIntoView(Math.min(pos,view.state.doc.length),{y:'start',yMargin:60})})});return view;
}
