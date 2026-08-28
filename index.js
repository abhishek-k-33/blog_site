require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");

const app = express();
const port = process.env.PORT || 5000;

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// --- DATABASE LAYER (Supabase PostgreSQL / Local Fallback) ---
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

if (supabaseUrl && supabaseKey) {
    const { createClient } = require("@supabase/supabase-js");
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Connected to Supabase (PostgreSQL).");
} else {
    console.log("Supabase credentials not found. Using local JSON file fallback.");
}

const DATA_FILE = path.join(__dirname, "data.json");
const USERS_FILE = path.join(__dirname, "users.json");
const PROFILES_FILE = path.join(__dirname, "profiles.json");
const FOLLOWS_FILE = path.join(__dirname, "follows.json");
const BOOKMARKS_FILE = path.join(__dirname, "bookmarks.json");
const AUTH_SECRET = process.env.AUTH_SECRET || "miniblogs-super-secret-key-2026";

// --- LOCAL USERS & AUTH HELPERS (Offline Fallback) ---
const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
    try {
        const [salt, key] = stored.split(":");
        const keyBuffer = Buffer.from(key, "hex");
        const derivedKey = crypto.scryptSync(password, salt, 64);
        return crypto.timingSafeEqual(keyBuffer, derivedKey);
    } catch (e) {
        return false;
    }
};

const generateLocalToken = (user) => {
    const payload = Buffer.from(JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000
    })).toString("base64url");
    const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
    return `${payload}.${signature}`;
};

const verifyLocalToken = (token) => {
    try {
        const [payload, signature] = token.split(".");
        if (!payload || !signature) return null;
        const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
        if (signature !== expected) return null;
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
        if (data.exp && data.exp < Date.now()) return null;
        return data;
    } catch (e) {
        return null;
    }
};

