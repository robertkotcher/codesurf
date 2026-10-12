import {pool} from './database.js';
import {parsePR} from './lib.js';
const database=()=>{if(!pool)throw Object.assign(new Error('Saved pull request storage is not configured.'),{status:503});return pool};
export function savedURL(input){let p;try{p=parsePR(input)}catch(error){throw Object.assign(error,{status:400})};if(!Number.isSafeInteger(p.number)||p.number<1)throw Object.assign(new Error('Enter a valid pull request number.'),{status:400});return `https://github.com/${p.owner.toLowerCase()}/${p.repo.toLowerCase()}/pull/${p.number}`}
export const savedPull=row=>({url:row.pr_url,repo:row.repo,number:row.number,title:row.title,author:row.author,status:row.status,draft:row.draft,updated:row.pr_updated_at,savedAt:row.saved_at,checkedAt:row.checked_at});
export function pullMetadata(pr){return {url:savedURL(pr.html_url),repo:pr.base.repo.full_name,number:pr.number,title:pr.title,author:pr.user?.login||'',status:pr.merged_at||pr.merged?'merged':pr.state==='closed'?'closed':'open',draft:!!pr.draft,updated:pr.updated_at}}
export async function listSavedPulls(owner){return (await database().query('SELECT * FROM saved_pull_requests WHERE owner=$1 ORDER BY saved_at DESC',[owner.toLowerCase()])).rows.map(savedPull)}
export async function savePull(owner,pr){
 const p=pullMetadata(pr);
 const values=[owner.toLowerCase(),p.url,p.repo,p.number,p.title,p.author,p.status,p.draft,p.updated];
 return savedPull((await database().query(`INSERT INTO saved_pull_requests(owner,pr_url,repo,number,title,author,status,draft,pr_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
 ON CONFLICT(owner,pr_url) DO UPDATE SET repo=EXCLUDED.repo,number=EXCLUDED.number,title=EXCLUDED.title,author=EXCLUDED.author,status=EXCLUDED.status,draft=EXCLUDED.draft,pr_updated_at=EXCLUDED.pr_updated_at,checked_at=now() RETURNING *`,values)).rows[0]);
}
export async function refreshSavedPull(owner,url,pr){
 const p=pullMetadata(pr);
 // Updating only existing saves prevents an in-flight refresh from undoing removal.
 const row=(await database().query('UPDATE saved_pull_requests SET repo=$3,number=$4,title=$5,author=$6,status=$7,draft=$8,pr_updated_at=$9,checked_at=now() WHERE owner=$1 AND pr_url=$2 RETURNING *',[owner.toLowerCase(),savedURL(url),p.repo,p.number,p.title,p.author,p.status,p.draft,p.updated])).rows[0];
 return row?savedPull(row):null;
}
export async function removeSavedPull(owner,url){await database().query('DELETE FROM saved_pull_requests WHERE owner=$1 AND pr_url=$2',[owner.toLowerCase(),savedURL(url)])}
