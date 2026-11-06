import {analyze} from '../typescript.js';
export default {
  id:'typescript', names:['JavaScript','TypeScript'],
  matches:file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts'),
  index:({roots,question,depth,limit})=>analyze(roots,question,{depth,limit,catalog:true}),
};
