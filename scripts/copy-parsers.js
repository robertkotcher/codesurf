import {copyFile,mkdir} from 'node:fs/promises';
await mkdir('public/vendor',{recursive:true});
for(const [from,to]of [['web-tree-sitter/tree-sitter.js','tree-sitter.js'],['web-tree-sitter/tree-sitter.wasm','tree-sitter.wasm'],['tree-sitter-wasms/out/tree-sitter-ruby.wasm','tree-sitter-ruby.wasm']])await copyFile('node_modules/'+from,'public/vendor/'+to);
await copyFile('node_modules/web-tree-sitter/LICENSE','public/vendor/tree-sitter-LICENSE');
