CREATE TABLE IF NOT EXISTS app_document_files (
  document_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_profiles(user_id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK(content_type IN ('application/pdf','image/png','image/jpeg','image/webp')),
  bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(octet_length(content)=bytes),
  FOREIGN KEY(document_id,user_id) REFERENCES app_documents(id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS document_file_owner_idx ON app_document_files(user_id);