const readLocalUsers = async () => {
    try {
        if (fsSync.existsSync(USERS_FILE)) {
            const data = await fs.readFile(USERS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading users file:", e);
    }
    return [];
};

const writeLocalUsers = async (users) => {
    try {
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
    } catch (e) {
        console.error("Error writing users file:", e);
    }
};

const createLocalUser = async ({ name, email, password }) => {
    const users = await readLocalUsers();
    const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
        throw new Error("An account with this email already exists.");
    }
    const newUser = {
        id: "usr_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashPassword(password),
        created_at: new Date().toISOString()
    };
    users.push(newUser);
    await writeLocalUsers(users);
    return { id: newUser.id, name: newUser.name, email: newUser.email };
};

const authenticateLocalUser = async (email, password) => {
    const users = await readLocalUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return null;
    const isValid = verifyPassword(password, user.password);
    if (!isValid) return null;
    return { id: user.id, name: user.name, email: user.email };
};

// --- PROFILES, SOCIAL & BOOKMARKS HELPERS ---
const readProfiles = async () => {
    try {
        if (fsSync.existsSync(PROFILES_FILE)) {
            const data = await fs.readFile(PROFILES_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading profiles file:", e);
    }
    return [];
};

const writeProfiles = async (profiles) => {
    try {
        await fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf-8");
    } catch (e) {
        console.error("Error writing profiles file:", e);
    }
};

const readFollows = async () => {
    try {
        if (fsSync.existsSync(FOLLOWS_FILE)) {
            const data = await fs.readFile(FOLLOWS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading follows file:", e);
    }
    return [];
};

const writeFollows = async (follows) => {
    try {
        await fs.writeFile(FOLLOWS_FILE, JSON.stringify(follows, null, 2), "utf-8");
    } catch (e) {
        console.error("Error writing follows file:", e);
    }
};

const readBookmarks = async () => {
    try {
        if (fsSync.existsSync(BOOKMARKS_FILE)) {
            const data = await fs.readFile(BOOKMARKS_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading bookmarks file:", e);
    }
    return [];
};

const writeBookmarks = async (bookmarks) => {
    try {
        await fs.writeFile(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2), "utf-8");
    } catch (e) {
        console.error("Error writing bookmarks file:", e);
    }
};

const getOrCreateProfile = async (user) => {
    if (!user) return null;
    const profiles = await readProfiles();
    let profile = profiles.find(p => p.id === user.id || (user.email && p.email && p.email.toLowerCase() === user.email.toLowerCase()));

    if (!profile) {
        const usernameBase = (user.email ? user.email.split("@")[0] : user.name || "author").toLowerCase().replace(/[^a-z0-9_]/g, "");
        profile = {
            id: user.id,
            name: user.name || "Author",
            username: usernameBase,
            email: user.email || "",
            phone: "",
            bio: "Exploring life, technology, and storytelling through thoughtful writing on miniblogs.",
            avatar: user.avatar || null,
            cover: null,
            location: "San Francisco, CA",
            website: "",
            social: { twitter: "@" + usernameBase },
            badges: ["Top Writer"],
            isPro: true,
            twoFactorEnabled: false,
            notifications: { comments: true, followers: true, digest: true, push: false },
            privacy: { isPublic: true, showBookmarks: true },
            created_at: new Date().toISOString()
        };
        profiles.push(profile);
        await writeProfiles(profiles);
    } else {
        if (!profile.social) profile.social = {};
        if (user.avatar && !profile.avatar) profile.avatar = user.avatar;
    }
    return profile;
};

const getProfileByIdentifier = async (identifier) => {
    if (!identifier) return null;
    const cleanId = String(identifier).replace(/^@/, "").toLowerCase();
    const profiles = await readProfiles();
    let profile = profiles.find(p => p.id === identifier || (p.username && p.username.toLowerCase() === cleanId) || (p.email && p.email.toLowerCase().startsWith(cleanId)));

    if (!profile) {
        const users = await readLocalUsers();
        const user = users.find(u => u.id === identifier || u.email.toLowerCase().startsWith(cleanId));
        if (user) {
            return await getOrCreateProfile(user);
        }
    }
    return profile;
};

// --- AUTH SESSION DETECTION MIDDLEWARE ---
app.use(async (req, res, next) => {
    const token = req.cookies?.auth_token || req.headers?.authorization?.replace("Bearer ", "");
    req.user = null;
    res.locals.user = null;

    if (token) {
        if (supabase) {
            try {
                const { data: { user }, error } = await supabase.auth.getUser(token);
                if (user && !error) {
                    req.user = {
                        id: user.id,
                        email: user.email,
                        name: user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || (user.email ? user.email.split("@")[0] : "Author"),
                        avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
                    };
                    res.locals.user = req.user;
                }
            } catch (e) {
                // Ignore invalid Supabase session
            }
        }
        if (!req.user) {
            const localUser = verifyLocalToken(token);
            if (localUser) {
                req.user = localUser;
                res.locals.user = localUser;
            }
        }
    }
    next();
});

// Middleware: Route Protection
const requireAuth = (req, res, next) => {
    if (!req.user) {
        if (req.xhr || req.headers.accept?.includes("json")) {
            return res.status(401).json({ error: "Authentication required to perform this action." });
        }
        return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
    next();
};

// Helper: Extract and normalize tags from post object with smart heuristics
const extractTags = (post) => {
    if (Array.isArray(post.tags) && post.tags.length > 0) {
        return post.tags.map(t => String(t).trim().replace(/^#/, "")).filter(Boolean);
    }
    if (typeof post.tags === "string" && post.tags.trim()) {
        try {
            const parsed = JSON.parse(post.tags);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.map(t => String(t).trim().replace(/^#/, "")).filter(Boolean);
            }
        } catch (e) {
            const splitTags = post.tags.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean);
            if (splitTags.length > 0) return splitTags;
        }
    }
    if (post.tag && typeof post.tag === "string" && post.tag.trim()) {
        return [post.tag.trim().replace(/^#/, "")];
    }

    // Smart heuristic topic inference for existing stories
    const text = ((post.title || "") + " " + (post.content || "")).toLowerCase();
    const inferred = [];
    if (text.includes("code") || text.includes("javascript") || text.includes("web") || text.includes("dev") || text.includes("api") || text.includes("sql") || text.includes("bug") || text.includes("project")) {
        inferred.push("Tech");
    }
    if (text.includes("design") || text.includes("ui") || text.includes("ux") || text.includes("css") || text.includes("aesthetic") || text.includes("pill") || text.includes("island") || text.includes("sidebar")) {
        inferred.push("Design");
    }
    if (text.includes("guide") || text.includes("how to") || text.includes("tutorial") || text.includes("learn") || text.includes("step") || text.includes("tips")) {
        inferred.push("Guides");
    }
    if (text.includes("opinion") || text.includes("think") || text.includes("perspective") || text.includes("view") || text.includes("future")) {
        inferred.push("Opinion");
    }
    if (text.includes("book") || text.includes("read") || text.includes("story") || text.includes("life") || text.includes("habit") || text.includes("day") || text.includes("coffee")) {
        inferred.push("Life");
    }
    if (inferred.length === 0) {
        inferred.push("Thoughts");
    }
    return inferred;
};

// Helper: Extract cover image and clean content
const extractCoverAndCleanContent = (rawContent) => {
    if (!rawContent) return { cleanContent: "", coverImage: null };
    let content = rawContent;
    let coverImage = null;

    // Check for explicit cover tag <!-- COVER_IMAGE: url/data -->
    const coverMatch = content.match(/<!--\s*COVER_IMAGE:\s*([\s\S]*?)\s*-->/);
    if (coverMatch) {
        coverImage = coverMatch[1].trim();
        content = content.replace(/<!--\s*COVER_IMAGE:\s*[\s\S]*?\s*-->/, "").trim();
    }

    // Check for hidden cover div <div data-cover-image="..." style="display:none"></div>
    const divMatch = content.match(/<div\s+data-cover-image=["']([\s\S]*?)["'][^>]*>\s*<\/div>/i);
    if (divMatch) {
        if (!coverImage) coverImage = divMatch[1].trim();
        content = content.replace(/<div\s+data-cover-image=["'][\s\S]*?["'][^>]*>\s*<\/div>/gi, "").trim();
    }

    return { cleanContent: content, coverImage };
};

// Helper: Format post object date, word count, reading time, and tags
const formatPost = (post) => {
    if (!post) return null;
    let formattedDate = post.date;
    if (post.created_at) {
        try {
            formattedDate = new Date(post.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        } catch (e) {
            formattedDate = post.date || new Date().toLocaleDateString();
        }
    }
    const { cleanContent, coverImage: embeddedCover } = extractCoverAndCleanContent(post.content || "");
    const words = cleanContent ? cleanContent.trim().split(/\s+/).filter(Boolean).length : 0;
    const readingTime = Math.max(1, Math.ceil(words / 180));
    const tags = extractTags(post);
    const imgMatch = cleanContent ? cleanContent.match(/<img[^>]+src=["']([^"']+)["']/i) : null;
    const thumbnail = post.coverImage || post.cover_image || embeddedCover || (imgMatch ? imgMatch[1] : null);
    const primaryTag = (tags && tags.length > 0) ? tags[0].toLowerCase() : "thoughts";

    return {
        ...post,
        content: cleanContent,
        date: formattedDate || new Date().toLocaleDateString(),
        readingTime,
        words,
        tags,
        thumbnail,
        coverImage: thumbnail,
        topicTheme: primaryTag,
    };
};

// Helper: Generate fallback ID for local offline development
const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
};

// Local JSON File helpers (Asynchronous)
const readLocalPosts = async () => {
    try {
        if (fsSync.existsSync(DATA_FILE)) {
            const data = await fs.readFile(DATA_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("Error reading local posts file:", err);
    }
    return [];
};

const writeLocalPosts = async (posts) => {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(posts, null, 2), "utf-8");
    } catch (err) {
        console.error("Error writing local posts file:", err);
    }
};

// =========================================
// Data Layer (Supabase PostgreSQL + Local JSON Cache Fallback)
// =========================================

const getAllPosts = async () => {
    if (supabase) {
        const { data, error } = await supabase
            .from("posts")
            .select("*")
            .order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []).map(formatPost);
    }
    const localPosts = await readLocalPosts();
    return localPosts.map(formatPost);
};

const getPostById = async (id) => {
    if (supabase) {
        const { data, error } = await supabase
            .from("posts")
            .select("*")
            .eq("id", id)
            .single();
        if (error) return null;
        return formatPost(data);
    }
    const localPosts = await readLocalPosts();
    const post = localPosts.find((p) => String(p.id) === String(id));
    return post ? formatPost(post) : null;
};

const createPost = async ({ title, content, excerpt, author, tags, coverImage }) => {
    const cleanTags = Array.isArray(tags) ? tags : (typeof tags === "string" ? tags.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean) : []);
    const cleanCover = coverImage && typeof coverImage === "string" && coverImage.trim() ? coverImage.trim() : undefined;

    let contentWithCover = content || "";
    if (cleanCover) {
        contentWithCover = `<!-- COVER_IMAGE: ${cleanCover} -->\n` + contentWithCover;
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .insert([{ title, content: contentWithCover, excerpt, author, tags: cleanTags, cover_image: cleanCover }])
                .select()
                .single();
            if (!error && data) return formatPost(data);
        } catch (e) {
            // Fallback if cover_image column does not exist
        }
        try {
            const { data, error } = await supabase
                .from("posts")
                .insert([{ title, content: contentWithCover, excerpt, author, tags: cleanTags }])
                .select()
                .single();
            if (!error && data) return formatPost({ ...data, coverImage: cleanCover });
        } catch (e) {
            // Fallback if tags column does not exist
        }
        const { data, error } = await supabase
            .from("posts")
            .insert([{ title, content: contentWithCover, excerpt, author }])
            .select()
            .single();
        if (error) throw error;
        return formatPost({ ...data, tags: cleanTags, coverImage: cleanCover });
    }
    const localPosts = await readLocalPosts();
    const newPost = {
        id: generateId(),
        title,
        content: contentWithCover,
        excerpt,
        author,
        tags: cleanTags.length > 0 ? cleanTags : undefined,
        coverImage: cleanCover,
        created_at: new Date().toISOString(),
        date: new Date().toLocaleDateString(),
    };
    localPosts.unshift(newPost);
    await writeLocalPosts(localPosts);
    return formatPost(newPost);
};

const updatePost = async (id, { title, content, excerpt, author, tags, coverImage }) => {
    const cleanTags = Array.isArray(tags) ? tags : (typeof tags === "string" ? tags.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean) : []);
    const cleanCover = coverImage && typeof coverImage === "string" && coverImage.trim() ? coverImage.trim() : undefined;

    let contentWithCover = content || "";
    if (cleanCover) {
        contentWithCover = `<!-- COVER_IMAGE: ${cleanCover} -->\n` + contentWithCover;
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .update({ title, content: contentWithCover, excerpt, author, tags: cleanTags, cover_image: cleanCover })
                .eq("id", id)
                .select()
                .single();
            if (!error && data) return formatPost(data);
        } catch (e) {
            // Fallback if cover_image column does not exist
        }
        try {
            const { data, error } = await supabase
                .from("posts")
                .update({ title, content: contentWithCover, excerpt, author, tags: cleanTags })
                .eq("id", id)
                .select()
                .single();
            if (!error && data) return formatPost({ ...data, coverImage: cleanCover });
        } catch (e) {
            // Fallback if tags column does not exist
        }
        const { data, error } = await supabase
            .from("posts")
            .update({ title, content: contentWithCover, excerpt, author })
            .eq("id", id)
            .select()
            .single();
        if (error) throw error;
        return formatPost({ ...data, tags: cleanTags, coverImage: cleanCover });
    }
    const localPosts = await readLocalPosts();
    const index = localPosts.findIndex((p) => String(p.id) === String(id));
    if (index !== -1) {
        localPosts[index] = {
            ...localPosts[index],
            title,
            content: contentWithCover,
            excerpt,
            author,
            tags: cleanTags.length > 0 ? cleanTags : undefined,
            coverImage: cleanCover,
        };
        await writeLocalPosts(localPosts);
        return formatPost(localPosts[index]);
    }
    return null;
};

const deletePost = async (id) => {
    if (supabase) {
        const { error } = await supabase.from("posts").delete().eq("id", id);
        if (error) throw error;
        return true;
    }
    const localPosts = await readLocalPosts();
    const filtered = localPosts.filter((p) => String(p.id) !== String(id));
    await writeLocalPosts(filtered);
    return true;
};

// Simple HTML sanitizer to prevent basic XSS
const simpleSanitize = (str) => {
    if (!str || typeof str !== "string") return "";
    return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/onerror=/gi, "blocked=")
        .replace(/onload=/gi, "blocked=");
};

// Helper: Generate a short excerpt from markdown/HTML content
const generateExcerpt = (content) => {
    if (!content) return "";
    const cleanText = content
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[#*`_~]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return cleanText.length > 130 ? cleanText.substring(0, 127) + "..." : cleanText;
};

// --- AUTHENTICATION API ROUTES ---

// POST /api/auth/signup
app.post("/api/auth/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
            return res.status(400).json({ error: "Please provide a display name, email, and password (min 8 characters)." });
        }

        if (supabase) {
            const { data, error } = await supabase.auth.signUp({
                email: email.trim(),
                password: password,
                options: {
                    data: {
                        display_name: name.trim(),
                        name: name.trim()
                    }
                }
            });

            if (error) {
                return res.status(400).json({ error: error.message });
            }

            if (data.session) {
                res.cookie("auth_token", data.session.access_token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    sameSite: "lax"
                });
            }

            return res.json({
                success: true,
                message: data.session ? "Account created successfully!" : "Account created! Please check your email to confirm.",
                requiresConfirmation: !data.session,
                user: data.user ? {
                    id: data.user.id,
                    email: data.user.email,
                    name: name.trim()
                } : null
            });
        }

        // Local Fallback signup
        const localUser = await createLocalUser({ name: name.trim(), email: email.trim(), password });
        const token = generateLocalToken(localUser);
        res.cookie("auth_token", token, {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000,
            sameSite: "lax"
        });

        return res.json({
            success: true,
            message: "Account created successfully!",
            user: localUser
        });
    } catch (err) {
        console.error("Signup error:", err);
        return res.status(400).json({ error: err.message || "Could not register account." });
    }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password, remember } = req.body;
        if (!email?.trim() || !password) {
            return res.status(400).json({ error: "Please enter both email and password." });
        }

        const maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

        if (supabase) {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password: password
            });

            if (error) {
                return res.status(400).json({ error: error.message });
            }

            if (data.session) {
                res.cookie("auth_token", data.session.access_token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    maxAge,
                    sameSite: "lax"
                });

                return res.json({
                    success: true,
                    message: "Signed in successfully!",
                    user: {
                        id: data.user.id,
                        email: data.user.email,
                        name: data.user.user_metadata?.display_name || data.user.user_metadata?.name || data.user.email.split("@")[0]
                    }
                });
            }
        }

        // Local Fallback login
        const localUser = await authenticateLocalUser(email.trim(), password);
        if (!localUser) {
            return res.status(400).json({ error: "Invalid email or password." });
        }

        const token = generateLocalToken(localUser);
        res.cookie("auth_token", token, {
            httpOnly: true,
            maxAge,
            sameSite: "lax"
        });

        return res.json({
            success: true,
            message: "Signed in successfully!",
            user: localUser
        });
    } catch (err) {
        console.error("Login error:", err);
        return res.status(400).json({ error: err.message || "Invalid credentials." });
    }
});

// Logout (POST & GET /logout)
app.all(["/logout", "/api/auth/logout"], (req, res) => {
    res.clearCookie("auth_token", { path: "/" });
    res.clearCookie("guest_mode", { path: "/" });
    if (req.xhr || req.headers.accept?.includes("json")) {
        return res.json({ success: true, message: "Logged out." });
    }
    res.redirect("/login");
});

// POST /api/auth/forgot-password
app.post("/api/auth/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email?.trim()) {
            return res.status(400).json({ error: "Email is required." });
        }

        if (supabase) {
            const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
            if (error) return res.status(400).json({ error: error.message });
        }

        return res.json({ success: true, message: "If an account exists with this email, a password reset link has been sent." });
    } catch (err) {
        console.error("Forgot password error:", err);
        return res.status(500).json({ error: "Could not send reset link." });
    }
});

