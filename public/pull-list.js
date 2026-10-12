export function groupPullRequests(items,{query='',cutoff=0,includeOlder=false}={}){
 const groups=new Map(),search=query.trim().toLowerCase();
 for(const item of items){
  if(!includeOlder&&Date.parse(item.updated)<cutoff)continue;
  if(search&&!`${item.repo} ${item.title} #${item.number} ${item.author||''}`.toLowerCase().includes(search))continue;
  if(!groups.has(item.repo))groups.set(item.repo,[]);groups.get(item.repo).push(item);
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([repo,items])=>({repo,items:items.sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated)||b.number-a.number)}));
}
