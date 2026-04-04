const fs = require("fs");
const path = require("path");
const { extractTextFromUploadedFile } = require("../services/documentTextExtractor");
const { extractClaimFields } = require("../services/claimExtractor");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const RAW = path.join(DATA, "raw");
const PROCESSED = path.join(DATA, "processed");
const DOCS_OUT = path.join(PROCESSED, "documents");
const SPLITS_OUT = path.join(PROCESSED, "splits");

const RAW_DIRS = [
  path.join(RAW, "policies"),
  path.join(RAW, "claims"),
  path.join(RAW, "discharge-summaries")
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function inferMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function inferDocType(filePath) {
  const n = filePath.toLowerCase();
  if (n.includes(`${path.sep}policies${path.sep}`)) return "policy";
  if (n.includes(`${path.sep}discharge-summaries${path.sep}`)) return "discharge_summary";
  if (n.includes(`${path.sep}claims${path.sep}`)) return "claim";
  return "unknown";
}

function toId(filePath) {
  const rel = path.relative(RAW, filePath).replace(/\\/g, "/");
  return rel.replace(/[^a-zA-Z0-9/_-]/g, "_").replace(/\//g, "__");
}

function hashString(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function splitLabelForId(id) {
  const bucket = hashString(id) % 100;
  if (bucket < 70) return "train";
  if (bucket < 85) return "val";
  return "test";
}

function makeSplits(records) {
  const out = { train: [], val: [], test: [] };
  for (const r of records) out[splitLabelForId(r.id)].push(r);
  return out;
}

function pct(n, d) {
  if (!d) return 0;
  return Number(((n / d) * 100).toFixed(1));
}

function qualityReport(records) {
  const claimLike = records.filter((r) => r.docType === "claim" || r.docType === "discharge_summary");
  const hasText = records.filter((r) => (r.text || "").trim().length > 0).length;
  const extractionErrors = claimLike.filter((r) => r.claimFieldsError).length;
  const withFields = claimLike.filter((r) => r.claimFields).length;

  const fieldNames = [
    "patientName",
    "serviceDate",
    "policyStartDate",
    "diagnosis",
    "provider.hospitalName",
    "provider.invoiceNumber",
    "provider.registrationNumber",
    "items"
  ];

  const counts = {
    patientName: 0,
    serviceDate: 0,
    policyStartDate: 0,
    diagnosis: 0,
    "provider.hospitalName": 0,
    "provider.invoiceNumber": 0,
    "provider.registrationNumber": 0,
    items: 0
  };

  for (const r of claimLike) {
    const f = r.claimFields || {};
    const p = f.provider || {};
    if (f.patientName) counts.patientName += 1;
    if (f.serviceDate) counts.serviceDate += 1;
    if (f.policyStartDate) counts.policyStartDate += 1;
    if (f.diagnosis) counts.diagnosis += 1;
    if (p.hospitalName) counts["provider.hospitalName"] += 1;
    if (p.invoiceNumber) counts["provider.invoiceNumber"] += 1;
    if (p.registrationNumber) counts["provider.registrationNumber"] += 1;
    if (Array.isArray(f.items) && f.items.length > 0) counts.items += 1;
  }

  const completeness = {};
  for (const k of fieldNames) {
    completeness[k] = {
      present: counts[k],
      total: claimLike.length,
      pct: pct(counts[k], claimLike.length)
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      allDocuments: records.length,
      claimLikeDocuments: claimLike.length
    },
    extractionHealth: {
      hasText: { present: hasText, total: records.length, pct: pct(hasText, records.length) },
      claimFieldExtractionSuccess: { present: withFields, total: claimLike.length, pct: pct(withFields, claimLike.length) },
      claimFieldExtractionErrors: extractionErrors
    },
    fieldCompleteness: completeness
  };
}

async function processOne(filePath) {
  const buffer = fs.readFileSync(filePath);
  const file = {
    originalname: path.basename(filePath),
    mimetype: inferMime(filePath),
    buffer
  };

  const extracted = await extractTextFromUploadedFile(file);
  const docType = inferDocType(filePath);
  const rec = {
    id: toId(filePath),
    sourcePath: path.relative(ROOT, filePath).replace(/\\/g, "/"),
    fileName: path.basename(filePath),
    docType,
    mime: file.mimetype,
    chars: (extracted.fullText || "").length,
    pageCount: Array.isArray(extracted.pages) ? extracted.pages.length : 1,
    extractedAt: new Date().toISOString(),
    text: extracted.fullText || ""
  };

  if (docType === "claim" || docType === "discharge_summary") {
    try {
      rec.claimFields = await extractClaimFields(rec.text);
    } catch (e) {
      rec.claimFieldsError = e.message;
    }
  }
  return rec;
}

async function main() {
  ensureDir(RAW);
  for (const d of RAW_DIRS) ensureDir(d);
  ensureDir(PROCESSED);
  ensureDir(DOCS_OUT);
  ensureDir(SPLITS_OUT);

  const files = RAW_DIRS.flatMap((d) => walkFiles(d));
  if (files.length === 0) {
    console.log("No raw files found.");
    console.log("Add files to:");
    console.log(" - data/raw/policies");
    console.log(" - data/raw/claims");
    console.log(" - data/raw/discharge-summaries");
  }

  const records = [];
  for (const fp of files) {
    try {
      const rec = await processOne(fp);
      records.push(rec);
      const onePath = path.join(DOCS_OUT, `${rec.id}.json`);
      fs.writeFileSync(onePath, JSON.stringify(rec, null, 2), "utf8");
      console.log(`Processed: ${rec.sourcePath} (${rec.docType}, ${rec.pageCount} pages)`);
    } catch (e) {
      console.log(`Failed: ${path.relative(ROOT, fp)} -> ${e.message}`);
    }
  }

  const jsonlPath = path.join(PROCESSED, "dataset.jsonl");
  fs.writeFileSync(jsonlPath, records.map((r) => JSON.stringify(r)).join("\n"), "utf8");

  const splits = makeSplits(records);
  for (const splitName of ["train", "val", "test"]) {
    const p = path.join(SPLITS_OUT, `${splitName}.jsonl`);
    fs.writeFileSync(p, splits[splitName].map((r) => JSON.stringify(r)).join("\n"), "utf8");
  }

  const quality = qualityReport(records);
  fs.writeFileSync(path.join(PROCESSED, "quality-report.json"), JSON.stringify(quality, null, 2), "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    total: records.length,
    byType: {
      policy: records.filter((r) => r.docType === "policy").length,
      claim: records.filter((r) => r.docType === "claim").length,
      discharge_summary: records.filter((r) => r.docType === "discharge_summary").length,
      unknown: records.filter((r) => r.docType === "unknown").length
    },
    avgChars: records.length ? Math.round(records.reduce((s, r) => s + (r.chars || 0), 0) / records.length) : 0,
    splits: {
      train: splits.train.length,
      val: splits.val.length,
      test: splits.test.length
    },
    output: {
      jsonl: path.relative(ROOT, jsonlPath).replace(/\\/g, "/"),
      docs: path.relative(ROOT, DOCS_OUT).replace(/\\/g, "/"),
      splitDir: path.relative(ROOT, SPLITS_OUT).replace(/\\/g, "/"),
      qualityReport: "data/processed/quality-report.json"
    }
  };
  fs.writeFileSync(path.join(PROCESSED, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(`Done. Wrote ${summary.total} records to ${summary.output.jsonl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