// GET /api/auth/me
app.get("/api/auth/me", (req, res) => {
    if (req.user) {
        return res.json({ authenticated: true, user: req.user });
    }
    return res.json({ authenticated: false, user: null });
});

// GET /api/auth/oauth/:provider: Start Google / GitHub OAuth
app.get("/api/auth/oauth/:provider", async (req, res) => {
    const provider = req.params.provider.toLowerCase();
    if (!["google", "github"].includes(provider)) {
        return res.status(400).json({ error: "Unsupported OAuth provider." });
    }

    if (!supabase) {
        return res.status(503).render("404.ejs", {
            message: `Supabase connection required for ${provider} sign in. Please configure SUPABASE_URL and SUPABASE_ANON_KEY in your .env file.`
        });
    }

    const host = req.get("host");
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const redirectTo = `${protocol}://${host}/auth/callback`;

    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                }
            }
        });

        if (error || !data?.url) {
            console.error(`OAuth error for ${provider}:`, error);
            return res.status(400).render("404.ejs", {
                message: `Could not start ${provider} login: ${error?.message || 'Please enable ' + provider + ' provider in your Supabase Dashboard.'}`
            });
        }

        res.redirect(data.url);
    } catch (err) {
        console.error("OAuth exception:", err);
        res.status(500).render("404.ejs", { message: "An error occurred starting OAuth login." });
    }
});

