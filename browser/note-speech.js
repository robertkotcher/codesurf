let active=null;
function reset(record){record.button.setAttribute('aria-pressed','false');record.button.setAttribute('aria-label','Read note aloud');record.button.title='Read note aloud';record.button.classList.remove('is-speaking')}
export function stopNoteSpeech(root){
 if(!active||root&&!root.contains(active.button))return;
 const previous=active;active=null;reset(previous);window.speechSynthesis.cancel();
}
export function readNote(text,button){
 if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;
 const same=active?.button===button;stopNoteSpeech();if(same)return;
 const utterance=new SpeechSynthesisUtterance(text.replace(/`/g,''));utterance.lang=document.documentElement.lang||'en';utterance.rate=.95;
 const record={button,utterance};active=record;button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','Stop reading note');button.title='Stop reading note';button.classList.add('is-speaking');
 const finish=()=>{if(active===record){active=null;reset(record)}};utterance.onend=finish;utterance.onerror=finish;
 try{window.speechSynthesis.speak(utterance)}catch{finish()}
}
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>stopNoteSpeech());
