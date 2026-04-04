const express = require("express");
const cors = require("cors");
const path = require("path");

const claimRoutes = require("./routes/claimRoutes");
const app = express();

// Enable CORS and JSON parsing (Express 4.16+ has built-in JSON/urlencoded middleware)
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

// Demo UI (single page) served from backend/public
app.use(express.static(path.join(__dirname, "public")));

// Serve generated demo PDFs (after running npm run generate:demo-pdfs)
app.use("/demo-pdfs", express.static(path.join(__dirname, "data", "demo-pdfs")));

// Mount our routes under /api (see MDN example of using Router modules)【53†L323-L331】.
app.use("/api", claimRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