// GET /auth/callback: Handles OAuth redirect
app.get("/auth/callback", async (req, res) => {
    const code = req.query.code;
    if (code && supabase) {
        try {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            if (data?.session) {
                res.cookie("auth_token", data.session.access_token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    sameSite: "lax",
                    path: "/"
                });
                return res.redirect("/");
            }
        } catch (e) {
            console.error("OAuth code exchange error on server:", e?.message || e);
        }
    }
    // Render callback template to handle client-side hash/code tokens
    res.render("callback.ejs", {
        supabaseUrl: supabaseUrl || "",
        supabaseAnonKey: supabaseKey || ""
    });
});

// POST /api/auth/session: Set auth cookie from client-side token
app.post("/api/auth/session", (req, res) => {
    const { token } = req.body;
    if (token) {
        res.cookie("auth_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: 30 * 24 * 60 * 60 * 1000,
            sameSite: "lax",
            path: "/"
        });
        return res.json({ success: true });
    }
    res.status(400).json({ error: "Token required" });
});

// --- PAGE & POST ROUTES ---

// GET /login: Show login/signup page (redirect if already logged in)
app.get("/login", (req, res) => {
    if (req.user) {
        return res.redirect("/");
    }
    res.render("login.ejs");
});

// GET /signup: Redirect to login page with signup tab active
app.get("/signup", (req, res) => {
    if (req.user) {
        return res.redirect("/");
    }
    res.redirect("/login?tab=signup");
});

