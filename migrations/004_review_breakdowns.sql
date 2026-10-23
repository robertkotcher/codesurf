CREATE TABLE IF NOT EXISTS review_breakdowns (
  id uuid PRIMARY KEY,
  owner text NOT NULL,
  pr_url text NOT NULL,
  head text NOT NULL,
  base text NOT NULL,
  pace text NOT NULL CHECK (pace IN ('guided','moderate','quick')),
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner, pr_url, head, base, pace)
);

-- Preserve existing AI work, including reviews older than the former TTL.
INSERT INTO review_breakdowns(id,owner,pr_url,head,base,pace,plan)
SELECT DISTINCT ON (owner,pr_url,head,plan->>'base',COALESCE(plan->>'pace','guided'))
  id,owner,pr_url,head,plan->>'base',COALESCE(plan->>'pace','guided'),plan
FROM review_sessions
WHERE plan->>'base' IS NOT NULL
  AND jsonb_typeof(plan->'operations')='array'
  AND jsonb_typeof(plan->'steps')='array'
ORDER BY owner,pr_url,head,plan->>'base',COALESCE(plan->>'pace','guided'),jsonb_array_length(plan->'steps') DESC,updated_at DESC
ON CONFLICT(owner,pr_url,head,base,pace) DO NOTHING;

ALTER TABLE review_sessions ADD COLUMN IF NOT EXISTS breakdown_id uuid REFERENCES review_breakdowns(id);
