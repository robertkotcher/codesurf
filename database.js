import pg from 'pg';
// Keep the driver's current certificate verification explicit for hosted Postgres.
const databaseUrl=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
if(databaseUrl&&['require','prefer','verify-ca'].includes(databaseUrl.searchParams.get('sslmode')))databaseUrl.searchParams.set('sslmode','verify-full');
export const pool=databaseUrl?new pg.Pool({connectionString:databaseUrl.toString(),max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:10000}):null;
export async function saveGitHubProfile(user){
  if(!pool)return;
  await pool.query(`INSERT INTO github_users (github_id, login, name, avatar_url)
    VALUES ($1,$2,$3,$4) ON CONFLICT (github_id) DO UPDATE SET
    login=EXCLUDED.login,name=EXCLUDED.name,avatar_url=EXCLUDED.avatar_url,updated_at=now()`,
    [String(user.id),user.login,user.name||null,user.avatar_url||null]);
}
