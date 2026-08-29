-- ==========================================================
-- SUPABASE POSTGRESQL SCHEMA FOR MINIBLOGS
-- ==========================================================
-- Run this SQL in your Supabase Dashboard -> SQL Editor

-- 1. Create the posts table (with topic tags)
CREATE TABLE IF NOT EXISTS posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    author TEXT NOT NULL,
    tags TEXT[] DEFAULT ARRAY['Thoughts']::TEXT[],
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- (If table already exists, run this migration to add tags column:)
-- ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY['Thoughts']::TEXT[];

-- 2. Create index on created_at for fast descending chronological feed
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- 4. Policies: Allow public read access to all blog posts
CREATE POLICY "Allow public read access"
    ON posts FOR SELECT
    USING (true);

-- 5. Policies: Allow public insert access
CREATE POLICY "Allow public insert access"
    ON posts FOR INSERT
    WITH CHECK (true);

-- 6. Policies: Allow public update access
CREATE POLICY "Allow public update access"
    ON posts FOR UPDATE
    USING (true);

-- 7. Policies: Allow public delete access
CREATE POLICY "Allow public delete access"
    ON posts FOR DELETE
    USING (true);

-- ==========================================================
-- PROFILES TABLE (persistent profile storage for Vercel)
-- ==========================================================

-- 8. Create the profiles table (stores profile data as JSONB)
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Create index on updated_at
CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles (updated_at DESC);

-- 10. Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 11. Policies: Allow public read access to profiles
CREATE POLICY "Allow public read access"
    ON profiles FOR SELECT
    USING (true);

-- 12. Policies: Allow public insert access to profiles
CREATE POLICY "Allow public insert access"
    ON profiles FOR INSERT
    WITH CHECK (true);

-- 13. Policies: Allow public update access to profiles
CREATE POLICY "Allow public update access"
    ON profiles FOR UPDATE
    USING (true);

-- 14. Policies: Allow public delete access to profiles
CREATE POLICY "Allow public delete access"
    ON profiles FOR DELETE
    USING (true);
