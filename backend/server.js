const express = require("express");
const cors = require("cors");
const path = require("path");

const claimRoutes = require("./routes/claimRoutes");
const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

app.use("/demo-pdfs", express.static(path.join(__dirname, "data", "demo-pdfs")));

app.use("/api", claimRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
