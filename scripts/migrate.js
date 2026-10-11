import {readFile} from 'node:fs/promises';
import {pool} from '../database.js';
if(!pool)throw new Error('Set DATABASE_URL to your PostgreSQL database.');
try{await pool.query(await readFile(new URL('../migrations/001_github_users.sql',import.meta.url),'utf8'));console.log('PostgreSQL profile table ready.')}finally{await pool.end()}
