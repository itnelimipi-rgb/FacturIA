-- Better Auth core schema; PostgreSQL only, no Supabase auth schema required.
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_idx ON session("userId");
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX IF NOT EXISTS account_user_idx ON account("userId");
CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS app_profiles (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  rfc text NOT NULL CHECK (rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  business_name text NOT NULL, regime_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_documents (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_profiles(user_id) ON DELETE CASCADE,
  uuid_sat uuid, payload jsonb NOT NULL, raw_xml text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, uuid_sat), UNIQUE (id, user_id)
);
CREATE TABLE IF NOT EXISTS app_bank_transactions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_profiles(user_id) ON DELETE CASCADE,
  payload jsonb NOT NULL, matched_cfdi_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (matched_cfdi_id, user_id) REFERENCES app_documents(id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_matched_document ON app_bank_transactions(user_id, matched_cfdi_id)
  WHERE matched_cfdi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_owner_idx ON app_bank_transactions(user_id);
CREATE INDEX IF NOT EXISTS document_owner_idx ON app_documents(user_id);
CREATE TABLE IF NOT EXISTS app_audit_events (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id), action text NOT NULL,
  record_id text, created_at timestamptz NOT NULL DEFAULT now()
);
