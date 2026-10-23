export function mergeVariableBindings(...lists){
 const bindings=new Map();
 for(const binding of lists.flatMap(list=>list||[])){
  const prior=bindings.get(binding.id),occurrences=[...new Map([...(prior?.occurrences||[]),...binding.occurrences].map(token=>[JSON.stringify([token.line,token.column,token.endColumn]),token])).values()];
  bindings.set(binding.id,{...binding,occurrences});
 }
 return [...bindings.values()];
}
