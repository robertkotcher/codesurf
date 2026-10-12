import test from 'node:test';
import assert from 'node:assert/strict';
import {groupPullRequests} from '../public/pull-list.js';
const cutoff=Date.parse('2026-09-28T12:00:00Z');
const items=[{repo:'zeta/app',title:'Recent Z',number:1,updated:'2026-10-10T12:00:00Z',author:'alice'},{repo:'acme/app',title:'Old change',number:2,updated:'2026-09-20T12:00:00Z'},{repo:'acme/app',title:'Boundary',number:3,updated:'2026-09-28T12:00:00Z'},{repo:'acme/app',title:'Latest change',number:4,updated:'2026-10-12T12:00:00Z'}];
test('PR inbox groups repositories alphabetically and sorts newest first with an inclusive recent boundary',()=>{
 const groups=groupPullRequests(items,{cutoff});assert.deepEqual(groups.map(g=>g.repo),['acme/app','zeta/app']);assert.deepEqual(groups[0].items.map(p=>p.number),[4,3]);
 assert.deepEqual(groupPullRequests(items,{cutoff,includeOlder:true})[0].items.map(p=>p.number),[4,3,2]);
 assert.equal(items[0].repo,'zeta/app');
});
test('PR filters apply across repository, title, number and author, including expanded older PRs',()=>{
 for(const query of [' ACME ','latest','#4'])assert.equal(groupPullRequests(items,{cutoff,query})[0].repo,'acme/app');
 assert.equal(groupPullRequests(items,{cutoff,query:'alice'})[0].repo,'zeta/app');
 assert.equal(groupPullRequests(items,{cutoff,query:'Old change'}).length,0);assert.equal(groupPullRequests(items,{cutoff,includeOlder:true,query:'Old change'})[0].items[0].number,2);
});
