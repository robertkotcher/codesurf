import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryFilesURL,reviewFileURL} from '../public/files-route.js';
test('repository links preserve provider, PR, commit and paths containing URL punctuation',()=>{
 const pr={url:'https://github.com/acme/repo/pull/42',head:'a'.repeat(40)},path='src/a # & ü.rb',url=new URL(repositoryFilesURL(pr,path),'https://codesurf.io');
 assert.equal(url.pathname,'/files/github/acme/repo/pull/42');assert.equal(url.searchParams.get('path'),path);assert.equal(url.searchParams.get('head'),pr.head);assert.equal(url.searchParams.get('side'),null);
 assert.equal(new URL(repositoryFilesURL(pr,path,'base'),'https://codesurf.io').searchParams.get('side'),'base');
 assert.throws(()=>repositoryFilesURL({url:'https://evil.example/acme/repo/pull/42'},path));
});

test('deleted files use the base tree while deletions within a file and renames use its final path',()=>{
 const pr={url:'https://github.com/acme/repo/pull/42',head:'a'.repeat(40),files:[{path:'gone.rb',status:'removed'},{path:'trimmed.rb',status:'modified'},{path:'new.rb',previousPath:'old.rb',status:'renamed'}]};
 const link=path=>new URL(reviewFileURL(pr,path),'https://codesurf.io');
 assert.equal(link('gone.rb').searchParams.get('side'),'base');assert.equal(link('trimmed.rb').searchParams.get('side'),null);
 assert.equal(link('old.rb').searchParams.get('path'),'new.rb');assert.equal(link('untouched.rb').searchParams.get('path'),'untouched.rb');
});
