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
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));
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

const isVercel = Boolean(process.env.VERCEL);
const getStoragePath = (filename) => isVercel ? path.join("/tmp", filename) : path.join(__dirname, filename);
const getSeedPath = (filename) => path.join(__dirname, filename);

const readJSONSafe = async (filename, fallback = []) => {
    try {
        const primary = getStoragePath(filename);
        if (fsSync.existsSync(primary)) {
            const data = await fs.readFile(primary, "utf-8");
            return JSON.parse(data);
        }
        const seed = getSeedPath(filename);
        if (fsSync.existsSync(seed)) {
            const data = await fs.readFile(seed, "utf-8");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`Error reading ${filename}:`, e.message);
    }
    return fallback;
};

const writeJSONSafe = async (filename, data) => {
    try {
        const target = getStoragePath(filename);
        await fs.writeFile(target, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.error(`Error writing ${filename}:`, e.message);
    }
};

const UPLOADS_DIR = isVercel ? path.join("/tmp", "uploads") : path.join(__dirname, "public", "uploads");

try {
    if (!fsSync.existsSync(UPLOADS_DIR)) {
        fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
} catch (e) {
    console.warn("Uploads directory notice:", e.message);
}

const saveBase64Image = async (dataUrl, prefix, userId) => {
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return dataUrl;
    try {
        const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!matches || matches.length < 3) return dataUrl;
        let ext = matches[1];
        if (ext === "jpeg") ext = "jpg";
        if (ext.includes("+xml")) ext = "svg";
        const base64Data = matches[2];
        const safeUserId = String(userId || "user").replace(/[^a-zA-Z0-9_-]/g, "");
        const fileName = `${prefix}_${safeUserId}_${Date.now()}.${ext}`;
        const filePath = path.join(UPLOADS_DIR, fileName);
        await fs.writeFile(filePath, Buffer.from(base64Data, "base64"));
        return isVercel ? dataUrl : `/uploads/${fileName}`;
    } catch (e) {
        console.error("Error saving base64 image:", e);
        return dataUrl;
    }
};

// Local Auth Secret & Salt
const AUTH_SECRET = process.env.AUTH_SECRET || "miniblogs_secure_dev_secret_key_2026";

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

// Device & Browser Detection Helper
const parseDeviceInfo = (userAgent, ip) => {
    let os = "Unknown Device";
    let browser = "Web Browser";

    const ua = userAgent || "";
    if (/Windows NT 10.0/i.test(ua)) os = "Windows 11/10";
    else if (/Windows NT 6.3/i.test(ua)) os = "Windows 8.1";
    else if (/Windows/i.test(ua)) os = "Windows PC";
    else if (/iPhone/i.test(ua)) os = "iPhone";
    else if (/iPad/i.test(ua)) os = "iPad";
    else if (/Macintosh|Mac OS X/i.test(ua)) os = "macOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/Linux/i.test(ua)) os = "Linux";

    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/Brave/i.test(ua)) browser = "Brave";
    else if (/Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";

    let cleanIp = (ip || "127.0.0.1").replace(/^::ffff:/, "");
    if (cleanIp === "::1" || !cleanIp) cleanIp = "127.0.0.1";

    return {
        device: `${os} · ${browser}`,
        ip: cleanIp
    };
};

// Persistent Session Settings (1 Year Lifetime until Explicit Logout)
const SESSION_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 365 days in ms

const setSessionCookies = (res, accessToken, refreshToken = null) => {
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("auth_token", accessToken, {
        httpOnly: true,
        secure: isProd,
        maxAge: SESSION_COOKIE_MAX_AGE,
        sameSite: "lax",
        path: "/"
    });
    if (refreshToken) {
        res.cookie("refresh_token", refreshToken, {
            httpOnly: true,
            secure: isProd,
            maxAge: SESSION_COOKIE_MAX_AGE,
            sameSite: "lax",
            path: "/"
        });
    }
};

const setUserProfileCookie = (res, profile) => {
    if (!res || !profile) return;
    const isProd = process.env.NODE_ENV === "production";
    try {
        // Keep cookie under 3KB to prevent HTTP 502/431 header size overflows
        const safeAvatar = (profile.avatar && typeof profile.avatar === "string" && !profile.avatar.startsWith("data:")) ? profile.avatar : (profile.avatar?.startsWith("data:") && profile.avatar.length < 1500 ? profile.avatar : null);
        const safeCover = (profile.cover && typeof profile.cover === "string" && !profile.cover.startsWith("data:")) ? profile.cover : (profile.cover?.startsWith("data:") && profile.cover.length < 1500 ? profile.cover : null);

        const safeProfile = {
            id: profile.id,
            name: profile.name,
            username: profile.username,
            email: profile.email,
            phone: profile.phone || "",
            bio: profile.bio || "",
            avatar: safeAvatar,
            cover: safeCover,
            location: profile.location || "",
            website: profile.website || "",
            social: profile.social || { twitter: "" },
            badges: profile.badges || [],
            isPro: Boolean(profile.isPro),
            twoFactorEnabled: Boolean(profile.twoFactorEnabled),
            notifications: profile.notifications || { comments: true, followers: true, digest: true, push: false },
            privacy: profile.privacy || { isPublic: true, showBookmarks: true },
            updated_at: new Date().toISOString()
        };
        const encoded = Buffer.from(JSON.stringify(safeProfile)).toString("base64url");
        res.cookie("user_profile_data", encoded, {
            httpOnly: false,
            secure: isProd,
            maxAge: SESSION_COOKIE_MAX_AGE,
            sameSite: "lax",
            path: "/"
        });
    } catch (e) {
        console.error("Error setting user profile cookie:", e);
    }
};

const getProfileFromCookie = (req, userId, userEmail) => {
    if (!req?.cookies?.user_profile_data) return null;
    try {
        const json = Buffer.from(req.cookies.user_profile_data, "base64url").toString("utf-8");
        const profile = JSON.parse(json);
        if (profile && (
            (userId && profile.id === userId) ||
            (userEmail && profile.email && profile.email.toLowerCase() === userEmail.toLowerCase())
        )) {
            return profile;
        }
    } catch (e) {
        // Invalid or corrupted cookie
    }
    return null;
};

const generateLocalToken = (user) => {
    const payload = Buffer.from(JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        sessionVersion: user.sessionVersion || 1,
        sessionId: user.sessionId || crypto.randomBytes(8).toString("hex"),
        exp: Date.now() + SESSION_COOKIE_MAX_AGE
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
    return readJSONSafe("users.json", []);
};

const writeLocalUsers = async (users) => {
    return writeJSONSafe("users.json", users);
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

// --- LIGHTNING-FAST HIGH-PERFORMANCE CACHE & PERSISTENCE ENGINE ---
const memoryCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60s memory cache TTL

const readSystemState = async (key, fallback) => {
    const filename = `${key.toLowerCase()}.json`;
    const cached = memoryCache.get(key);
    const now = Date.now();

    // 1. Instant RAM Cache Hit (< 0.1ms response time)
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }

    // 2. Fast local disk cache read (~0.5ms)
    let localData = cached ? cached.data : await readJSONSafe(filename, null);
    if (localData !== null) {
        memoryCache.set(key, { data: localData, timestamp: now });
        // Background revalidate from Supabase asynchronously without blocking user response
        if (supabase && (!cached || now - cached.timestamp >= CACHE_TTL_MS)) {
            setImmediate(async () => {
                try {
                    const systemTitle = `__SYSTEM_${key.toUpperCase()}__`;
                    const { data } = await supabase
                        .from("posts")
                        .select("content")
                        .eq("title", systemTitle)
                        .maybeSingle();
                    if (data?.content) {
                        const parsed = JSON.parse(data.content);
                        memoryCache.set(key, { data: parsed, timestamp: Date.now() });
                        await writeJSONSafe(filename, parsed);
                    }
                } catch (e) {}
            });
        }
        return localData;
    }

    // 3. Cold Start Supabase Fetch (only if zero local cache)
    if (supabase) {
        try {
            const systemTitle = `__SYSTEM_${key.toUpperCase()}__`;
            const { data, error } = await supabase
                .from("posts")
                .select("content")
                .eq("title", systemTitle)
                .maybeSingle();

            if (!error && data?.content) {
                const parsed = JSON.parse(data.content);
                memoryCache.set(key, { data: parsed, timestamp: Date.now() });
                await writeJSONSafe(filename, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn(`Supabase readSystemState cold fetch error for ${key}:`, e.message);
        }
    }

    const finalData = fallback;
    memoryCache.set(key, { data: finalData, timestamp: now });
    return finalData;
};

const writeSystemState = async (key, data) => {
    const filename = `${key.toLowerCase()}.json`;
    // 1. Instant RAM update (< 0.1ms) - user gets instant UI update
    memoryCache.set(key, { data, timestamp: Date.now() });

    // 2. Fast local disk write (non-blocking)
    writeJSONSafe(filename, data).catch(() => {});

    // 3. Non-blocking asynchronous Supabase sync in background
    if (supabase) {
        setImmediate(async () => {
            try {
                const systemTitle = `__SYSTEM_${key.toUpperCase()}__`;
                const { data: existing } = await supabase
                    .from("posts")
                    .select("id")
                    .eq("title", systemTitle)
                    .maybeSingle();

                if (existing?.id) {
                    await supabase
                        .from("posts")
                        .update({
                            content: JSON.stringify(data),
                            excerpt: `System ${key} State`,
                            author: "__SYSTEM__"
                        })
                        .eq("id", existing.id);
                } else {
                    await supabase
                        .from("posts")
                        .insert([{
                            title: systemTitle,
                            content: JSON.stringify(data),
                            excerpt: `System ${key} State`,
                            author: "__SYSTEM__"
                        }]);
                }
            } catch (e) {
                console.warn(`Background Supabase writeSystemState error for ${key}:`, e.message);
            }
        });
    }
};

const readFollows = async () => {
    return readSystemState("FOLLOWS", []);
};

const writeFollows = async (follows) => {
    return writeSystemState("FOLLOWS", follows);
};

const readBookmarks = async () => {
    return readSystemState("BOOKMARKS", []);
};

const writeBookmarks = async (bookmarks) => {
    return writeSystemState("BOOKMARKS", bookmarks);
};

const readAnalytics = async () => {
    const data = await readSystemState("ANALYTICS", { views: {}, claps: {}, unique_views: {} });
    return {
        views: data.views || {},
        claps: data.claps || {},
        unique_views: data.unique_views || {}
    };
};

const writeAnalytics = async (analytics) => {
    return writeSystemState("ANALYTICS", analytics);
};

// --- PROFILES, SOCIAL & BOOKMARKS HELPERS ---
const readProfiles = async () => {
    return readSystemState("PROFILES", []);
};

const writeProfiles = async (profiles) => {
    return writeSystemState("PROFILES", profiles);
};

// --- Supabase DB profile persistence (works across Vercel instances) ---
let profilesTableExists = null; // null = unknown, true/false = cached result

const readProfileFromDB = async (userId) => {
    if (!userId) return null;
    const profiles = await readProfiles();
    return profiles.find(p => p.id === userId || (p.email && p.email.toLowerCase() === String(userId).toLowerCase())) || null;
};

const writeProfileToDB = async (profile) => {
    if (!profile?.id) return false;
    const profiles = await readProfiles();
    const idx = profiles.findIndex(p => p.id === profile.id || (profile.email && p.email && p.email.toLowerCase() === profile.email.toLowerCase()));
    if (idx >= 0) {
        profiles[idx] = { ...profiles[idx], ...profile, updated_at: new Date().toISOString() };
    } else {
        profiles.push({ ...profile, updated_at: new Date().toISOString() });
    }
    await writeProfiles(profiles);
    return true;
};

const recordPostView = async (postId, req = null, res = null) => {
    if (!postId) return 0;
    try {
        const analytics = await readAnalytics();
        const key = String(postId);
        if (!analytics.views[key]) analytics.views[key] = 0;
        if (!analytics.unique_views[key]) analytics.unique_views[key] = [];

        // Determine unique reader identifier (User ID > User Email > Persistent Browser Reader ID)
        let readerId = req?.user?.id || req?.user?.email;
        if (!readerId && req?.cookies?.blog_reader_id) {
            readerId = req.cookies.blog_reader_id;
        }

        // If new visitor, generate persistent 1-year reader cookie
        if (!readerId) {
            readerId = "r_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
            if (res) {
                const isProd = process.env.NODE_ENV === "production";
                res.cookie("blog_reader_id", readerId, {
                    maxAge: 365 * 24 * 60 * 60 * 1000,
                    httpOnly: true,
                    secure: isProd,
                    sameSite: "lax",
                    path: "/"
                });
            }
        }

        // Only count read if this person has not viewed this story yet
        const alreadyViewed = analytics.unique_views[key].includes(readerId);
        if (!alreadyViewed) {
            analytics.unique_views[key].push(readerId);
            analytics.views[key] = analytics.unique_views[key].length;
            await writeAnalytics(analytics);
        }

        return analytics.views[key];
    } catch (e) {
        console.error("Error recording unique post view:", e);
        return 0;
    }
};

const recordPostClap = async (postId, count = 1) => {
    if (!postId) return 0;
    try {
        const analytics = await readAnalytics();
        const key = String(postId);
        analytics.claps[key] = (analytics.claps[key] || 0) + count;
        await writeAnalytics(analytics);
        return analytics.claps[key];
    } catch (e) {
        console.error("Error recording post clap:", e);
        return 0;
    }
};

const getOrCreateProfile = async (user, req = null) => {
    if (!user) return null;

    // 1. Try browser profile cookie first (fastest, 100% persistent across Vercel serverless requests)
    if (req) {
        const cookieProfile = getProfileFromCookie(req, user.id, user.email);
        if (cookieProfile) {
            cookieProfile.id = user.id;
            if (user.email) cookieProfile.email = user.email;
            if (!cookieProfile.social) cookieProfile.social = {};
            // Enrich cover/avatar from local profiles if cookie omitted huge data URLs
            if (!cookieProfile.cover || !cookieProfile.avatar) {
                try {
                    const profiles = await readProfiles();
                    const diskProfile = profiles.find(p => p.id === user.id || (user.email && p.email && p.email.toLowerCase() === user.email.toLowerCase()));
                    if (diskProfile) {
                        if (!cookieProfile.cover && diskProfile.cover) cookieProfile.cover = diskProfile.cover;
                        if (!cookieProfile.avatar && diskProfile.avatar) cookieProfile.avatar = diskProfile.avatar;
                    }
                } catch (e) {}
            }
            return cookieProfile;
        }
    }

    // 2. Try Supabase DB (persistent across all Vercel instances if table exists)
    const dbProfile = await readProfileFromDB(user.id);
    if (dbProfile) {
        dbProfile.id = user.id;
        if (user.email) dbProfile.email = user.email;
        if (!dbProfile.social) dbProfile.social = {};
        return dbProfile;
    }

    // 3. Fall back to local JSON file
    const profiles = await readProfiles();
    let profile = profiles.find(p => p.id === user.id || (user.email && p.email && p.email.toLowerCase() === user.email.toLowerCase()));

    const meta = user.user_metadata || {};
    const metaSocial = meta.social || (meta.twitter ? { twitter: meta.twitter } : null);

    if (!profile) {
        const usernameBase = meta.username || (user.email ? user.email.split("@")[0] : user.name || "author").toLowerCase().replace(/[^a-z0-9_]/g, "");
        profile = {
            id: user.id,
            name: meta.name || meta.display_name || user.name || "Author",
            username: usernameBase,
            email: user.email || "",
            phone: meta.phone || "",
            bio: meta.bio || "",
            avatar: meta.avatar || user.avatar || null,
            cover: meta.cover || null,
            location: meta.location || "",
            website: meta.website || "",
            social: metaSocial || { twitter: "" },
            badges: meta.badges || [],
            isPro: Boolean(meta.isPro),
            twoFactorEnabled: false,
            notifications: meta.notifications || { comments: true, followers: true, digest: true, push: false },
            privacy: meta.privacy || { isPublic: true, showBookmarks: true },
            created_at: new Date().toISOString()
        };
        profiles.push(profile);
        await writeProfiles(profiles);
        // Also attempt to persist to DB for future Vercel instances
        await writeProfileToDB(profile);
    } else {
        if (!profile.social) profile.social = metaSocial || {};
        if (user.avatar && !profile.avatar) profile.avatar = user.avatar;
    }
    return profile;
};

const getProfileByIdentifier = async (identifier, req = null) => {
    if (!identifier) return null;
    const rawId = decodeURIComponent(String(identifier)).replace(/^@/, "").trim();
    const cleanId = rawId.toLowerCase();
    const strippedId = cleanId.replace(/^user_/, "");

    // Try browser profile cookie if inspecting own profile
    if (req) {
        const cookieProfile = getProfileFromCookie(req, rawId, rawId);
        if (cookieProfile) return cookieProfile;
    }

    // Try Supabase DB
    const dbProfile = await readProfileFromDB(rawId) || (strippedId !== rawId ? await readProfileFromDB(strippedId) : null);
    if (dbProfile) return dbProfile;

    const profiles = await readProfiles();
    let profile = profiles.find(p => 
        (p.id && (String(p.id).toLowerCase() === cleanId || String(p.id).toLowerCase() === strippedId)) || 
        (p.username && (p.username.toLowerCase() === cleanId || p.username.toLowerCase() === strippedId)) || 
        (p.name && (p.name.toLowerCase() === cleanId || p.name.toLowerCase() === strippedId)) || 
        (p.email && (p.email.toLowerCase() === cleanId || p.email.toLowerCase().startsWith(cleanId) || p.email.toLowerCase().startsWith(strippedId)))
    );

    if (!profile) {
        const users = await readLocalUsers();
        const user = users.find(u => 
            (u.id && (String(u.id).toLowerCase() === cleanId || String(u.id).toLowerCase() === strippedId)) || 
            (u.name && (u.name.toLowerCase() === cleanId || u.name.toLowerCase() === strippedId)) || 
            (u.email && (u.email.toLowerCase().startsWith(cleanId) || u.email.toLowerCase().startsWith(strippedId)))
        );
        if (user) {
            return await getOrCreateProfile(user, req);
        }
    }

    // Fallback: If this is an author from existing posts, generate an author profile dynamically
    if (!profile) {
        const allPosts = await getAllPosts();
        const authorPost = allPosts.find(p => 
            (p.author && (p.author.toLowerCase() === cleanId || p.author.toLowerCase() === strippedId)) ||
            (p.author_id && (String(p.author_id).toLowerCase() === cleanId || String(p.author_id).toLowerCase() === strippedId)) ||
            (p.author_username && (p.author_username.toLowerCase() === cleanId || p.author_username.toLowerCase() === strippedId))
        );
        if (authorPost) {
            profile = {
                id: authorPost.author_id || authorPost.author || strippedId,
                name: authorPost.author || (strippedId.charAt(0).toUpperCase() + strippedId.slice(1)),
                username: authorPost.author_username || (authorPost.author || strippedId).toLowerCase().replace(/[^a-z0-9_]/g, ""),
                email: authorPost.author_email || "",
                bio: "Storyteller & Creator on BlogSite.",
                avatar: null,
                cover: null,
                social: {},
                badges: ["Author"]
            };
        } else if (cleanId.length > 0) {
            // General dynamic profile fallback for any community member
            const displayHandle = strippedId.charAt(0).toUpperCase() + strippedId.slice(1);
            profile = {
                id: strippedId,
                name: displayHandle,
                username: strippedId,
                email: "",
                bio: "Community Member on BlogSite.",
                avatar: null,
                cover: null,
                social: {},
                badges: ["Reader"]
            };
        }
    }

    return profile;
};

// --- AUTH SESSION DETECTION MIDDLEWARE ---
app.use(async (req, res, next) => {
    const token = req.cookies?.auth_token || req.headers?.authorization?.replace("Bearer ", "");
    const refreshToken = req.cookies?.refresh_token;
    req.user = null;
    res.locals.user = null;

    if (token) {
        if (supabase) {
            try {
                const { data: { user }, error } = await supabase.auth.getUser(token);
                if (user && !error) {
                    const isGoogle = user.app_metadata?.provider === "google" ||
                                     (Array.isArray(user.identities) && user.identities.some(i => i.provider === "google")) ||
                                     Boolean(user.user_metadata?.iss?.includes("google") || user.user_metadata?.avatar_url?.includes("googleusercontent.com") || user.user_metadata?.picture?.includes("googleusercontent.com"));

                    req.user = {
                        id: user.id,
                        email: user.email,
                        name: user.user_metadata?.name || user.user_metadata?.display_name || user.user_metadata?.full_name || (user.email ? user.email.split("@")[0] : "Author"),
                        avatar: user.user_metadata?.avatar || user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
                        username: user.user_metadata?.username || null,
                        user_metadata: user.user_metadata || {},
                        isGoogleUser: isGoogle,
                        provider: isGoogle ? "google" : (user.app_metadata?.provider || "email")
                    };
                    res.locals.user = req.user;
                } else if (refreshToken) {
                    // Token expired; transparently refresh session using persistent refresh token
                    try {
                        const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
                        if (refreshData?.session && !refreshErr && refreshData.user) {
                            const refreshedUser = refreshData.user;
                            const isGoogle = refreshedUser.app_metadata?.provider === "google" ||
                                             (Array.isArray(refreshedUser.identities) && refreshedUser.identities.some(i => i.provider === "google")) ||
                                             Boolean(refreshedUser.user_metadata?.iss?.includes("google") || refreshedUser.user_metadata?.avatar_url?.includes("googleusercontent.com") || refreshedUser.user_metadata?.picture?.includes("googleusercontent.com"));

                            req.user = {
                                id: refreshedUser.id,
                                email: refreshedUser.email,
                                name: refreshedUser.user_metadata?.name || refreshedUser.user_metadata?.display_name || refreshedUser.user_metadata?.full_name || (refreshedUser.email ? refreshedUser.email.split("@")[0] : "Author"),
                                avatar: refreshedUser.user_metadata?.avatar || refreshedUser.user_metadata?.avatar_url || refreshedUser.user_metadata?.picture || null,
                                username: refreshedUser.user_metadata?.username || null,
                                user_metadata: refreshedUser.user_metadata || {},
                                isGoogleUser: isGoogle,
                                provider: isGoogle ? "google" : (refreshedUser.app_metadata?.provider || "email")
                            };
                            res.locals.user = req.user;
                            setSessionCookies(res, refreshData.session.access_token, refreshData.session.refresh_token);
                        }
                    } catch (re) {
                        // Refresh attempt failed
                    }
                }
            } catch (e) {
                // Ignore Supabase getUser error
            }
        }
        if (!req.user) {
            const localUser = verifyLocalToken(token);
            if (localUser) {
                const users = await readLocalUsers();
                const storedUser = users.find(u => u.id === localUser.id || (u.email && localUser.email && u.email.toLowerCase() === localUser.email.toLowerCase()));
                if (!storedUser || !storedUser.sessionVersion || (localUser.sessionVersion || 1) >= (storedUser.sessionVersion || 1)) {
                    req.user = localUser;
                    res.locals.user = localUser;
                }
            }
        }

        // Enrich authenticated user with their up-to-date saved profile information (name, avatar, username)
        if (req.user) {
            try {
                // 1. Try cookie profile first (fastest, 100% persistent across all Vercel instances)
                let profile = getProfileFromCookie(req, req.user.id, req.user.email);

                // 2. Try DB
                if (!profile) {
                    profile = await readProfileFromDB(req.user.id);
                }

                // 3. Try local JSON / seed
                if (!profile) {
                    const profiles = await readProfiles();
                    profile = profiles.find(p => p.id === req.user.id || (req.user.email && p.email && p.email.toLowerCase() === req.user.email.toLowerCase()));
                }

                // 4. If still not loaded, load/create profile
                if (!profile) {
                    profile = await getOrCreateProfile(req.user, req);
                }

                if (profile) {
                    if (profile.name) req.user.name = profile.name;
                    if (profile.avatar) req.user.avatar = profile.avatar;
                    if (profile.username) req.user.username = profile.username;
                    req.user.profile = profile;
                    res.locals.user = req.user;

                    // Automatically restore profile cookie if missing so subsequent requests have it
                    if (!req.cookies?.user_profile_data) {
                        setUserProfileCookie(res, profile);
                    }
                }
            } catch (err) {
                console.error("Error syncing profile info into req.user:", err);
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

// Helper: Extract cover image and clean content + author metadata
const extractCoverAndCleanContent = (rawContent) => {
    if (!rawContent) return { cleanContent: "", coverImage: null, authorId: null, authorEmail: null, authorUsername: null };
    let content = rawContent;
    let coverImage = null;
    let authorId = null;
    let authorEmail = null;
    let authorUsername = null;

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

    // Check for author tags
    const authorIdMatch = content.match(/<!--\s*AUTHOR_ID:\s*([\s\S]*?)\s*-->/);
    if (authorIdMatch) {
        authorId = authorIdMatch[1].trim();
        content = content.replace(/<!--\s*AUTHOR_ID:\s*[\s\S]*?\s*-->/, "").trim();
    }
    const authorEmailMatch = content.match(/<!--\s*AUTHOR_EMAIL:\s*([\s\S]*?)\s*-->/);
    if (authorEmailMatch) {
        authorEmail = authorEmailMatch[1].trim();
        content = content.replace(/<!--\s*AUTHOR_EMAIL:\s*[\s\S]*?\s*-->/, "").trim();
    }
    const authorUsernameMatch = content.match(/<!--\s*AUTHOR_USERNAME:\s*([\s\S]*?)\s*-->/);
    if (authorUsernameMatch) {
        authorUsername = authorUsernameMatch[1].trim();
        content = content.replace(/<!--\s*AUTHOR_USERNAME:\s*[\s\S]*?\s*-->/, "").trim();
    }

    return { cleanContent: content, coverImage, authorId, authorEmail, authorUsername };
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
    const { cleanContent, coverImage: embeddedCover, authorId: embeddedAuthorId, authorEmail: embeddedAuthorEmail, authorUsername: embeddedAuthorUsername } = extractCoverAndCleanContent(post.content || "");
    const words = cleanContent ? cleanContent.trim().split(/\s+/).filter(Boolean).length : 0;
    const readingTime = Math.max(1, Math.ceil(words / 180));
    const tags = extractTags(post);
    const imgMatch = cleanContent ? cleanContent.match(/<img[^>]+src=["']([^"']+)["']/i) : null;
    const thumbnail = post.coverImage || post.cover_image || embeddedCover || (imgMatch ? imgMatch[1] : null);
    const primaryTag = (tags && tags.length > 0) ? tags[0].toLowerCase() : "thoughts";

    return {
        ...post,
        content: cleanContent,
        rawContent: post.content || "",
        author_id: post.author_id || post.authorId || embeddedAuthorId || null,
        author_email: post.author_email || post.authorEmail || embeddedAuthorEmail || null,
        author_username: post.author_username || post.authorUsername || embeddedAuthorUsername || null,
        date: formattedDate || new Date().toLocaleDateString(),
        readingTime,
        words,
        tags,
        thumbnail,
        coverImage: thumbnail,
        topicTheme: primaryTag,
    };
};

// Helper: Check if a user is the author/owner of a post
const isUserPostAuthor = (user, post, profile = null) => {
    if (!user || !post) return false;
    const userId = String(user.id || "").toLowerCase();
    const userEmail = String(user.email || "").toLowerCase();
    const userName = String(profile?.name || user.name || "").toLowerCase().trim();
    const userUsername = String(profile?.username || user.username || "").toLowerCase().trim();

    const postAuthorId = String(post.author_id || post.authorId || "").toLowerCase();
    const postAuthorEmail = String(post.author_email || post.authorEmail || "").toLowerCase();
    const postAuthor = String(post.author || "").toLowerCase().trim();

    // 1. Direct Author ID match
    if (userId && postAuthorId && userId === postAuthorId) return true;

    // 2. Direct Author Email match
    if (userEmail && postAuthorEmail && userEmail === postAuthorEmail) return true;

    // 3. Name or Username match
    if (userName && postAuthor && (postAuthor === userName || postAuthor === userUsername)) return true;

    // 4. Raw embedded content match
    const rawContent = String(post.rawContent || post.content || "");
    if (userId && rawContent.includes(`<!-- AUTHOR_ID: ${userId} -->`)) return true;
    if (userEmail && rawContent.includes(`<!-- AUTHOR_EMAIL: ${userEmail} -->`)) return true;

    return false;
};

// Helper: Generate fallback ID for local offline development
const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
};

// Local JSON File helpers (Asynchronous)
const readLocalPosts = async () => {
    return readJSONSafe("data.json", []);
};

const writeLocalPosts = async (posts) => {
    return writeJSONSafe("data.json", posts);
};

// =========================================
// Data Layer (Supabase PostgreSQL + RAM Cache + Local JSON Cache Fallback)
// =========================================

let postsCache = { data: null, timestamp: 0 };
const POSTS_CACHE_TTL = 15 * 1000; // 15s in-memory cache

const invalidatePostsCache = () => {
    postsCache = { data: null, timestamp: 0 };
};

const getAllPosts = async () => {
    const now = Date.now();
    if (postsCache.data && (now - postsCache.timestamp < POSTS_CACHE_TTL)) {
        return postsCache.data;
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .select("*")
                .not("title", "like", "__SYSTEM_%")
                .neq("author", "__SYSTEM__")
                .order("created_at", { ascending: false });
            if (!error && data) {
                const formatted = data
                    .filter(p => !p.title?.startsWith("__SYSTEM_") && p.author !== "__SYSTEM__")
                    .map(formatPost);
                postsCache = { data: formatted, timestamp: now };
                return formatted;
            }
        } catch (e) {
            console.warn("Supabase getAllPosts fetch fallback:", e.message);
        }
    }
    const localPosts = await readLocalPosts();
    const formatted = localPosts
        .filter(p => !p.title?.startsWith("__SYSTEM_") && p.author !== "__SYSTEM__")
        .map(formatPost);
    postsCache = { data: formatted, timestamp: now };
    return formatted;
};

const getPostById = async (id) => {
    if (postsCache.data) {
        const cachedPost = postsCache.data.find(p => String(p.id) === String(id));
        if (cachedPost) return cachedPost;
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .select("*")
                .eq("id", id)
                .single();
            if (!error && data && !data.title?.startsWith("__SYSTEM_") && data.author !== "__SYSTEM__") {
                return formatPost(data);
            }
        } catch (e) {}
    }
    const localPosts = await readLocalPosts();
    const post = localPosts.find((p) => String(p.id) === String(id));
    if (post && (post.title?.startsWith("__SYSTEM_") || post.author === "__SYSTEM__")) return null;
    return post ? formatPost(post) : null;
};

const createPost = async ({ title, content, excerpt, author, tags, coverImage, authorId, authorEmail, authorUsername }) => {
    const cleanTags = Array.isArray(tags) ? tags : (typeof tags === "string" ? tags.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean) : []);
    const cleanCover = coverImage && typeof coverImage === "string" && coverImage.trim() ? coverImage.trim() : undefined;

    let contentWithMetadata = content || "";
    if (authorId) {
        contentWithMetadata = `<!-- AUTHOR_ID: ${authorId} -->\n` + contentWithMetadata;
    }
    if (authorEmail) {
        contentWithMetadata = `<!-- AUTHOR_EMAIL: ${authorEmail} -->\n` + contentWithMetadata;
    }
    if (authorUsername) {
        contentWithMetadata = `<!-- AUTHOR_USERNAME: ${authorUsername} -->\n` + contentWithMetadata;
    }
    if (cleanCover) {
        contentWithMetadata = `<!-- COVER_IMAGE: ${cleanCover} -->\n` + contentWithMetadata;
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .insert([{ title, content: contentWithMetadata, excerpt, author, tags: cleanTags, cover_image: cleanCover, author_id: authorId }])
                .select()
                .single();
            if (!error && data) return formatPost(data);
        } catch (e) {}

        try {
            const { data, error } = await supabase
                .from("posts")
                .insert([{ title, content: contentWithMetadata, excerpt, author, tags: cleanTags, cover_image: cleanCover }])
                .select()
                .single();
            if (!error && data) return formatPost(data);
        } catch (e) {}

        try {
            const { data, error } = await supabase
                .from("posts")
                .insert([{ title, content: contentWithMetadata, excerpt, author, tags: cleanTags }])
                .select()
                .single();
            if (!error && data) return formatPost({ ...data, coverImage: cleanCover });
        } catch (e) {}

        const { data, error } = await supabase
            .from("posts")
            .insert([{ title, content: contentWithMetadata, excerpt, author }])
            .select()
            .single();
        invalidatePostsCache();
        if (error) throw error;
        return formatPost({ ...data, tags: cleanTags, coverImage: cleanCover });
    }
    const localPosts = await readLocalPosts();
    const newPost = {
        id: generateId(),
        title,
        content: contentWithMetadata,
        excerpt,
        author,
        author_id: authorId,
        author_email: authorEmail,
        author_username: authorUsername,
        tags: cleanTags.length > 0 ? cleanTags : undefined,
        coverImage: cleanCover,
        created_at: new Date().toISOString(),
        date: new Date().toLocaleDateString(),
    };
    localPosts.unshift(newPost);
    await writeLocalPosts(localPosts);
    invalidatePostsCache();
    return formatPost(newPost);
};

const updatePost = async (id, { title, content, excerpt, author, tags, coverImage, authorId, authorEmail, authorUsername }) => {
    const cleanTags = Array.isArray(tags) ? tags : (typeof tags === "string" ? tags.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean) : []);
    const cleanCover = coverImage && typeof coverImage === "string" && coverImage.trim() ? coverImage.trim() : undefined;

    let contentWithMetadata = content || "";
    if (authorId) {
        contentWithMetadata = `<!-- AUTHOR_ID: ${authorId} -->\n` + contentWithMetadata;
    }
    if (authorEmail) {
        contentWithMetadata = `<!-- AUTHOR_EMAIL: ${authorEmail} -->\n` + contentWithMetadata;
    }
    if (authorUsername) {
        contentWithMetadata = `<!-- AUTHOR_USERNAME: ${authorUsername} -->\n` + contentWithMetadata;
    }
    if (cleanCover) {
        contentWithMetadata = `<!-- COVER_IMAGE: ${cleanCover} -->\n` + contentWithMetadata;
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .update({ title, content: contentWithMetadata, excerpt, author, tags: cleanTags, cover_image: cleanCover, author_id: authorId })
                .eq("id", id)
                .select()
                .single();
            invalidatePostsCache();
            if (!error && data) return formatPost(data);
        } catch (e) {}

        try {
            const { data, error } = await supabase
                .from("posts")
                .update({ title, content: contentWithMetadata, excerpt, author, tags: cleanTags, cover_image: cleanCover })
                .eq("id", id)
                .select()
                .single();
            invalidatePostsCache();
            if (!error && data) return formatPost(data);
        } catch (e) {}

        try {
            const { data, error } = await supabase
                .from("posts")
                .update({ title, content: contentWithMetadata, excerpt, author, tags: cleanTags })
                .eq("id", id)
                .select()
                .single();
            invalidatePostsCache();
            if (!error && data) return formatPost({ ...data, coverImage: cleanCover });
        } catch (e) {}

        const { data, error } = await supabase
            .from("posts")
            .update({ title, content: contentWithMetadata, excerpt, author })
            .eq("id", id)
            .select()
            .single();
        invalidatePostsCache();
        if (error) throw error;
        return formatPost({ ...data, tags: cleanTags, coverImage: cleanCover });
    }
    const localPosts = await readLocalPosts();
    const index = localPosts.findIndex((p) => String(p.id) === String(id));
    if (index !== -1) {
        localPosts[index] = {
            ...localPosts[index],
            title,
            content: contentWithMetadata,
            excerpt,
            author,
            author_id: authorId || localPosts[index].author_id,
            author_email: authorEmail || localPosts[index].author_email,
            author_username: authorUsername || localPosts[index].author_username,
            tags: cleanTags.length > 0 ? cleanTags : undefined,
            coverImage: cleanCover,
        };
        await writeLocalPosts(localPosts);
        invalidatePostsCache();
        return formatPost(localPosts[index]);
    }
    return null;
};

const deletePost = async (id) => {    if (supabase) {
        try {
            const { error } = await supabase.from("posts").delete().eq("id", id);
            invalidatePostsCache();
            if (!error) return true;
        } catch (e) {}
    }
    const localPosts = await readLocalPosts();
    const filteredPosts = localPosts.filter((p) => String(p.id) !== String(id));
    await writeLocalPosts(filteredPosts);
    invalidatePostsCache();
    return true;
};;

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
                setSessionCookies(res, data.session.access_token, data.session.refresh_token);
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
        setSessionCookies(res, token);

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
        const { email, password } = req.body;
        if (!email?.trim() || !password) {
            return res.status(400).json({ error: "Please enter both email and password." });
        }

        if (supabase) {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password: password
            });

            if (error) {
                return res.status(400).json({ error: error.message });
            }

            if (data.session) {
                const userName = data.user.user_metadata?.display_name || data.user.user_metadata?.name || data.user.email.split("@")[0];
                setSessionCookies(res, data.session.access_token, data.session.refresh_token);

                return res.json({
                    success: true,
                    message: "Signed in successfully!",
                    user: {
                        id: data.user.id,
                        email: data.user.email,
                        name: userName
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
        setSessionCookies(res, token);

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
    res.clearCookie("refresh_token", { path: "/" });
    res.clearCookie("user_profile_data", { path: "/" });
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
                setSessionCookies(res, data.session.access_token, data.session.refresh_token);
                const profile = await getOrCreateProfile(data.session.user, req);
                if (profile) {
                    setUserProfileCookie(res, profile);
                }
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
app.post("/api/auth/session", async (req, res) => {
    const { token, refreshToken } = req.body;
    if (token) {
        setSessionCookies(res, token, refreshToken);
        if (supabase) {
            try {
                const { data: { user } } = await supabase.auth.getUser(token);
                if (user) {
                    const profile = await getOrCreateProfile(user, req);
                    if (profile) {
                        setUserProfileCookie(res, profile);
                    }
                }
            } catch (e) {
                // Ignore
            }
        }
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
const getUserNetwork = async (profileId, currentUserId = null) => {
    const [follows, profiles, users, allPosts] = await Promise.all([
        readFollows(),
        readProfiles(),
        readLocalUsers(),
        getAllPosts()
    ]);

    const findProfile = (id) => {
        const cleanId = String(id || "").toLowerCase();
        const strippedId = cleanId.replace(/^user_/, "");

        let p = profiles.find(pr => 
            (pr.id && (String(pr.id).toLowerCase() === cleanId || String(pr.id).toLowerCase() === strippedId)) ||
            (pr.username && (pr.username.toLowerCase() === cleanId || pr.username.toLowerCase() === strippedId)) ||
            (pr.name && (pr.name.toLowerCase() === cleanId || pr.name.toLowerCase() === strippedId)) ||
            (pr.email && pr.email.toLowerCase() === cleanId)
        );
        if (!p) {
            const u = users.find(usr => 
                (usr.id && (String(usr.id).toLowerCase() === cleanId || String(usr.id).toLowerCase() === strippedId)) ||
                (usr.name && (usr.name.toLowerCase() === cleanId || usr.name.toLowerCase() === strippedId)) ||
                (usr.email && usr.email.toLowerCase() === cleanId)
            );
            if (u) {
                p = {
                    id: u.id,
                    name: u.name || u.email.split("@")[0],
                    username: u.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, ""),
                    email: u.email,
                    avatar: null,
                    bio: "Creator on BlogSite"
                };
            }
        }
        if (!p) {
            const authorPost = allPosts.find(ap => 
                (ap.author && (ap.author.toLowerCase() === cleanId || ap.author.toLowerCase() === strippedId)) ||
                (ap.author_id && (String(ap.author_id).toLowerCase() === cleanId || String(ap.author_id).toLowerCase() === strippedId)) ||
                (ap.author_username && (ap.author_username.toLowerCase() === cleanId || ap.author_username.toLowerCase() === strippedId))
            );
            if (authorPost) {
                p = {
                    id: authorPost.author_id || authorPost.author || strippedId,
                    name: authorPost.author || (strippedId.charAt(0).toUpperCase() + strippedId.slice(1)),
                    username: authorPost.author_username || (authorPost.author || strippedId).toLowerCase().replace(/[^a-z0-9_]/g, ""),
                    email: authorPost.author_email || "",
                    avatar: null,
                    bio: "Storyteller & Creator on BlogSite."
                };
            }
        }
        const displayName = p?.name || (strippedId.charAt(0).toUpperCase() + strippedId.slice(1)) || "Author";
        const displayUsername = p?.username || strippedId || (String(id).toLowerCase().replace(/[^a-z0-9_]/g, ""));
        return p || {
            id: strippedId || id,
            name: displayName,
            username: displayUsername,
            avatar: null,
            bio: "Community Member on BlogSite."
        };
    };

    // People following profileId
    const followerRecords = follows.filter(f => f.followingId === profileId);
    // People profileId is following
    const followingRecords = follows.filter(f => f.followerId === profileId);

    const followers = followerRecords.map(f => {
        const p = findProfile(f.followerId);
        // Is mutual friend: profileId also follows this person
        const isMutualFriend = followingRecords.some(fg => fg.followingId === f.followerId);
        const isFollowedByCurrentUser = currentUserId ? follows.some(cf => cf.followerId === currentUserId && cf.followingId === p.id) : false;
        return {
            id: p.id,
            name: p.name,
            username: p.username || (p.name || "user").toLowerCase().replace(/[^a-z0-9_]/g, ""),
            avatar: p.avatar || null,
            bio: p.bio || "",
            isFriend: isMutualFriend,
            isFollowedByCurrentUser,
            isSelf: currentUserId ? (currentUserId === p.id) : false
        };
    });

    const following = followingRecords.map(f => {
        const p = findProfile(f.followingId);
        // Is mutual friend: this person also follows profileId
        const isMutualFriend = followerRecords.some(fr => fr.followerId === f.followingId);
        const isFollowedByCurrentUser = currentUserId ? follows.some(cf => cf.followerId === currentUserId && cf.followingId === p.id) : false;
        return {
            id: p.id,
            name: p.name,
            username: p.username || (p.name || "user").toLowerCase().replace(/[^a-z0-9_]/g, ""),
            avatar: p.avatar || null,
            bio: p.bio || "",
            isFriend: isMutualFriend,
            isFollowedByCurrentUser,
            isSelf: currentUserId ? (currentUserId === p.id) : false
        };
    });

    return { followers, following };
};

// GET /profile: View Current Authenticated User's Profile
app.get("/profile", requireAuth, async (req, res, next) => {
    try {
        const profile = await getOrCreateProfile(req.user, req);
        setUserProfileCookie(res, profile);

        const [allPosts, bookmarksData, follows, network, analytics] = await Promise.all([
            getAllPosts(),
            readBookmarks(),
            readFollows(),
            getUserNetwork(profile.id, req.user?.id),
            readAnalytics()
        ]);

        const publishedPosts = allPosts.filter(p => {
            return (p.author && profile.name && p.author.toLowerCase() === profile.name.toLowerCase()) ||
                   (p.author && profile.username && p.author.toLowerCase() === profile.username.toLowerCase()) ||
                   (p.author_id && p.author_id === profile.id);
        });

        const drafts = [];
        const userBookmarks = bookmarksData.filter(b => b.userId === req.user.id);
        const bookmarks = userBookmarks.map(b => {
            const post = allPosts.find(p => String(p.id) === String(b.postId));
            return post ? { ...post, snippet: post.excerpt || post.content.substring(0, 120) + "..." } : null;
        }).filter(Boolean);

        const followersCount = follows.filter(f => f.followingId === profile.id).length;
        const followingCount = follows.filter(f => f.followerId === profile.id).length;
        const { followers: followersList, following: followingList } = network;

        let totalReads = 0;
        let totalApplause = 0;
        let totalWords = 0;

        publishedPosts.forEach(p => {
            const pViews = analytics.views?.[String(p.id)] || 0;
            const pClaps = analytics.claps?.[String(p.id)] || 0;
            p.views = pViews;
            p.claps = pClaps;
            totalReads += pViews;
            totalApplause += pClaps;
            const words = (p.content || "").trim().split(/\s+/).filter(Boolean).length;
            totalWords += words;
        });

        const readTimeHours = totalReads > 0 ? ((totalWords / 200) * totalReads / 60).toFixed(1) : "0.0";
        const estimatedEarnings = (totalReads * 0.02).toFixed(2);

        const stats = {
            followersCount,
            followingCount,
            totalReads,
            totalApplause,
            readTimeHours,
            estimatedEarnings
        };

        res.render("profile.ejs", {
            profile,
            isOwner: true,
            isFollowing: false,
            publishedPosts,
            drafts,
            bookmarks,
            followersList,
            followingList,
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

        const profile = await getProfileByIdentifier(identifier, req);
        if (!profile) {
            return res.status(404).render("404.ejs", { message: "Author profile not found." });
        }

        const isOwner = Boolean(req.user && (req.user.id === profile.id || (req.user.email && req.user.email.toLowerCase() === profile.email.toLowerCase())));

        const [allPosts, bookmarksData, follows, network, analytics] = await Promise.all([
            getAllPosts(),
            readBookmarks(),
            readFollows(),
            getUserNetwork(profile.id, req.user?.id),
            readAnalytics()
        ]);

        const publishedPosts = allPosts.filter(p => {
            return (p.author && profile.name && p.author.toLowerCase() === profile.name.toLowerCase()) ||
                   (p.author && profile.username && p.author.toLowerCase() === profile.username.toLowerCase()) ||
                   (p.author_id && p.author_id === profile.id);
        });

        const drafts = [];
        const userBookmarks = bookmarksData.filter(b => b.userId === profile.id);
        const bookmarks = userBookmarks.map(b => {
            const post = allPosts.find(p => String(p.id) === String(b.postId));
            return post ? { ...post, snippet: post.excerpt || post.content.substring(0, 120) + "..." } : null;
        }).filter(Boolean);

        const followersCount = follows.filter(f => f.followingId === profile.id).length;
        const followingCount = follows.filter(f => f.followerId === profile.id).length;
        const isFollowing = req.user ? follows.some(f => f.followerId === req.user.id && f.followingId === profile.id) : false;
        const { followers: followersList, following: followingList } = network;

        let totalReads = 0;
        let totalApplause = 0;
        let totalWords = 0;

        publishedPosts.forEach(p => {
            const pViews = analytics.views?.[String(p.id)] || 0;
            const pClaps = analytics.claps?.[String(p.id)] || 0;
            p.views = pViews;
            p.claps = pClaps;
            totalReads += pViews;
            totalApplause += pClaps;
            const words = (p.content || "").trim().split(/\s+/).filter(Boolean).length;
            totalWords += words;
        });

        const readTimeHours = totalReads > 0 ? ((totalWords / 200) * totalReads / 60).toFixed(1) : "0.0";
        const estimatedEarnings = (totalReads * 0.02).toFixed(2);

        const stats = {
            followersCount,
            followingCount,
            totalReads,
            totalApplause,
            readTimeHours,
            estimatedEarnings
        };

        res.render("profile.ejs", {
            profile,
            isOwner,
            isFollowing,
            publishedPosts,
            drafts,
            bookmarks,
            followersList,
            followingList,
            stats,
            user: req.user
        });
    } catch (err) {
        next(err);
    }
});;

// GET /settings: Private Account Settings Screen
app.get("/settings", requireAuth, async (req, res, next) => {
    try {
        const profile = await getOrCreateProfile(req.user, req);
        const isGoogleUser = Boolean(
            req.user?.isGoogleUser || 
            req.user?.provider === "google" || 
            req.user?.avatar?.includes("googleusercontent.com") || 
            profile.avatar?.includes("googleusercontent.com")
        );
        const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || req.ip;
        const currentSessionInfo = parseDeviceInfo(req.headers["user-agent"], clientIp);

        // Compute real author earnings for monetization tab
        const allPosts = await getAllPosts();
        const publishedPosts = allPosts.filter(p => {
            return (p.author && profile.name && p.author.toLowerCase() === profile.name.toLowerCase()) ||
                   (p.author && profile.username && p.author.toLowerCase() === profile.username.toLowerCase()) ||
                   (p.author_id && p.author_id === profile.id);
        });
        const analytics = await readAnalytics();
        let totalReads = 0;
        publishedPosts.forEach(p => {
            totalReads += (analytics.views?.[String(p.id)] || 0);
        });
        const stats = {
            totalReads,
            estimatedEarnings: (totalReads * 0.02).toFixed(2)
        };

        res.render("settings.ejs", { profile, user: req.user, isGoogleUser, currentSessionInfo, stats });
    } catch (err) {
        next(err);
    }
});

// POST /api/profile/sessions/revoke-others: Revoke all other device sessions
app.post("/api/profile/sessions/revoke-others", requireAuth, async (req, res) => {
    try {
        const users = await readLocalUsers();
        const userIdx = users.findIndex(u => u.id === req.user.id || (req.user.email && u.email && u.email.toLowerCase() === req.user.email.toLowerCase()));

        let newVersion = 2;
        if (userIdx !== -1) {
            users[userIdx].sessionVersion = (users[userIdx].sessionVersion || 1) + 1;
            newVersion = users[userIdx].sessionVersion;
            await writeLocalUsers(users);
        }

        // Also sync version in profiles
        const profiles = await readProfiles();
        const profile = profiles.find(p => p.id === req.user.id || (req.user.email && p.email && p.email.toLowerCase() === req.user.email.toLowerCase()));
        if (profile) {
            profile.sessionVersion = newVersion;
            await writeProfiles(profiles);
        }

        // Re-issue a fresh token cookie for the current device so it stays authenticated
        const refreshedUser = {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            sessionVersion: newVersion,
            sessionId: crypto.randomBytes(8).toString("hex")
        };
        const newToken = generateLocalToken(refreshedUser);
        setSessionCookies(res, newToken);

        return res.json({
            success: true,
            message: "All other device sessions have been logged out. Your current session remains active!"
        });
    } catch (err) {
        console.error("Revoke sessions error:", err);
        return res.status(500).json({ error: "Failed to revoke other device sessions." });
    }
});

// POST /api/profile: Update user profile info & preferences
app.post("/api/profile", requireAuth, async (req, res) => {
    try {
        const { name, username, phone, bio, avatar, cover, location, website, twitter, notifications, privacy } = req.body;
        const profiles = await readProfiles();
        let profile = profiles.find(p => p.id === req.user.id || (req.user.email && p.email && p.email.toLowerCase() === req.user.email.toLowerCase()));

        if (!profile) {
            profile = await getOrCreateProfile(req.user, req);
        }

        if (name !== undefined && name.trim()) profile.name = name.trim();
        if (username !== undefined && username.trim()) profile.username = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (phone !== undefined) profile.phone = phone ? phone.trim() : "";
        if (bio !== undefined) profile.bio = bio ? bio.trim() : "";
        if (avatar !== undefined) {
            if (avatar && typeof avatar === "string" && avatar.startsWith("data:image/")) {
                profile.avatar = await saveBase64Image(avatar, "avatar", req.user.id);
            } else if (avatar && typeof avatar === "string" && avatar.trim()) {
                profile.avatar = avatar.trim();
            } else if (avatar === "" || avatar === null) {
                profile.avatar = null;
            }
        }
        if (cover !== undefined) {
            if (cover && typeof cover === "string" && cover.startsWith("data:image/")) {
                profile.cover = await saveBase64Image(cover, "cover", req.user.id);
            } else if (cover && typeof cover === "string" && cover.trim()) {
                profile.cover = cover.trim();
            } else if (cover === "" || cover === null) {
                profile.cover = null;
            }
        }
        if (location !== undefined) profile.location = location ? location.trim() : "";
        if (website !== undefined) {
            let cleanWebsite = website ? website.trim() : "";
            if (cleanWebsite && !cleanWebsite.startsWith("http://") && !cleanWebsite.startsWith("https://")) {
                cleanWebsite = "https://" + cleanWebsite;
            }
            profile.website = cleanWebsite;
        }
        if (twitter !== undefined) {
            let cleanTwitter = twitter ? twitter.trim() : "";
            if (cleanTwitter.includes("twitter.com/") || cleanTwitter.includes("x.com/")) {
                cleanTwitter = cleanTwitter.split("/").pop().replace(/^@/, "");
            }
            if (cleanTwitter && !cleanTwitter.startsWith("@")) {
                cleanTwitter = "@" + cleanTwitter;
            }
            profile.social = {
                ...(profile.social || {}),
                twitter: cleanTwitter
            };
        }
        if (notifications && typeof notifications === "object") {
            profile.notifications = {
                ...(profile.notifications || { comments: true, followers: true, digest: true, push: false }),
                ...notifications
            };
        }
        if (privacy && typeof privacy === "object") {
            profile.privacy = {
                ...(profile.privacy || { isPublic: true, showBookmarks: true }),
                ...privacy
            };
        }

        // Also update local users file if name changed
        if (name !== undefined) {
            const users = await readLocalUsers();
            const userIdx = users.findIndex(u => u.id === req.user.id || (req.user.email && u.email.toLowerCase() === req.user.email.toLowerCase()));
            if (userIdx >= 0) {
                users[userIdx].name = profile.name;
                await writeLocalUsers(users);
            }
        }

        // Save updated profiles list (local cache)
        const existingIdx = profiles.findIndex(p => p.id === profile.id);
        if (existingIdx >= 0) {
            profiles[existingIdx] = profile;
        } else {
            profiles.push(profile);
        }
        await writeProfiles(profiles);

        // 1. Set persistent Cookie in response (instant, guaranteed persistence across all Vercel instances)
        setUserProfileCookie(res, profile);

        // 2. Persist to Supabase DB (if profiles table exists)
        await writeProfileToDB(profile);

        // 3. Sync to Supabase Auth cloud metadata via direct REST API (AWAITED for serverless persistence)
        if (supabaseUrl && supabaseKey && req.cookies?.auth_token) {
            try {
                const profileMetadata = {
                    name: profile.name,
                    username: profile.username,
                    bio: profile.bio,
                    phone: profile.phone,
                    avatar: profile.avatar,
                    cover: profile.cover,
                    location: profile.location,
                    website: profile.website,
                    social: profile.social,
                    notifications: profile.notifications,
                    privacy: profile.privacy
                };
                const sbResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "apikey": supabaseKey,
                        "Authorization": `Bearer ${req.cookies.auth_token}`
                    },
                    body: JSON.stringify({ data: profileMetadata })
                });
                if (sbResp.ok) {
                    console.log("Supabase user_metadata cloud sync completed for:", profile.name);
                } else {
                    const errBody = await sbResp.text();
                    console.warn("Supabase user_metadata cloud sync returned:", sbResp.status, errBody);
                }
            } catch (sbErr) {
                console.warn("Supabase user_metadata sync notice:", sbErr.message);
            }
        }

        // Update live user session reference immediately
        if (req.user) {
            if (profile.name) req.user.name = profile.name;
            if (profile.avatar !== undefined) req.user.avatar = profile.avatar;
            if (profile.username) req.user.username = profile.username;
            req.user.profile = profile;
        }

        if (req.xhr || req.headers.accept?.includes("json") || req.is("json")) {
            return res.json({ success: true, profile });
        }
        return res.redirect("/settings?saved=true");
    } catch (e) {
        console.error("Profile update error:", e);
        res.status(500).json({ error: "Failed to update profile." });
    }
});

// POST /api/profile/password: Change password requiring valid current password
app.post("/api/profile/password", requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !currentPassword.trim()) {
            return res.status(400).json({ error: "You must enter your current password." });
        }

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: "New password must be at least 8 characters long." });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: "New password and confirmation do not match." });
        }

        let passwordUpdated = false;

        // If authenticated with Supabase
        if (supabase && req.user && req.user.email) {
            try {
                // Verify existing password
                const { error: verifyError } = await supabase.auth.signInWithPassword({
                    email: req.user.email,
                    password: currentPassword
                });

                if (verifyError) {
                    return res.status(400).json({ error: "Current password is incorrect. Please enter your existing password." });
                }

                const { error: updateError } = await supabase.auth.updateUser({
                    password: newPassword
                });

                if (updateError) {
                    return res.status(400).json({ error: updateError.message || "Failed to update password." });
                }
                passwordUpdated = true;
            } catch (err) {
                // Check local user if Supabase is offline or user was locally created
            }
        }

        if (!passwordUpdated) {
            // Local user authentication & password update
            const users = await readLocalUsers();
            const userIndex = users.findIndex(u => u.id === req.user.id || (req.user.email && u.email.toLowerCase() === req.user.email.toLowerCase()));

            if (userIndex === -1) {
                return res.status(404).json({ error: "User account not found." });
            }

            const user = users[userIndex];
            const isValid = verifyPassword(currentPassword, user.password);
            if (!isValid) {
                return res.status(400).json({ error: "Current password is incorrect. Please enter your existing password." });
            }

            users[userIndex].password = hashPassword(newPassword);
            await writeLocalUsers(users);
        }

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (e) {
        console.error("Password change error:", e);
        res.status(500).json({ error: "An unexpected error occurred while changing your password." });
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
        const profile = await getOrCreateProfile(req.user, req);
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
        const profile = await getOrCreateProfile(req.user, req);
        const author = (req.body.author && req.body.author.trim()) || (profile && profile.name) || (req.user && req.user.name) || "Anonymous";

        if (!title?.trim() || !content?.trim() || !author?.trim()) {
            return res.status(400).render("404.ejs", { message: "Title, author, and content cannot be empty.", user: req.user });
        }

        await createPost({
            title: simpleSanitize(title.trim()),
            content: content.trim(),
            excerpt: generateExcerpt(content.trim()),
            author: simpleSanitize(author.trim()),
            authorId: req.user?.id || null,
            authorEmail: req.user?.email || null,
            authorUsername: profile?.username || req.user?.username || null,
            tags: tags ? simpleSanitize(tags.trim()) : undefined,
            coverImage: coverImage ? simpleSanitize(coverImage.trim()) : undefined,
        });

        res.redirect("/");
    } catch (err) {
        next(err);
    }
});

