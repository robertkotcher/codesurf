CREATE TABLE IF NOT EXISTS saved_pull_requests (
  owner text NOT NULL,
  pr_url text NOT NULL,
  repo text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  author text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('open', 'closed', 'merged')),
  draft boolean NOT NULL DEFAULT false,
  pr_updated_at timestamptz NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, pr_url)
);
CREATE INDEX IF NOT EXISTS saved_pull_requests_owner_saved ON saved_pull_requests(owner, saved_at DESC);
