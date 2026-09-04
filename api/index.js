const path = require("path");
// Ensure Vercel bundler traces views directory
path.join(__dirname, "../views");

const app = require("../index.js");
module.exports = app;
