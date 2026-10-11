CREATE TABLE IF NOT EXISTS github_users (
  github_id text PRIMARY KEY,
  login text NOT NULL,
  name text,
  avatar_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
