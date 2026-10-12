export function startVoiceChat({request,onState=()=>{},onTranscript=()=>{},onLevel=()=>{},onError=()=>{},onReady=()=>{},onTurn=()=>null,onTool=async()=>({error:'Repository tools unavailable.'})}){
 let toolCount=0,utterance=0,responseActive=false,pendingSpeech=null,toolAbort=new AbortController();let closed=false,peer,stream,channel,audio,analyser,frame,timer,connectTimer,audioContext;const abort=new AbortController();
 const state=value=>{if(!closed)onState(value)};
 const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>stop(),120000)};
 function stop(){if(closed)return;closed=true;abort.abort();toolAbort.abort();clearTimeout(timer);clearTimeout(connectTimer);cancelAnimationFrame(frame);channel?.close();peer?.close();stream?.getTracks().forEach(t=>t.stop());if(audio){audio.pause();audio.srcObject=null;audio.remove()}audioContext?.close().catch(()=>{});onLevel(0);onState('ended')}
 const fail=error=>{if(closed)return;onError(error.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser to use voice chat.':error.message||'Voice chat could not connect.');stop()};
 function send(value){if(!closed&&channel?.readyState==='open')channel.send(JSON.stringify(value))}
 function updateContext(context){if(context)send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'CodeSurf screen context (source data, not a new user request): '+JSON.stringify(context)}]}})}
 function speak(text){if(closed)return;pendingSpeech=text;if(responseActive){send({type:'response.cancel'});send({type:'output_audio_buffer.clear'});return}const question=pendingSpeech;pendingSpeech=null;utterance++;toolCount=0;toolAbort.abort();toolAbort=new AbortController();touch();send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:question}]}});send({type:'response.create'})}
 const ready=(async()=>{try{
  if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw new Error('This browser does not support live voice chat. Use a current browser over HTTPS.');
  state('connecting');connectTimer=setTimeout(()=>fail(new Error('Voice connection timed out. Please retry.')),45000);
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  if(closed){stream.getTracks().forEach(t=>t.stop());return}
  peer=new RTCPeerConnection();audio=document.createElement('audio');audio.autoplay=true;audio.hidden=true;document.body.append(audio);
  peer.ontrack=event=>{if(closed)return;audio.srcObject=event.streams[0]||new MediaStream([event.track]);audio.play().catch(()=>fail(new Error('Your browser blocked voice playback. Allow audio and retry.')))};
  for(const track of stream.getTracks()){peer.addTrack(track,stream);track.onended=stop}
  try{audioContext=new AudioContext();analyser=audioContext.createAnalyser();analyser.fftSize=256;audioContext.createMediaStreamSource(stream).connect(analyser);const samples=new Uint8Array(analyser.fftSize);const measure=()=>{if(closed)return;analyser.getByteTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,n)=>sum+((n-128)/128)**2,0)/samples.length);onLevel(Math.min(1,rms*7));frame=requestAnimationFrame(measure)};measure()}catch{}
  channel=peer.createDataChannel('oai-events');
  channel.onopen=()=>{if(closed)return;clearTimeout(connectTimer);state('listening');touch();onReady()};
  channel.onclose=()=>{if(!closed)stop()};
  channel.onmessage=event=>{if(closed)return;let data;try{data=JSON.parse(event.data)}catch{return}
   if(data.type==='response.created')responseActive=true;
   if(data.type==='response.done'){responseActive=false;if(pendingSpeech){speak(pendingSpeech);return}if(data.response?.status==='failed'){onError('Voice could not finish that answer. Please try a shorter question.');state('listening');return}}
   if(data.type==='response.done'&&data.response?.status==='completed'){
    const calls=(data.response.output||[]).filter(item=>item.type==='function_call');
    if(calls.length){const turn=utterance,signal=toolAbort.signal;state('thinking');touch();(async()=>{
     for(const call of calls){let result;try{if(++toolCount>12)throw new Error('Lookup limit reached. Answer from verified source; explain precisely which requested definition could not be found.');result=await onTool(call.name,JSON.parse(call.arguments),signal)}catch(error){result={error:error.message||'Source lookup failed.'}}
      if(closed)return;channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)}}));
     }
     if(!closed&&turn===utterance)channel.send(JSON.stringify({type:'response.create',...(toolCount>=12?{response:{tools:[],instructions:'Answer the latest user question concisely using only the source already retrieved. Identify any requested definition that could not be found at this PR commit. Do not guess or continue searching.'}}:{})}));
    })().catch(error=>fail(error));return}
   }
   if(data.type==='error')return fail(new Error('Voice chat could not complete that request. Please reconnect.'));
   if(data.type==='input_audio_buffer.speech_started'){utterance++;toolCount=0;pendingSpeech=null;toolAbort.abort();toolAbort=new AbortController();updateContext(onTurn());state('listening');touch()}
   if(data.type==='input_audio_buffer.speech_stopped')state('thinking');
   if(data.type==='response.created')state('thinking');
   if(data.type==='output_audio_buffer.started')state('speaking');
   if(data.type==='output_audio_buffer.stopped'||data.type==='output_audio_buffer.cleared'||data.type==='response.done'){state('listening');touch()}
   if(data.type==='conversation.item.input_audio_transcription.completed')onTranscript({role:'user',id:data.item_id,text:data.transcript,done:true});
   if(data.type==='response.output_audio_transcript.delta')onTranscript({role:'assistant',id:data.item_id,text:data.delta,done:false});
   if(data.type==='response.output_audio_transcript.done')onTranscript({role:'assistant',id:data.item_id,text:data.transcript,done:true});
  };
  peer.onconnectionstatechange=()=>{if(peer.connectionState==='failed')fail(new Error('Voice connection was lost. Please reconnect.'));if(peer.connectionState==='closed')stop()};
  await peer.setLocalDescription(await peer.createOffer());
  // Wait briefly for ICE candidates so the browser offer works through NATs.
  if(peer.iceGatheringState!=='complete')await new Promise(resolve=>{const timeout=setTimeout(done,3000);function done(){clearTimeout(timeout);peer.removeEventListener('icegatheringstatechange',changed);resolve()}function changed(){if(peer.iceGatheringState==='complete')done()}peer.addEventListener('icegatheringstatechange',changed)});
  if(closed)return;const sdp=await request(peer.localDescription.sdp,abort.signal);if(closed)return;await peer.setRemoteDescription({type:'answer',sdp});
 }catch(error){fail(error)}})();
 return {stop,ready,updateContext,speak,get active(){return !closed}};
}
