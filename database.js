import pg from 'pg';
// Local profile persistence is optional; production remains functional without DATABASE_URL.
export const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000}):null;
export async function saveGitHubProfile(user){
  if(!pool)return;
  await pool.query(`INSERT INTO github_users (github_id, login, name, avatar_url)
    VALUES ($1,$2,$3,$4) ON CONFLICT (github_id) DO UPDATE SET
    login=EXCLUDED.login,name=EXCLUDED.name,avatar_url=EXCLUDED.avatar_url,updated_at=now()`,
    [String(user.id),user.login,user.name||null,user.avatar_url||null]);
}
