import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export default {
  id:'ruby', names:['Ruby'], matches:file=>file.endsWith('.rb'),
  index({roots,files}) {
    const executable=process.env.CODESURF_RUBY || 'ruby';
    const env={...process.env}; delete env.RUBYOPT; delete env.RUBYLIB;
    try {
      return JSON.parse(execFileSync(executable,['--disable-gems',fileURLToPath(new URL('../ruby_index.rb',import.meta.url))],{
        input:JSON.stringify({roots,files}),encoding:'utf8',env,maxBuffer:128*1024*1024,timeout:120000,
        stdio:['pipe','pipe','pipe'],
      }));
    } catch(error) {
      throw new Error(`Ruby requires an installed Ruby interpreter with Ripper supporting the project's syntax; set CODESURF_RUBY. ${error.stderr?.toString().slice(0,500) || error.message}`);
    }
  },
};
