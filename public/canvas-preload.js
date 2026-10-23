export function canvasConnectionKey(selection){return JSON.stringify([selection.anchorId,selection.path,selection.line,selection.direction,selection.snapshot,selection.level,...selection.column===undefined?[]:[selection.column]])}
export function preparedCanvasPage(prepared,selection,page=0){
 const connection=prepared?.connections.find(item=>item.key===canvasConnectionKey(selection));if(!connection)return null;
 const offset=page*24;
 return {relations:connection.targets.slice(offset,offset+24).map(target=>({...prepared.nodes[target.id],edges:target.edges})),total:connection.total,nextPage:offset+24<connection.total?page+1:null,excludedFiles:prepared.excludedFiles||0};
}
