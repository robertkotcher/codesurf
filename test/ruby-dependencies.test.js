import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import tar from 'tar-stream';
import {lockedRubyGems,withRubyDependencies} from '../ruby-dependencies.js';
import {buildCallIndex,initCallParsers,indexedCalls} from '../browser/source-index.js';
import {transformationPlan} from '../transformations.js';
import {canvasChanges} from '../canvas-model.js';
import {prepareCanvasConnections} from '../canvas-relations.js';
async function archive(entries){const pack=tar.pack(),parts=[],read=(async()=>{for await(const part of pack)parts.push(part)})();for(const [name,text]of entries)pack.entry({name},text);pack.finalize();await read;return Buffer.concat(parts)}
const lock=version=>`GEM\n  remote: https://rubygems.org/\n  specs:\n    devise (${version})\n\nDEPENDENCIES\n  devise\n`;
test('only exact versions from the public RubyGems section can be downloaded',()=>{
 assert.deepEqual(lockedRubyGems('GIT\n  remote: https://example.com/gem\n  specs:\n    private (1.0.0)\n\n'+lock('5.0.4')+'\nPATH\n  specs:\n    local (2.0.0)\n'),[{name:'devise',version:'5.0.4'}]);
 assert.deepEqual(lockedRubyGems(lock('5.0.4').replace('rubygems.org','private.example.com')),[]);
});
test('a pinned Devise inherited helper becomes a library node with exact changed-call edges and no source body',async()=>{
 await initCallParsers();const version='5.0.999',path='app/controllers/login_controller.rb',after='class LoginController < Devise::OmniauthCallbacksController\n def run(user)\n  stored_location_for(user)\n  stored_location_for(user)\n end\nend';
 const dependency=[['lib/devise.rb','module Devise\n @@parent_controller = "ApplicationController"\n def self.include_helpers(scope)\n  ActiveSupport.on_load(:action_controller) do\n   include scope::Helpers\n  end\n end\nend'],['lib/devise/controllers/helpers.rb','module Devise::Controllers::Helpers\n include Devise::Controllers::StoreLocation\nend'],['lib/devise/controllers/store_location.rb','module Devise::Controllers::StoreLocation\n # Returns the saved destination after sign-in.\n def stored_location_for(user)\n  session.delete(user)\n end\nend'],['app/controllers/devise_controller.rb','class DeviseController < Devise.parent_controller.constantize\nend'],['app/controllers/devise/omniauth_callbacks_controller.rb','class Devise::OmniauthCallbacksController < DeviseController\nend'],['../../escape.rb','danger'],['lib/.env','secret']];
 const bytes=await archive([['data.tar.gz',gzipSync(await archive(dependency))]]),sha=createHash('sha256').update(bytes).digest('hex');let reads=0;
 const files=new Map([[path,after],['Gemfile.lock',lock(version)],['app/controllers/application_controller.rb','class ApplicationController < ActionController::Base\nend']]);
 const fetcher=async url=>{reads++;assert.ok(url.startsWith('https://rubygems.org/'));return url.endsWith('.json')?Response.json({name:'devise',version,sha,info:'Authentication for Rails'}):new Response(bytes)};
 const source=await withRubyDependencies({index:{files},graph:buildCallIndex(files)},{fetcher});assert.deepEqual(source.dependencyIssues,[]);assert.equal(reads,2);
 const target=indexedCalls(source.graph,{path,line:3,direction:'callees'}).blocks[0];assert.equal(target.owner,'Devise::Controllers::StoreLocation');assert.ok(![...source.index.files.keys()].some(path=>path.includes('escape.rb')));
 const plan=await transformationPlan([{path,status:'added',before:'',after}],{explain:false});plan.steps=[{title:'Return to the saved destination',ids:plan.operations.map(op=>op.id)}];const prepared=prepareCanvasConnections(canvasChanges(plan,1),source),entry=prepared.connections.find(item=>item.selection.line===3&&item.selection.column!==undefined),node=prepared.nodes[entry.targets[0].id];
 assert.equal(node.library.name,'devise');assert.equal(node.library.version,version);assert.equal(node.text,'');assert.equal(node.library.explanation,'Returns the saved destination after sign-in.');assert.deepEqual(entry.targets[0].edges.map(edge=>edge.callLine),[3,4]);
 await withRubyDependencies({index:{files},graph:buildCallIndex(files)},{fetcher});assert.equal(reads,2,'public, pinned source is cached');
});
test('unavailable or unverifiable dependencies leave the repository usable without fabricated targets',async()=>{
 await initCallParsers();const files=new Map([['Gemfile.lock',lock('5.0.998')],['a.rb','class Login < Devise::Controller\n def run\n  stored_location_for(user)\n end\nend']]);
 const source=await withRubyDependencies({index:{files},graph:buildCallIndex(files)},{fetcher:async()=>Response.json({name:'devise',version:'wrong',sha:'0'.repeat(64)})});assert.equal(source.dependencyIssues.length,1);assert.equal(indexedCalls(source.graph,{path:'a.rb',line:3,direction:'callees'}).total,0);assert.equal(source.index.files.get('a.rb'),files.get('a.rb'));
});