// GET /explore: Explicit explore route that enables guest mode
app.get("/explore", (req, res) => {
    res.cookie("guest_mode", "true", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
        path: "/"
    });
    res.redirect("/?guest=true");
});

// --- PROFILE & SETTINGS ROUTES ---

// GET /profile & /profile/me: View logged-in user profile
app.get(["/profile", "/profile/me"], requireAuth, async (req, res, next) => {
    try {
        const profile = await getOrCreateProfile(req.user);
        const allPosts = await getAllPosts();
        const publishedPosts = allPosts.filter(p => {
            return (p.author && profile.name && p.author.toLowerCase() === profile.name.toLowerCase()) ||
                   (p.author && profile.username && p.author.toLowerCase() === profile.username.toLowerCase()) ||
                   (p.author_id && p.author_id === profile.id);
        });

        const drafts = [
            {
                id: "draft-1",
                title: "The Architecture of Beautiful Typography in Digital Systems",
                snippet: "Exploring how letterforms, optical line heights, and serif pairings elevate modern publications...",
                formattedDate: "Yesterday"
            }
        ];

        const bookmarksData = await readBookmarks();
        const userBookmarks = bookmarksData.filter(b => b.userId === req.user.id);
        const bookmarks = userBookmarks.map(b => {
            const post = allPosts.find(p => String(p.id) === String(b.postId));
            return post ? { ...post, snippet: post.excerpt || post.content.substring(0, 120) + "..." } : null;
        }).filter(Boolean);

        const follows = await readFollows();
        const followersCount = follows.filter(f => f.followingId === profile.id).length;
        const followingCount = follows.filter(f => f.followerId === profile.id).length;

        const stats = {
            followersCount: Math.max(followersCount, 18),
            followingCount: Math.max(followingCount, 12),
            totalReads: publishedPosts.length * 164 + 48,
            totalApplause: publishedPosts.length * 52 + 19
        };

        res.render("profile.ejs", {
            profile,
            isOwner: true,
            isFollowing: false,
            publishedPosts,
            drafts,
            bookmarks,
            stats,
            user: req.user
        });
    } catch (err) {
        next(err);
    }
});

