function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
