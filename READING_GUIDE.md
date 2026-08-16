# Reading Guide: Understanding the Codebase

To understand how this website works, line by line, here is the recommended reading order and what each file does:

## 1. The Entry Point and Backend Logic
Start here to understand how the server runs, how requests are handled, and how data is managed.

* **`index.js` (Root Directory)**
  * **Why read it:** This is the main server file. It sets up the Express application, configures middleware (like body parsers and static file serving), defines the routes (URLs) the website responds to, and manages the main data (likely an array or database connection for the blog posts). It's the brain of the website.
  * **What to look for:** Look at how `app.get`, `app.post`, `app.put`, and `app.delete` are set up. Notice how it renders the `.ejs` files in the `views/` folder.

* **`api/index.js`**
  * **Why read it:** If this project uses serverless deployment (like Vercel), this file likely acts as the entry point for the serverless function, importing and exporting the Express app from the main `index.js`. 

## 2. The Frontend Views (HTML Templates)
Once you understand how the server routes requests, look at the files it sends back to the user. These use EJS (Embedded JavaScript) to inject dynamic data into HTML.

* **`views/partials/` (Header & Footer)**
  * **Why read it:** These files usually contain the `header.ejs` and `footer.ejs`. They hold the common HTML structure (like the `<head>`, navigation bar, and closing `</body>` tags) that is shared across all pages.
  * **What to look for:** The base HTML skeleton and links to CSS files.

* **`views/index.ejs`**
  * **Why read it:** The homepage template. It likely loops through all blog posts passed from `index.js` and displays them in a list or grid.

* **`views/post.ejs`**
  * **Why read it:** The template for viewing a single, specific blog post in full detail.

* **`views/new.ejs`**
  * **Why read it:** The form template for creating a brand new blog post. Look at the `<form>` tag's `action` and `method` attributes to see where it sends data back to `index.js`.

* **`views/edit.ejs`**
  * **Why read it:** The form template for editing an existing blog post. Similar to `new.ejs`, but pre-filled with existing data.

## 3. Styling and Assets
Finally, see how the website is made to look good.

* **`public/styles/`**
  * **Why read it:** Contains the CSS files (like `main.css` or `style.css`) that dictate the colors, layout, fonts, and responsiveness of the website.

* **`public/images/`**
  * **Why read it:** Contains static image assets used across the site.

## 4. Configuration and Dependencies
To understand what third-party tools the project relies on.

* **`package.json`**
  * **Why read it:** Lists all the dependencies (like `express`, `ejs`) installed via npm, and any custom scripts (like `npm start`).

* **`vercel.json`**
  * **Why read it:** Contains configuration specific to deploying this app on Vercel.

