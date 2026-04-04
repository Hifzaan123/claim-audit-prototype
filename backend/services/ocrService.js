function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * OCR an image buffer using Tesseract.
 * Kept as a separate service so the architecture is clean and swappable
 * (e.g., Google Vision / AWS Textract later).
 */
async function ocrImageBuffer(buffer, { lang = "eng" } = {}) {
  const { createWorker } = require("tesseract.js");
  const worker = await createWorker(lang);
  try {
    const { data } = await worker.recognize(buffer);
    const text = normalizeText(data?.text || "");
    return {
      fullText: text,
      pages: [{ pageNumber: 1, text }]
    };
  } finally {
    await worker.terminate();
  }
}

module.exports = { ocrImageBuffer };