// POST /api/posts/:id/clap: Record applause / clap
app.post("/api/posts/:id/clap", async (req, res) => {
    try {
        const totalClaps = await recordPostClap(req.params.id, 1);
        res.json({ success: true, totalClaps });
    } catch (e) {
        res.status(500).json({ error: "Could not record applause." });
    }
});

// GET /posts/:id: View a single post
app.get("/posts/:id", async (req, res, next) => {
    try {
        const post = await getPostById(req.params.id);
        if (post) {
            // Record real unique reader view (non-blocking in background)
            recordPostView(post.id, req, res).catch(() => {});

            const [analytics, allPosts] = await Promise.all([
                readAnalytics(),
                getAllPosts()
            ]);

            post.views = analytics.views?.[String(post.id)] || 1;
            post.claps = analytics.claps?.[String(post.id)] || 0;

            const postTags = (post.tags || []).map(t => t.toLowerCase());
            const relatedPosts = allPosts
                .filter(p => String(p.id) !== String(post.id))
                .sort((a, b) => {
                    const aMatches = (a.tags || []).filter(t => postTags.includes(t.toLowerCase())).length;
                    const bMatches = (b.tags || []).filter(t => postTags.includes(t.toLowerCase())).length;
                    return bMatches - aMatches;
                })
                .slice(0, 3);

            let isAuthor = false;
            if (req.user) {
                const profile = await getOrCreateProfile(req.user, req);
                isAuthor = isUserPostAuthor(req.user, post, profile);
            }

            res.render("post.ejs", { post, relatedPosts, user: req.user, isAuthor });
        } else {
            res.status(404).render("404.ejs", { message: "The requested post could not be found.", user: req.user });
        }
    } catch (err) {
        next(err);
    }
});