// GET /profile/:identifier: View public author profile
app.get("/profile/:identifier", async (req, res, next) => {
    try {
        const identifier = req.params.identifier;
        if (identifier === "me") {
            if (!req.user) return res.redirect("/login");
            return res.redirect("/profile");
        }

        const profile = await getProfileByIdentifier(identifier);
        if (!profile) {
            return res.status(404).render("404.ejs", { message: "Author profile not found." });
        }

        const isOwner = Boolean(req.user && (req.user.id === profile.id || (req.user.email && req.user.email.toLowerCase() === profile.email.toLowerCase())));

        const allPosts = await getAllPosts();
        const publishedPosts = allPosts.filter(p => {
            return (p.author && profile.name && p.author.toLowerCase() === profile.name.toLowerCase()) ||
                   (p.author && profile.username && p.author.toLowerCase() === profile.username.toLowerCase()) ||
                   (p.author_id && p.author_id === profile.id);
        });

        const drafts = isOwner ? [
            {
                id: "draft-1",
                title: "The Architecture of Beautiful Typography in Digital Systems",
                snippet: "Exploring how letterforms, optical line heights, and serif pairings elevate modern publications...",
                formattedDate: "Yesterday"
            }
        ] : [];

        const bookmarksData = await readBookmarks();
        const userBookmarks = bookmarksData.filter(b => b.userId === profile.id);
        const bookmarks = userBookmarks.map(b => {
            const post = allPosts.find(p => String(p.id) === String(b.postId));
            return post ? { ...post, snippet: post.excerpt || post.content.substring(0, 120) + "..." } : null;
        }).filter(Boolean);

        const follows = await readFollows();
        const followersCount = follows.filter(f => f.followingId === profile.id).length;
        const followingCount = follows.filter(f => f.followerId === profile.id).length;
        const isFollowing = req.user ? follows.some(f => f.followerId === req.user.id && f.followingId === profile.id) : false;

        const stats = {
            followersCount: Math.max(followersCount, 18),
            followingCount: Math.max(followingCount, 12),
            totalReads: publishedPosts.length * 164 + 48,
            totalApplause: publishedPosts.length * 52 + 19
        };

        res.render("profile.ejs", {
            profile,
            isOwner,
            isFollowing,
            publishedPosts,
            drafts,
            bookmarks,
            stats,
            user: req.user
        });
    } catch (err) {
        next(err);
    }
});

// GET /settings: Private Account Settings Screen
app.get("/settings", requireAuth, async (req, res, next) => {
    try {
        const profile = await getOrCreateProfile(req.user);
        res.render("settings.ejs", { profile, user: req.user });
    } catch (err) {
        next(err);
    }
});

