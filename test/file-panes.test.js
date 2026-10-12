import test from 'node:test';
import assert from 'node:assert/strict';
import {syncFilePanes,movePaneFile} from '../public/file-panes.js';
test('moving files combines tabs and removes empty columns without changing other tabs',()=>{
 const panes=[{tabs:['a','b'],active:'a',mode:'diff'},{tabs:['c'],active:'c',mode:'full'}];
 const moved=movePaneFile(panes,'a',0,1);
 assert.deepEqual(moved,[{tabs:['b'],active:'b',mode:'diff'},{tabs:['c','a'],active:'a',mode:'full'}]);
 assert.deepEqual(panes[0].tabs,['a','b']);
 const grouped=movePaneFile(moved,'b',0,1);assert.equal(grouped.length,1);assert.deepEqual(grouped[0].tabs,['c','a','b']);
});
test('splitting and changing review steps preserve remembered file groups',()=>{
 let panes=syncFilePanes([],['a','b']);panes=movePaneFile(panes,'b',1,0);
 panes=syncFilePanes(panes,['b','c']);assert.deepEqual(panes.map(p=>p.tabs),[['a','b'],['c']]);
 panes=syncFilePanes(panes,['a','b']);assert.equal(panes.length,2);
 panes=movePaneFile(panes,'b',0);assert.deepEqual(panes.map(p=>p.tabs),[['a'],['c'],['b']]);
 assert.equal(movePaneFile(panes,'invented',0,1),panes);assert.equal(movePaneFile(panes,'a',0,0),panes);
});