// GET /edit/:id: Show form to edit a post (Protected - Creator only)
app.get("/edit/:id", requireAuth, async (req, res, next) => {
    try {
        const post = await getPostById(req.params.id);
        if (!post) {
            return res.status(404).render("404.ejs", { message: "The post you wish to edit does not exist.", user: req.user });
        }

        const profile = await getOrCreateProfile(req.user, req);
        if (!isUserPostAuthor(req.user, post, profile)) {
            return res.status(403).render("404.ejs", { message: "Permission denied: You can only edit stories that you created.", user: req.user });
        }

        res.render("edit.ejs", { post, user: req.user });
    } catch (err) {
        next(err);
    }
});

// POST /update/:id: Update an existing post (Protected - Creator only)
app.post("/update/:id", requireAuth, async (req, res, next) => {
    try {
        const post = await getPostById(req.params.id);
        if (!post) {
            return res.status(404).render("404.ejs", { message: "The post to update could not be found.", user: req.user });
        }

        const profile = await getOrCreateProfile(req.user, req);
        if (!isUserPostAuthor(req.user, post, profile)) {
            return res.status(403).render("404.ejs", { message: "Permission denied: You can only edit stories that you authored.", user: req.user });
        }

        const { title, content, author, tags, coverImage } = req.body;
        if (!title?.trim() || !content?.trim() || !author?.trim()) {
            return res.status(400).render("404.ejs", { message: "Title, author, and content cannot be empty.", user: req.user });
        }

        const updated = await updatePost(req.params.id, {
            title: simpleSanitize(title.trim()),
            content: content.trim(),
            excerpt: generateExcerpt(content.trim()),
            author: simpleSanitize(author.trim()),
            authorId: post.author_id || req.user.id,
            authorEmail: post.author_email || req.user.email,
            authorUsername: post.author_username || profile?.username,
            tags: tags ? simpleSanitize(tags.trim()) : undefined,
            coverImage: coverImage ? simpleSanitize(coverImage.trim()) : undefined,
        });

        if (updated) {
            res.redirect(`/posts/${req.params.id}`);
        } else {
            res.status(404).render("404.ejs", { message: "The post to update could not be found.", user: req.user });
        }
    } catch (err) {
        next(err);
    }
});

// POST /delete/:id: Delete a post (Protected - Creator only)
app.post("/delete/:id", requireAuth, async (req, res, next) => {
    try {
        const post = await getPostById(req.params.id);
        if (!post) {
            return res.status(404).render("404.ejs", { message: "The post to delete could not be found.", user: req.user });
        }

        const profile = await getOrCreateProfile(req.user, req);
        if (!isUserPostAuthor(req.user, post, profile)) {
            return res.status(403).render("404.ejs", { message: "Permission denied: You can only delete stories that you created.", user: req.user });
        }

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
