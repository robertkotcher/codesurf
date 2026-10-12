export function sortSavedPulls(items,query=''){
 const q=query.trim().toLowerCase();
 return items.filter(p=>!q||[p.repo,p.title,p.number,p.author,p.status,p.draft?'draft':''].join(' ').toLowerCase().includes(q)).slice().sort((a,b)=>Number(a.status==='merged')-Number(b.status==='merged')||Number(a.status==='closed')-Number(b.status==='closed')||String(b.updated).localeCompare(String(a.updated))||String(b.savedAt).localeCompare(String(a.savedAt))||a.url.localeCompare(b.url));
}