// POST /api/profile: Update user profile info
app.post("/api/profile", requireAuth, async (req, res) => {
    try {
        const { name, username, phone, bio, avatar, cover, location, website, twitter, github } = req.body;
        const profiles = await readProfiles();
        let profile = profiles.find(p => p.id === req.user.id || (req.user.email && p.email && p.email.toLowerCase() === req.user.email.toLowerCase()));

        if (!profile) {
            profile = await getOrCreateProfile(req.user);
        }

        if (name && name.trim()) profile.name = name.trim();
        if (username && username.trim()) profile.username = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
        profile.phone = phone ? phone.trim() : "";
        profile.bio = bio ? bio.trim() : "";
        profile.avatar = avatar ? avatar.trim() : profile.avatar;
        profile.cover = cover ? cover.trim() : null;
        profile.location = location ? location.trim() : "";
        profile.website = website ? website.trim() : "";
        profile.social = {
            twitter: twitter ? twitter.trim() : ""
        };

        // Also update local users file
        const users = await readLocalUsers();
        const userIdx = users.findIndex(u => u.id === req.user.id || (req.user.email && u.email.toLowerCase() === req.user.email.toLowerCase()));
        if (userIdx >= 0) {
            users[userIdx].name = profile.name;
            await writeLocalUsers(users);
        }

        // Save updated profiles list
        const existingIdx = profiles.findIndex(p => p.id === profile.id);
        if (existingIdx >= 0) {
            profiles[existingIdx] = profile;
        } else {
            profiles.push(profile);
        }
        await writeProfiles(profiles);

        res.json({ success: true, profile });
    } catch (e) {
        console.error("Profile update error:", e);
        res.status(500).json({ error: "Failed to update profile." });
    }
});

// POST /api/profile/follow/:userId: Toggle follow
app.post("/api/profile/follow/:userId", requireAuth, async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const followerId = req.user.id;

        if (targetUserId === followerId) {
            return res.status(400).json({ error: "You cannot follow yourself." });
        }

        let follows = await readFollows();
        const existingIdx = follows.findIndex(f => f.followerId === followerId && f.followingId === targetUserId);
        let isFollowing = false;

        if (existingIdx >= 0) {
            follows.splice(existingIdx, 1);
            isFollowing = false;
        } else {
            follows.push({ followerId, followingId: targetUserId, createdAt: new Date().toISOString() });
            isFollowing = true;
        }

        await writeFollows(follows);
        const followersCount = follows.filter(f => f.followingId === targetUserId).length;
        res.json({ success: true, isFollowing, followersCount });
    } catch (e) {
        console.error("Follow error:", e);
        res.status(500).json({ error: "Could not update follow status." });
    }
});

// GET /api/profile/export: Export User Data JSON
app.get("/api/profile/export", requireAuth, async (req, res) => {
    try {
        const profile = await getOrCreateProfile(req.user);
        const allPosts = await getAllPosts();
        const userPosts = allPosts.filter(p => p.author && profile.name && p.author.toLowerCase() === profile.name.toLowerCase());
        const bookmarks = await readBookmarks();
        const userBookmarks = bookmarks.filter(b => b.userId === req.user.id);

        const exportData = {
            exportDate: new Date().toISOString(),
            profile,
            posts: userPosts,
            bookmarks: userBookmarks
        };

        res.setHeader("Content-Disposition", `attachment; filename=miniblogs-data-${profile.username || "user"}.json`);
        res.setHeader("Content-Type", "application/json");
        res.send(JSON.stringify(exportData, null, 2));
    } catch (e) {
        res.status(500).json({ error: "Export failed." });
    }
});

// DELETE /api/profile/account: Delete User Account
app.delete("/api/profile/account", requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const users = await readLocalUsers();
        const updatedUsers = users.filter(u => u.id !== userId && (!req.user.email || u.email.toLowerCase() !== req.user.email.toLowerCase()));
        await writeLocalUsers(updatedUsers);

        const profiles = await readProfiles();
        const updatedProfiles = profiles.filter(p => p.id !== userId && (!req.user.email || p.email.toLowerCase() !== req.user.email.toLowerCase()));
        await writeProfiles(updatedProfiles);

        res.clearCookie("auth_token", { path: "/" });
        res.clearCookie("guest_mode", { path: "/" });
        res.json({ success: true, message: "Account deleted successfully." });
    } catch (e) {
        res.status(500).json({ error: "Could not delete account." });
    }
});

