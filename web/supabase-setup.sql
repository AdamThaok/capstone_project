-- Run this once in Supabase SQL Editor (https://supabase.com/dashboard/project/fqtlxvdsmbmxzngoynne/sql)

CREATE TABLE IF NOT EXISTS opm_users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  email        TEXT        UNIQUE NOT NULL,
  password_hash TEXT       NOT NULL,
  salt         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  verified     BOOLEAN     DEFAULT TRUE
);

-- Disable RLS (server uses service role key — no public access needed)
ALTER TABLE opm_users DISABLE ROW LEVEL SECURITY;
