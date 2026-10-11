CREATE TABLE IF NOT EXISTS app_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL CHECK(count > 0),
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_expiry_idx ON app_rate_limits(expires_at);
