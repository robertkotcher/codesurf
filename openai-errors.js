export function openAIErrorMessage(error){
 const code=error.code||error.error?.code;
 if(code==='missing_scope')return /api\.model\.audio\.request/.test(error.message||'')?'The OpenAI key needs audio generation permission. Enable api.model.audio.request in the OpenAI project.':'The OpenAI key lacks permission for this request. Check its project permissions.';
 if(code==='invalid_api_key')return 'The server OpenAI key is invalid or revoked. Update it in production settings.';
 if(code==='insufficient_quota'||code==='organization_usage_limit_exceeded')return 'The OpenAI project has reached its usage limit. Check billing and available credits.';
 if(code==='model_not_found')return 'The configured OpenAI model is unavailable to this project. Check model access.';
 if(error.status===429)return 'OpenAI is rate limiting requests. Please try again shortly.';
 if(error.status===401||error.status===403)return 'OpenAI denied this request. Check the server key and project permissions.';
 return 'OpenAI could not complete this request. Please try again.';
}
export function reportOpenAIError(error){console.warn('OpenAI request failed',{status:error.status||null,code:error.code||error.error?.code||null,requestId:error.request_id||error.requestID||null})}
