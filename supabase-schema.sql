-- ==========================================================
-- SUPABASE POSTGRESQL SCHEMA FOR MINIBLOGS (HARDENED RLS)
-- ==========================================================
-- Run this SQL in your Supabase Dashboard -> SQL Editor

-- 1. Create the posts table (with author, tags, and metrics)
CREATE TABLE IF NOT EXISTS posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    author TEXT NOT NULL,
    author_id TEXT,
    author_email TEXT,
    author_username TEXT,
    cover_image TEXT,
    tags TEXT[] DEFAULT ARRAY['Thoughts']::TEXT[],
    claps INT DEFAULT 0,
    views INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Migrations for existing deployments:
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY['Thoughts']::TEXT[];
ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_id TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_email TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_username TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS cover_image TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS claps INT DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS views INT DEFAULT 0;

-- 2. Indexes for fast feed queries
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts (author_id);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- 4. Clean up legacy insecure open policies if they exist
DROP POLICY IF EXISTS "Allow public insert access" ON posts;
DROP POLICY IF EXISTS "Allow public update access" ON posts;
DROP POLICY IF EXISTS "Allow public delete access" ON posts;
DROP POLICY IF EXISTS "Allow public read access" ON posts;
DROP POLICY IF EXISTS "Allow authenticated insert" ON posts;
DROP POLICY IF EXISTS "Allow author update access" ON posts;
DROP POLICY IF EXISTS "Allow author delete access" ON posts;

-- 5. SECURE POLICIES FOR POSTS:
-- A. Public read access: Anyone can read published stories
CREATE POLICY "Allow public read access"
    ON posts FOR SELECT
    USING (true);

-- B. Authenticated insert: Only logged-in users can publish stories
CREATE POLICY "Allow authenticated insert"
    ON posts FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid()::text = author_id OR author_id IS NULL);

-- C. Author update: Only the story creator can modify their story
CREATE POLICY "Allow author update access"
    ON posts FOR UPDATE
    TO authenticated
    USING (auth.uid()::text = author_id);

-- D. Author delete: Only the story creator can delete their story
CREATE POLICY "Allow author delete access"
    ON posts FOR DELETE
    TO authenticated
    USING (auth.uid()::text = author_id);

-- ==========================================================
-- PROFILES TABLE (persistent profile storage)
-- ==========================================================

-- 6. Create the profiles table (stores profile data as JSONB)
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles (updated_at DESC);

-- 7. Enable Row Level Security (RLS) on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 8. Clean up legacy insecure profile policies
DROP POLICY IF EXISTS "Allow public insert access" ON profiles;
DROP POLICY IF EXISTS "Allow public update access" ON profiles;
DROP POLICY IF EXISTS "Allow public delete access" ON profiles;
DROP POLICY IF EXISTS "Allow public read access" ON profiles;
DROP POLICY IF EXISTS "Allow user insert own profile" ON profiles;
DROP POLICY IF EXISTS "Allow user update own profile" ON profiles;
DROP POLICY IF EXISTS "Allow user delete own profile" ON profiles;

-- 9. SECURE POLICIES FOR PROFILES:
-- A. Public read: Anyone can view user profile summaries
CREATE POLICY "Allow public read access"
    ON profiles FOR SELECT
    USING (true);

-- B. User insert: Users can only create their own profile row
CREATE POLICY "Allow user insert own profile"
    ON profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid()::text = id);

-- C. User update: Users can only modify their own profile data
CREATE POLICY "Allow user update own profile"
    ON profiles FOR UPDATE
    TO authenticated
    USING (auth.uid()::text = id);

-- D. User delete: Users can only delete their own profile
CREATE POLICY "Allow user delete own profile"
    ON profiles FOR DELETE
    TO authenticated
    USING (auth.uid()::text = id);
