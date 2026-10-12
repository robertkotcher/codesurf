import test from 'node:test';import assert from 'node:assert/strict';import {openAIErrorMessage} from '../openai-errors.js';
test('OpenAI failures distinguish audio permission, credentials, billing and model access without exposing upstream text',()=>{
 assert.match(openAIErrorMessage({code:'missing_scope',message:'Missing api.model.audio.request'}),/audio generation permission/);
 assert.match(openAIErrorMessage({code:'invalid_api_key',message:'secret-key'}),/invalid or revoked/);
 assert.match(openAIErrorMessage({code:'insufficient_quota'}),/billing/);
 assert.match(openAIErrorMessage({code:'model_not_found'}),/model is unavailable/);
 assert.match(openAIErrorMessage({status:429}),/rate limiting/);
 assert(!openAIErrorMessage({message:'secret-key'}).includes('secret-key'));
});
