import {StateField,StateEffect} from '@codemirror/state';
import {Decoration,EditorView,WidgetType} from '@codemirror/view';
export function hiddenContext(doc,chunks,margin=3){
 const ranges=[];let previous=1;
 for(let i=0;i<=chunks.length;i++){
  const chunk=chunks[i],start=i?previous+margin:1,end=chunk?doc.lineAt(Math.min(chunk.fromB,doc.length)).number-1-margin:doc.lines;
  if(end-start+1>=4)ranges.push({start,end});
  if(chunk)previous=doc.lineAt(Math.min(chunk.toB,doc.length)).number;
 }
 return ranges;
}
const setRanges=StateEffect.define();
class ContextGap extends WidgetType{
 constructor(start,end){super();this.start=start;this.end=end}
 eq(other){return this.start===other.start&&this.end===other.end}
 toDOM(view){
  const box=document.createElement('div');box.className='diff-context-gap';
  const label=document.createElement('span');label.textContent=`${this.end-this.start+1} unchanged lines`;box.append(label);
  const expand=(direction)=>{
   const ranges=view.state.field(contextField).ranges.flatMap(range=>{
    if(range.start!==this.start)return [range];
    const next=direction==='up'?{start:range.start,end:range.end-20}:direction==='down'?{start:range.start+20,end:range.end}:null;
    return next&&next.start<=next.end?[next]:[];
   });view.dispatch({effects:setRanges.of(ranges)});
  };
  for(const [direction,title,text]of [['up','Expand 20 lines upward','↑'],['down','Expand 20 lines downward','↓'],['all','Show all unchanged lines','Show all']]){
   if(direction==='up'&&this.end===view.state.doc.lines||direction==='down'&&this.start===1)continue;
   const button=document.createElement('button');button.type='button';button.title=title;button.setAttribute('aria-label',title);button.textContent=text;button.onclick=event=>{event.stopPropagation();expand(direction)};box.append(button);
  }
  return box;
 }
 ignoreEvent(){return true}
 get estimatedHeight(){return 30}
}
export const contextField=StateField.define({
 create:()=>({ranges:[],decorations:Decoration.none}),
 update(value,tr){for(const effect of tr.effects)if(effect.is(setRanges)){
  const ranges=effect.value;return {ranges,decorations:Decoration.set(ranges.map(({start,end})=>Decoration.replace({widget:new ContextGap(start,end),block:true}).range(tr.state.doc.line(start).from,tr.state.doc.line(end).to)),true)};
 }return value},
 provide:field=>EditorView.decorations.from(field,value=>value.decorations)
});
export function collapseContext(view,chunks){if(chunks?.length)view.dispatch({effects:setRanges.of(hiddenContext(view.state.doc,chunks))})}
