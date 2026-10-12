CREATE TABLE IF NOT EXISTS review_sessions (
  id uuid PRIMARY KEY,
  owner text NOT NULL,
  pr_url text NOT NULL,
  head text NOT NULL,
  plan jsonb NOT NULL,
  cursor integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner, pr_url, head)
);
CREATE INDEX IF NOT EXISTS review_sessions_updated ON review_sessions(updated_at);
