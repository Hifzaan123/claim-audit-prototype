function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const { extractEntities } = require("./nlpService");
const { parseDateLoose } = require("./dateUtils");

function parseMoney(s) {
  if (s == null) return null;
  const str = String(s).replace(/[^\d.]/g, "");
  if (!str) return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

async function extractClaimFields(claimText) {
  const text = normalizeText(claimText);

  const claim = {
    patientName: null,
    serviceDate: null,
    policyStartDate: null,
    diagnosis: null,
    provider: {
      hospitalName: null,
      doctorName: null,
      invoiceNumber: null,
      gstin: null,
      registrationNumber: null
    },
    items: [],
    rawText: text,
    extractedBy: { regex: true, ner: false }
  };

  let m;

  m = text.match(/Patient\s*[:\-]\s*([A-Za-z ]{2,})/i);
  if (m) claim.patientName = m[1].trim();

  m = text.match(/(?:Service Date|Date of Service|Admission Date)\s*[:\-]\s*([\d/.\-]+)/i);
  if (m) claim.serviceDate = m[1].trim();

  m = text.match(/(?:Policy Start Date|Policy Start|Start Date)\s*[:\-]\s*([\d/.\-]+)/i);
  if (m) claim.policyStartDate = m[1].trim();

  m = text.match(/(?:Diagnosis|Diagnosed With)\s*[:\-]\s*([A-Za-z0-9 ,/()\-]+)/i);
  if (m) claim.diagnosis = m[1].trim();

  // Provider / document identifiers (helpful for fraud detection)
  m = text.match(/(?:Hospital|Clinic|Provider)\s*[:\-]\s*([A-Za-z0-9 .,&()\-]{3,})/i);
  if (m) claim.provider.hospitalName = m[1].trim();

  m = text.match(/\b(?:Invoice|Bill)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Za-z0-9\-\/]{3,})\b/i);
  if (m) claim.provider.invoiceNumber = m[1].trim();

  m = text.match(/\bGSTIN\s*[:\-]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9]Z[A-Z0-9])\b/i);
  if (m) claim.provider.gstin = m[1].trim();

  m = text.match(/\b(?:Reg(?:istration)?\s*(?:No\.?|Number)|Provider\s*Reg)\s*[:\-]?\s*([A-Za-z0-9\-\/]{3,})\b/i);
  if (m) claim.provider.registrationNumber = m[1].trim();

  m = text.match(/\bDr\.?\s+([A-Za-z .]{3,})\b/i);
  if (m) claim.provider.doctorName = m[1].trim();

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const item = line.match(/^([A-Za-z][A-Za-z0-9 ,/()\-]+)\s*[:\-]\s*₹?\s*([0-9][0-9,]*(?:\.[0-9]+)?)$/);
    if (item) {
      claim.items.push({
        description: item[1].trim(),
        amount: Number(item[2].replace(/,/g, ""))
      });
    }
  }

  // NER enrichment (best-effort). If model isn't available, it will safely no-op.
  const ner = await extractEntities(text);
  if (ner.available && Array.isArray(ner.entities)) {
    claim.extractedBy.ner = true;

    // PERSON
    if (!claim.patientName) {
      const person = ner.entities.find((e) => e.type === "PER" && e.text && e.text.length >= 3);
      if (person) claim.patientName = person.text.replace(/^##/, "").trim();
    }

    // DATE: pick best guess for serviceDate/policyStartDate if missing
    const dates = ner.entities
      .filter((e) => e.type === "DATE" && e.text)
      .map((e) => ({ raw: e.text, date: parseDateLoose(e.text) }))
      .filter((d) => d.date);

    // Heuristic: earliest date looks like policy start; latest looks like service.
    if (dates.length >= 1) {
      dates.sort((a, b) => a.date.getTime() - b.date.getTime());
      if (!claim.policyStartDate) claim.policyStartDate = dates[0].raw;
      if (!claim.serviceDate) claim.serviceDate = dates[dates.length - 1].raw;
    }

    // MONEY: if items empty, try to infer "X - amount" patterns using MONEY entities
    if (claim.items.length === 0) {
      const money = ner.entities.filter((e) => e.type === "MONEY" && e.text);
      for (const e of money.slice(0, 8)) {
        const amount = parseMoney(e.text);
        if (amount != null && amount > 0) {
          claim.items.push({ description: "Charge", amount });
        }
      }
    }

    // ORG can often represent hospital/clinic name
    if (!claim.provider.hospitalName) {
      const org = ner.entities.find((e) => e.type === "ORG" && e.text && e.text.length >= 3);
      if (org) claim.provider.hospitalName = org.text.replace(/^##/, "").trim();
    }
  }

  return claim;
}

module.exports = { extractClaimFields };