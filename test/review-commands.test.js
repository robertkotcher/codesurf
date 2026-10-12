import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewNavigationCommand} from '../public/review-commands.js';
test('explicit typed commands support next, previous, and polite variants',()=>{
 for(const text of ['next','Next!','please go to the next step','move next please'])assert.equal(reviewNavigationCommand(text),'next');
 for(const text of ['previous','back','go to the previous change please'])assert.equal(reviewNavigationCommand(text),'previous');
});
test('questions about code and function names never become navigation commands',()=>{
 for(const text of ['what happens next?','who calls next()?', 'next()', 'explain the previous change','show callers','go next and explain the caller'])assert.equal(reviewNavigationCommand(text),null);
});
