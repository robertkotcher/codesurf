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

test('closing files selects another tab, removes empty panes, and never mutates the input',async()=>{
 const {closePaneFile,openPaneFile}=await import('../public/file-panes.js');
 const initial=[{tabs:['a','b'],active:'a',mode:'full'},{tabs:['c'],active:'c'}];
 const next=closePaneFile(initial,'a',0);assert.equal(next[0].active,'b');assert.deepEqual(initial[0].tabs,['a','b']);
 assert.deepEqual(closePaneFile(next,'b',0),[{tabs:['c'],active:'c'}]);
 assert.deepEqual(closePaneFile([{tabs:['a'],active:'a'}],'a',0),[]);
 assert.deepEqual(openPaneFile([],'new',''),[{tabs:['new'],active:'new'}]);
 const opened=openPaneFile(initial,'new','c');assert.deepEqual(opened[1].tabs,['c','new']);assert.equal(opened[1].active,'new');
 assert.equal(openPaneFile(opened,'new','a')[1].tabs.length,2);
});
