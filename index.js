require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");

const app = express();
const port = process.env.PORT || 5000;

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

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

// Helper: Format post object date and structure for template consistency
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
    return {
        ...post,
        date: formattedDate || new Date().toLocaleDateString(),
    };
};

// Helper: Generate fallback ID for local offline development
const generateId = () => {
    return Math.random().toString(36).substring(2, 11);
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

// Data Access Layer
const getAllPosts = async () => {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .select("*")
                .order("created_at", { ascending: false });
            if (error) throw error;
            return (data || []).map(formatPost);
        } catch (err) {
            console.error("Supabase getAllPosts error:", err.message);
            return [];
        }
    }
    const localPosts = await readLocalPosts();
    return localPosts.map(formatPost);
};

const getPostById = async (id) => {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from("posts")
                .select("*")
                .eq("id", id)
                .maybeSingle();
            if (error) throw error;
            return data ? formatPost(data) : null;
        } catch (err) {
            console.error("Supabase getPostById error:", err.message);
            return null;
        }
    }
    const localPosts = await readLocalPosts();
    const post = localPosts.find((p) => String(p.id) === String(id));
    return post ? formatPost(post) : null;
};

const createPost = async ({ title, content, excerpt, author }) => {
    if (supabase) {
        const { data, error } = await supabase
            .from("posts")
            .insert([{ title, content, excerpt, author }])
            .select()
            .single();
        if (error) throw error;
        return formatPost(data);
    }
    const localPosts = await readLocalPosts();
    const newPost = {
        id: generateId(),
        title,
        content,
        excerpt,
        author,
        created_at: new Date().toISOString(),
        date: new Date().toLocaleDateString(),
    };
    localPosts.unshift(newPost);
    await writeLocalPosts(localPosts);
    return formatPost(newPost);
};

const updatePost = async (id, { title, content, excerpt, author }) => {
    if (supabase) {
        const { data, error } = await supabase
            .from("posts")
            .update({ title, content, excerpt, author })
            .eq("id", id)
            .select()
            .single();
        if (error) throw error;
        return formatPost(data);
    }
    const localPosts = await readLocalPosts();
    const index = localPosts.findIndex((p) => String(p.id) === String(id));
    if (index !== -1) {
        localPosts[index] = {
            ...localPosts[index],
            title,
            content,
            excerpt,
            author,
        };
        await writeLocalPosts(localPosts);
        return formatPost(localPosts[index]);
    }
    return null;
};

const deletePost = async (id) => {
    if (supabase) {
        const { error } = await supabase
            .from("posts")
            .delete()
            .eq("id", id);
        if (error) throw error;
        return true;
    }
    let localPosts = await readLocalPosts();
    localPosts = localPosts.filter((p) => String(p.id) !== String(id));
    await writeLocalPosts(localPosts);
    return true;
};

// Text sanitization and excerpt generator
const simpleSanitize = (str) => {
    if (!str) return "";
    return String(str)
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const stripTags = (html) => {
    if (!html) return "";
    return String(html).replace(/<[^>]*>/g, "");
};

const generateExcerpt = (content) => {
    const cleanText = stripTags(content);
    return cleanText.substring(0, 120) + (cleanText.length > 120 ? "..." : "");
};

// --- ROUTES ---

// GET /: Display all posts
app.get("/", async (req, res, next) => {
    try {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        const posts = await getAllPosts();
        res.render("index.ejs", { posts });
    } catch (err) {
        next(err);
    }
});

// GET /new: Show form to create new post
app.get("/new", (req, res) => {
    res.render("new.ejs");
});

// POST /posts: Create a new post
app.post("/posts", async (req, res, next) => {
    try {
        const { title, content, author } = req.body;
        if (!title?.trim() || !content?.trim() || !author?.trim()) {
            return res.status(400).render("404.ejs", { message: "Title, author, and content cannot be empty." });
        }

        await createPost({
            title: simpleSanitize(title.trim()),
            content: simpleSanitize(content.trim()),
            excerpt: generateExcerpt(content.trim()),
            author: simpleSanitize(author.trim()),
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
            res.render("post.ejs", { post });
        } else {
            res.status(404).render("404.ejs", { message: "The requested post could not be found." });
        }
    } catch (err) {
        next(err);
    }
});

// GET /edit/:id: Show form to edit a post
app.get("/edit/:id", async (req, res, next) => {
    try {
        const post = await getPostById(req.params.id);
        if (post) {
            res.render("edit.ejs", { post });
        } else {
            res.status(404).render("404.ejs", { message: "The post you wish to edit does not exist." });
        }
    } catch (err) {
        next(err);
    }
});

// POST /update/:id: Update an existing post
app.post("/update/:id", async (req, res, next) => {
    try {
        const { title, content, author } = req.body;
        if (!title?.trim() || !content?.trim() || !author?.trim()) {
            return res.status(400).render("404.ejs", { message: "Title, author, and content cannot be empty." });
        }

        const updated = await updatePost(req.params.id, {
            title: simpleSanitize(title.trim()),
            content: simpleSanitize(content.trim()),
            excerpt: generateExcerpt(content.trim()),
            author: simpleSanitize(author.trim()),
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

// POST /delete/:id: Delete a post
app.post("/delete/:id", async (req, res, next) => {
    try {
        await deletePost(req.params.id);
        res.redirect("/");
    } catch (err) {
        next(err);
    }
});

// Fallback 404 handler for unknown routes
app.use((req, res) => {
    res.status(404).render("404.ejs", { message: "Page not found." });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).render("404.ejs", { message: "An unexpected error occurred. Please try again later." });
});

// Only listen locally — on Vercel, the app is exported for serverless
if (!process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}

module.exports = app;
