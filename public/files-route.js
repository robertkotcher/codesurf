export function repositoryFilesURL(pr,path,side='head'){
 const source=new URL(pr.url);
 if(source.origin!=='https://github.com'||!/^\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\/?$/.test(source.pathname))throw new Error('Invalid pull request URL');
 const query=new URLSearchParams({path});if(pr.head)query.set('head',pr.head);if(side==='base')query.set('side','base');
 return '/files/github'+source.pathname.replace(/\/$/,'')+'?'+query;
}
export function reviewFileURL(pr,path){
 const file=pr.files?.find(file=>file.path===path||file.previousPath===path);
 return repositoryFilesURL(pr,file?.path||path,file?.status==='removed'?'base':'head');
}
