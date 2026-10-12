const version='marin-gpt4o-mini-tts-v1',memory=new Map(),pending=new Map();let active=null;
const label='Read note aloud · AI-generated voice';
function reset(record){record.button.setAttribute('aria-pressed','false');record.button.setAttribute('aria-label',label);record.button.title=label;record.button.removeAttribute('aria-busy');record.button.classList.remove('is-speaking','is-loading');if(record.url){URL.revokeObjectURL(record.url);record.url=null}}
export function stopNoteSpeech(root){
 if(!active||root&&!root.contains(active.button))return;
 const previous=active;active=null;previous.audio?.pause();reset(previous);
}
async function recording(text){
 const account=document.body.dataset.account||'default';
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(version+'\n'+text));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const name='codesurf-note-audio-'+encodeURIComponent(account),key=location.origin+'/__note_audio/'+version+'/'+hash,memoryKey=name+key;
 if(memory.has(memoryKey))return memory.get(memoryKey);
 if(pending.has(memoryKey))return pending.get(memoryKey);
 const promise=(async()=>{
  let cache;try{cache=await caches.open(name);const saved=await cache.match(key);if(saved)return await saved.blob()}catch{}
  const response=await fetch('/api/note-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'Could not generate audio. Try again.')}
  const blob=await response.blob();if(!blob.size||!blob.type.startsWith('audio/'))throw new Error('The recording was empty. Try again.');
  try{await cache?.put(key,new Response(blob,{headers:{'Content-Type':blob.type}}))}catch{}
  return blob;
 })();pending.set(memoryKey,promise);
 try{const blob=await promise;memory.set(memoryKey,blob);if(memory.size>64)memory.delete(memory.keys().next().value);return blob}finally{pending.delete(memoryKey)}
}
export async function readNote(text,button){
 const same=active?.button===button;stopNoteSpeech();if(same)return;
 const record={button,audio:new Audio(),url:null};active=record;button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','Stop reading note');button.title='Preparing AI voice… Click to cancel';button.setAttribute('aria-busy','true');button.classList.add('is-loading');
 const finish=()=>{if(active===record){active=null;reset(record)}};record.audio.onended=finish;
 const fail=error=>{if(active!==record)return;finish();const message=error?.message||'Could not play audio. Click to try again.';button.title=message;button.dispatchEvent(new CustomEvent('note-audio-error',{bubbles:true,detail:message}))};record.audio.onerror=()=>fail(new Error('Could not play audio. Click to try again.'));
 try{
  const blob=await recording(text.replace(/`/g,'').trim());if(active!==record)return;
  record.url=URL.createObjectURL(blob);record.audio.src=record.url;await record.audio.play();if(active!==record){record.audio.pause();return}
  button.removeAttribute('aria-busy');button.classList.remove('is-loading');button.classList.add('is-speaking');button.title='Stop reading · AI-generated voice';
 }catch(error){fail(error)}
}
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>stopNoteSpeech());
