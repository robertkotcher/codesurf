export async function readChatStream(response,onEvent){
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'The answer could not be started.')}
 if(!response.body)throw new Error('The answer stream is unavailable.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=false;
 const consume=raw=>{const lines=raw.split('\n'),name=lines.find(line=>line.startsWith('event:'))?.slice(6).trim(),data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;let body;try{body=JSON.parse(data)}catch{throw new Error('The answer stream could not be read. Please retry.')}if(name==='error')throw new Error(body.message||'The answer could not be completed.');if(name==='done')complete=true;onEvent(name,body)};
 try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+2)}if(buffer.length>1000000)throw new Error('The answer stream is too large.');if(done)break}if(buffer.trim())consume(buffer);if(!complete)throw new Error('The answer ended early. Please retry.')}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
