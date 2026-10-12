import {readFile,readdir} from 'node:fs/promises';
import {pool} from '../database.js';
if(!pool)throw new Error('Set DATABASE_URL to your PostgreSQL database.');
try{for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
 await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));console.log('Applied '+file);
}}finally{await pool.end()}
