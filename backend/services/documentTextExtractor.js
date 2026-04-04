const path = require("path");
const { ocrImageBuffer } = require("./ocrService");

function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractTextFromPdfBuffer(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map(it => (typeof it.str === "string" ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    pages.push({ pageNumber, text: normalizeText(text) });
  }

  return { pages, fullText: normalizeText(pages.map(p => p.text).join("\n\n")) };
}

async function extractTextFromImageBuffer(buffer) {
  return await ocrImageBuffer(buffer, { lang: "eng" });
}

async function extractTextFromUploadedFile(file) {
  if (!file) throw new Error("Missing file");
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();

  if (mime === "application/pdf" || ext === ".pdf") {
    return await extractTextFromPdfBuffer(file.buffer);
  }

  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(ext)) {
    return await extractTextFromImageBuffer(file.buffer);
  }

  const asText = normalizeText(file.buffer.toString("utf8"));
  return { fullText: asText, pages: [{ pageNumber: 1, text: asText }] };
}

module.exports = {
  extractTextFromUploadedFile
};

