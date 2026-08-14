-- ==========================================================
-- SUPABASE POSTGRESQL SCHEMA FOR MINIBLOGS
-- ==========================================================
-- Run this SQL in your Supabase Dashboard -> SQL Editor

-- 1. Create the posts table
CREATE TABLE IF NOT EXISTS posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    author TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

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
