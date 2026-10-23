export function reviewLocation(href){
 const query=new URL(href).searchParams,value=query.get('change'),number=/^[1-9]\d{0,5}$/.test(value||'')?Number(value):1;
 const hash=name=>/^[a-f\d]{40,64}$/i.test(query.get(name)||'')?query.get(name):null;
 return {change:number,head:hash('head'),base:hash('base')};
}
export function reviewChangeURL(prURL,change,head,base){
 const url=new URL(prURL);if(url.origin!=='https://github.com'||!/^\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\/?$/.test(url.pathname)||!Number.isSafeInteger(change)||change<1)throw new Error('Invalid review link.');
 const query=new URLSearchParams({change:String(change)});if(head)query.set('head',head);if(base)query.set('base',base);
 return '/github'+url.pathname.replace(/\/$/,'')+'?'+query;
}
