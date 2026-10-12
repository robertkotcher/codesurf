import test from 'node:test';import assert from 'node:assert/strict';import {languageForPath} from '../browser/languages.js';import {highlightCodeLines} from '../browser/code-highlighting.js';
test('common languages and extensionless configuration files have language support',()=>{
 for(const path of ['a.rb','Gemfile','Rakefile','a.js','a.ts','a.jsx','a.tsx','a.py','a.go','a.rs','a.c','a.cpp','a.h','a.java','a.cs','a.kt','a.swift','a.php','a.scala','a.dart','a.html','a.css','a.scss','a.json','a.yml','a.toml','a.xml','a.sql','a.sh','Dockerfile','Dockerfile.prod','a.md','a.lua','a.pl','a.r','a.ps1','a.clj','a.ini'])assert(languageForPath(path),path);
 assert.equal(languageForPath('notes.txt'),null);
});
test('graph highlighting uses language tokens and preserves multiline source safely',()=>{
 for(const [path,text]of [['a.rb','def update\n # update comment\n value = "hello"\n 42\nend'],['a.go','func update() {\n // comment\n return "hello"\n}'],['a.yml','name: "hello"\n# comment'],['a.ts','const value = `one\ntwo`;\n// comment']]){
  const lines=highlightCodeLines(path,text);assert.equal(lines.length,text.split('\n').length);assert(lines.join('\n').includes('tok-'));assert(lines.join('\n').includes('tok-comment'));
  const plain=lines.join('\n').replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');assert.equal(plain,text);
 }
 assert.equal(highlightCodeLines('notes.txt','<script>alert("x")</script>')[0],'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});
