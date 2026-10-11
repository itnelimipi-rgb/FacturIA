ALTER TABLE app_document_files ADD COLUMN IF NOT EXISTS request_key text;
ALTER TABLE app_document_files ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS document_file_request_idx ON app_document_files(user_id,request_key) WHERE request_key IS NOT NULL;