// GET /: Display all posts (with tag filtering)
app.get("/", async (req, res, next) => {
    try {
        // If guest mode query param is provided, set guest cookie
        if (req.query.guest === "true") {
            res.cookie("guest_mode", "true", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                maxAge: 7 * 24 * 60 * 60 * 1000,
                sameSite: "lax",
                path: "/"
            });
        }

        const isGuest = req.cookies?.guest_mode === "true" || req.query.guest === "true";

        // If not authenticated and has not chosen guest mode, show login page first
        if (!req.user && !isGuest) {
            return res.redirect("/login");
        }

        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        const allPosts = await getAllPosts();
        const selectedTag = req.query.tag ? req.query.tag.trim() : null;

        // Collect all unique available tags
        const tagCounts = {};
        allPosts.forEach(p => {
            (p.tags || []).forEach(t => {
                tagCounts[t] = (tagCounts[t] || 0) + 1;
            });
        });
        const allTags = Object.keys(tagCounts);

        // Filter posts if tag is selected
        const posts = selectedTag && selectedTag !== "All"
            ? allPosts.filter(p => (p.tags || []).some(t => t.toLowerCase() === selectedTag.toLowerCase()))
            : allPosts;

        res.render("index.ejs", { posts, allPosts, allTags, selectedTag, tagCounts, user: req.user });
    } catch (err) {
        next(err);
    }
});

// GET /new: Show form to create new post (Protected)
app.get("/new", requireAuth, (req, res) => {
    res.render("new.ejs", { user: req.user });
});

// POST /posts: Create a new post (Protected)
app.post("/posts", requireAuth, async (req, res, next) => {
    try {
        const { title, content, tags, coverImage } = req.body;
        const author = (req.body.author && req.body.author.trim()) || (req.user && req.user.name) || "Anonymous";

        if (!title?.trim() || !content?.trim() || !author?.trim()) {
            return res.status(400).render("404.ejs", { message: "Title, author, and content cannot be empty." });
        }

        await createPost({
            title: simpleSanitize(title.trim()),
            content: content.trim(),
            excerpt: generateExcerpt(content.trim()),
            author: simpleSanitize(author.trim()),
            tags: tags ? simpleSanitize(tags.trim()) : undefined,
            coverImage: coverImage ? simpleSanitize(coverImage.trim()) : undefined,
        });

        res.redirect("/");
    } catch (err) {
        next(err);
    }
});

// GET /posts/:id: View a single post
app.get("/posts/:id", async (req, res, next) => {
    try {
        const post = await getPostById(req.params.id);
        if (post) {
            const allPosts = await getAllPosts();
            const postTags = (post.tags || []).map(t => t.toLowerCase());
            const relatedPosts = allPosts
                .filter(p => String(p.id) !== String(post.id))
                .sort((a, b) => {
                    const aMatches = (a.tags || []).filter(t => postTags.includes(t.toLowerCase())).length;
                    const bMatches = (b.tags || []).filter(t => postTags.includes(t.toLowerCase())).length;
                    return bMatches - aMatches;
                })
                .slice(0, 3);

            res.render("post.ejs", { post, relatedPosts, user: req.user });
        } else {
            res.status(404).render("404.ejs", { message: "The requested post could not be found." });
        }
    } catch (err) {
        next(err);
    }
});

// GET /edit/:id: Show form to edit a post (Protected)
app.get("/edit/:id", requireAuth, async (req, res, next) => {
    try {
        const post = await getPostById(req.params.id);
        if (post) {
            res.render("edit.ejs", { post, user: req.user });
        } else {
            res.status(404).render("404.ejs", { message: "The post you wish to edit does not exist." });
        }
    } catch (err) {
        next(err);
    }
});

// POST /update/:id: Update an existing post (Protected)
app.post("/update/:id", requireAuth, async (req, res, next) => {
    try {
        const { title, content, author, tags, coverImage } = req.body;
        if (!title?.trim() || !content?.trim() || !author?.trim()) {
            return res.status(400).render("404.ejs", { message: "Title, author, and content cannot be empty." });
        }

        const updated = await updatePost(req.params.id, {
            title: simpleSanitize(title.trim()),
            content: content.trim(),
            excerpt: generateExcerpt(content.trim()),
            author: simpleSanitize(author.trim()),
            tags: tags ? simpleSanitize(tags.trim()) : undefined,
            coverImage: coverImage ? simpleSanitize(coverImage.trim()) : undefined,
        });

        if (updated) {
            res.redirect(`/posts/${req.params.id}`);
        } else {
            res.status(404).render("404.ejs", { message: "The post to update could not be found." });
        }
    } catch (err) {
        next(err);
    }
});

// POST /delete/:id: Delete a post (Protected)
app.post("/delete/:id", requireAuth, async (req, res, next) => {
    try {
        await deletePost(req.params.id);
        res.redirect("/");
    } catch (err) {
        next(err);
    }
});

// Fallback 404 handler for unknown routes
app.use((req, res) => {
    res.status(404).render("404.ejs", { message: "Page not found.", user: req.user });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).render("404.ejs", { message: "An unexpected error occurred. Please try again later.", user: req.user });
});

// Only listen locally — on Vercel, the app is exported for serverless
if (!process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}

module.exports = app;
