# 📝 miniblogs

A minimalist, retro-lofi themed blogging platform built with **Node.js**, **Express**, **EJS**, and backed by a serverless **Supabase (PostgreSQL)** database.

Live on Vercel: [blogsite-mini25.vercel.app](https://blogsite-mini25.vercel.app)

---

## ✨ Features

- **Lofi / Terminal Aesthetic**: Custom styling with `Space Mono` typography, warm light mode, and synth night dark mode with instant local persistence.
- **PostgreSQL Database**: Powered by Supabase for resilient, serverless, and relational data storage.
- **Row Level Security (RLS)**: PostgreSQL access policies configured for secure queries.
- **Full CRUD Operations**:
  - 📖 **Read**: View chronological blog posts on homepage and full reading view.
  - ✍️ **Create**: Publish articles with automatic excerpts and sanitization.
  - ✏️ **Update**: Edit existing articles.
  - 🗑️ **Delete**: Remove posts with instant database synchronization.
- **Graceful Fallback**: Automatically falls back to asynchronous local JSON storage during offline local development when Supabase credentials are not set.
- **Zero-Flicker Theme Toggle**: Instant theme switching saved to `localStorage`.
- **404 & Error Handling**: Custom styled error pages matching the retro aesthetic.

---

## 🛠️ Tech Stack

- **Backend**: [Node.js](https://nodejs.org/), [Express.js](https://expressjs.com/)
- **Templating**: [EJS](https://ejs.co/)
- **Database**: [Supabase](https://supabase.com/) (Serverless PostgreSQL) via `@supabase/supabase-js`
- **Styling**: Vanilla CSS (Custom design system with CSS custom properties)
- **Deployment**: [Vercel](https://vercel.com/) (Serverless functions)

---

## 📂 Project Structure

```
.
├── api/
│   └── index.js             # Vercel serverless function entrypoint
├── public/
│   ├── images/              # Static assets and icons
│   └── styles/
│       └── style.css        # Main stylesheet with light/dark variables
├── views/
│   ├── partials/
│   │   ├── header.ejs       # Shared header, navigation & theme switcher
│   │   └── footer.ejs       # Shared footer & theme toggle script
│   ├── 404.ejs              # Styled error and not-found page
│   ├── edit.ejs             # Post editing form
│   ├── index.ejs            # Homepage post feed
│   ├── new.ejs              # Post creation form
│   └── post.ejs             # Single post full view
├── .env.example             # Template for environment variables
├── index.js                 # Express server & database access layer
├── package.json             # Project dependencies and scripts
├── supabase-schema.sql      # PostgreSQL table schema & RLS policies
└── vercel.json              # Vercel deployment routing configuration
```

---

## 🚀 Getting Started Locally

### 1. Clone the repository
```bash
git clone https://github.com/abhishek-k-33/blog_site.git
cd blog_site
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env` file in the root directory (or copy `.env.example`):
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
PORT=5000
```

### 4. Setup Database Schema (in Supabase)
Open your project's **SQL Editor** in Supabase and run the SQL commands from `supabase-schema.sql`.

### 5. Start the server
```bash
npm start
```
Visit **[http://localhost:5000](http://localhost:5000)** in your browser.

---

## 🌐 Deploying to Vercel

1. Import your GitHub repository to [Vercel](https://vercel.com).
2. Add the following **Environment Variables** in project settings:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Click **Deploy**.

---

## 📄 License
ISC
