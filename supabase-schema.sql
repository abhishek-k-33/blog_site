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

-- ==========================================================
-- FOLLOWS TABLE (social network graph)
-- ==========================================================

-- 10. Create follows table
CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read follows" ON follows;
DROP POLICY IF EXISTS "Allow user follow" ON follows;
DROP POLICY IF EXISTS "Allow user unfollow" ON follows;

CREATE POLICY "Allow public read follows"
    ON follows FOR SELECT
    USING (true);

CREATE POLICY "Allow user follow"
    ON follows FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid()::text = follower_id);

CREATE POLICY "Allow user unfollow"
    ON follows FOR DELETE
    TO authenticated
    USING (auth.uid()::text = follower_id);

-- ==========================================================
-- BOOKMARKS TABLE (saved stories)
-- ==========================================================

-- 11. Create bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
    user_id TEXT NOT NULL,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks (user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_post ON bookmarks (post_id);

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow user read bookmarks" ON bookmarks;
DROP POLICY IF EXISTS "Allow user insert bookmark" ON bookmarks;
DROP POLICY IF EXISTS "Allow user delete bookmark" ON bookmarks;

CREATE POLICY "Allow user read bookmarks"
    ON bookmarks FOR SELECT
    USING (true);

CREATE POLICY "Allow user insert bookmark"
    ON bookmarks FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Allow user delete bookmark"
    ON bookmarks FOR DELETE
    TO authenticated
    USING (auth.uid()::text = user_id);

-- ==========================================================
-- POST VIEWS DEDUPLICATION TABLE
-- ==========================================================

-- 12. Create post_views table
CREATE TABLE IF NOT EXISTS post_views (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reader_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (post_id, reader_id)
);

ALTER TABLE post_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read post_views" ON post_views;
DROP POLICY IF EXISTS "Allow insert post_views" ON post_views;

CREATE POLICY "Allow read post_views"
    ON post_views FOR SELECT
    USING (true);

CREATE POLICY "Allow insert post_views"
    ON post_views FOR INSERT
    WITH CHECK (true);

-- ==========================================================
-- ATOMIC METRIC INCREMENT RPC FUNCTIONS
-- ==========================================================

-- 13. Atomic post applause / clap increment (avoids read-modify-write race conditions)
CREATE OR REPLACE FUNCTION increment_post_claps(p_post_id UUID, p_amount INT DEFAULT 1)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    new_claps INT;
BEGIN
    UPDATE posts
    SET claps = COALESCE(claps, 0) + p_amount
    WHERE id = p_post_id
    RETURNING claps INTO new_claps;
    RETURN COALESCE(new_claps, 0);
END;
$$;

-- 14. Atomic unique post view increment (with deduplication)
CREATE OR REPLACE FUNCTION increment_post_views(p_post_id UUID, p_reader_id TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    new_views INT;
    already_viewed BOOLEAN := false;
BEGIN
    IF p_reader_id IS NOT NULL AND p_reader_id <> '' THEN
        INSERT INTO post_views (post_id, reader_id)
        VALUES (p_post_id, p_reader_id)
        ON CONFLICT (post_id, reader_id) DO NOTHING;
        GET DIAGNOSTICS new_views = ROW_COUNT;
        IF new_views = 0 THEN
            already_viewed := true;
        END IF;
    END IF;

    IF NOT already_viewed THEN
        UPDATE posts
        SET views = COALESCE(views, 0) + 1
        WHERE id = p_post_id
        RETURNING views INTO new_views;
        RETURN COALESCE(new_views, 0);
    ELSE
        SELECT COALESCE(views, 0) INTO new_views FROM posts WHERE id = p_post_id;
        RETURN COALESCE(new_views, 0);
    END IF;
END;
$$;

-- ==========================================================
-- COMMENTS TABLE (hierarchical discussion threads)
-- ==========================================================

-- 15. Create comments table
CREATE TABLE IF NOT EXISTS comments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_username TEXT,
    author_avatar TEXT,
    content TEXT NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 16. Indexes for fast post and thread lookups
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments (created_at ASC);

-- 17. Enable Row Level Security (RLS) on comments
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- 18. RLS Policies for comments
DROP POLICY IF EXISTS "Allow public read comments" ON comments;
DROP POLICY IF EXISTS "Allow authenticated insert comments" ON comments;
DROP POLICY IF EXISTS "Allow author delete comments" ON comments;

-- Public can read all comments on published stories
CREATE POLICY "Allow public read comments"
    ON comments FOR SELECT
    USING (true);

-- Authenticated users can insert comments under their own ID
CREATE POLICY "Allow authenticated insert comments"
    ON comments FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid()::text = author_id);

-- Authors can delete their own comments
CREATE POLICY "Allow author delete comments"
    ON comments FOR DELETE
    TO authenticated
    USING (auth.uid()::text = author_id);

