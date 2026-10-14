const join=values=>values.length<3?values.join(' and '):values.slice(0,-1).join(', ')+', and '+values.at(-1);
const atLines=edges=>{const lines=[...new Set(edges.map(edge=>edge.callLine))].sort((a,b)=>a-b);return `${lines.length===1?'line':'lines'} ${join(lines)}`};
export function relationshipSummary(node){
 const edges=node.edges||[],possible=node.ambiguous||node.precision==='heuristic',calls=possible?'may call':'calls';
 if(node.direction==='callers'){const targets=[...new Set(edges.map(edge=>edge.targetSymbol).filter(Boolean))];return `${node.symbol} ${calls} ${targets.length?join(targets):'the enclosing function'}${edges.length?' at '+atLines(edges):''}.`}
 const direct=edges.filter(edge=>edge.scope==='change');
 if(direct.length)return `This edited block ${calls} ${node.symbol} at ${atLines(direct)}${edges.some(edge=>edge.scope==='function')?', which is also called elsewhere in the enclosing function':''}.`;
 const sources=[...new Set(edges.map(edge=>edge.sourceSymbol).filter(Boolean))],where=sources.length===1?sources[0]:sources.length?'the enclosing functions':'the enclosing function';
 return `Elsewhere in ${where}, ${edges.length?atLines(edges):'code outside this edited block'} ${possible?'may call':new Set(edges.map(edge=>edge.callLine)).size>1?'call':'calls'} ${node.symbol}.`;
}
