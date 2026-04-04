const { parseDateLoose, diffInDays } = require("./dateUtils");

function safeLower(text) {
  return String(text || "").toLowerCase();
}

function isRoundNumber(n) {
  if (!Number.isFinite(n)) return false;
  return n % 1000 === 0 || n % 500 === 0;
}

function computeTotals(items) {
  const total = (items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  return { total };
}

function fraudRiskFromSignals({ claim, decision }) {
  let score = 0;
  const reasons = [];

  const raw = String(claim?.rawText || "");
  const items = claim?.items || [];
  const provider = claim?.provider || {};

  if (!provider.hospitalName) { score += 18; reasons.push("Missing hospital/clinic name"); }
  if (!provider.invoiceNumber) { score += 18; reasons.push("Missing invoice/bill number"); }
  if (!provider.gstin) { score += 10; reasons.push("Missing GSTIN (many Indian invoices include it)"); }
  if (!provider.registrationNumber) { score += 10; reasons.push("Missing provider registration number"); }
  if (!provider.doctorName) { score += 6; reasons.push("Missing doctor name"); }

  if (raw.length < 250) { score += 12; reasons.push("Document text is very short / low detail"); }
  if (items.length <= 1) { score += 10; reasons.push("Too few itemized charges"); }

  const genericTerms = ["service", "charge", "treatment", "consultation", "fees", "general", "misc", "procedure"];
  const genericHits = genericTerms.filter((t) => raw.toLowerCase().includes(t)).length;
  if (genericHits >= 5) { score += 10; reasons.push("Many generic terms; low specificity"); }

  const roundLarge = items.filter((i) => (Number(i.amount) || 0) >= 10000 && isRoundNumber(Number(i.amount) || 0)).length;
  if (roundLarge >= 2) { score += 10; reasons.push("Multiple large round-number charges"); }

  const totals = decision?.totals;
  if (totals && typeof totals.requested === "number" && totals.requested <= 0) {
    score += 10;
    reasons.push("No requested total detected");
  }

  if (String(decision?.status || "").toUpperCase() === "REJECT" && raw.length > 800) {
    score += 6;
    reasons.push("Rejected claim with long/structured text (possible intent mismatch)");
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 65 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
  return { score, level, reasons };
}

function claimRiskScore({ claim, decision }) {
  let score = 0;
  const reasons = [];
  const total = Number(decision?.totals?.requested || 0);
  const diagnosis = safeLower(claim?.diagnosis || "");
  const triggers = decision?.triggers || [];
  const status = String(decision?.status || "").toUpperCase();

  if (total >= 250000) { score += 35; reasons.push("Very high claim amount"); }
  else if (total >= 120000) { score += 22; reasons.push("High claim amount"); }
  else if (total >= 60000) { score += 12; reasons.push("Moderate-high claim amount"); }

  if (diagnosis.includes("surgery") || diagnosis.includes("procedure")) { score += 12; reasons.push("Surgical claim complexity"); }
  if (diagnosis.includes("cosmetic") || diagnosis.includes("plastic")) { score += 22; reasons.push("Potential exclusion category"); }
  if (diagnosis.includes("experimental") || diagnosis.includes("gene")) { score += 25; reasons.push("Experimental treatment risk"); }

  if (triggers.includes("WAITING_PERIOD")) { score += 30; reasons.push("Waiting period mismatch"); }
  if (triggers.includes("EXCLUSION_CLAUSE")) { score += 28; reasons.push("Policy exclusion match"); }
  if (triggers.includes("LOW_RETRIEVAL_CONFIDENCE")) { score += 12; reasons.push("Low clause retrieval confidence"); }

  if (status === "REJECT") score += 15;
  if (status === "PARTIAL") score += 8;
  if (status === "REVIEW") score += 18;

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";
  return { riskScore: score, riskLevel: level, reasons };
}

function fraudAndAnomalyFlags({ claim, decision }) {
  const flags = [];
  const items = claim?.items || [];
  const totals = computeTotals(items);

  if (!claim?.patientName) flags.push({ severity: "MED", code: "MISSING_PATIENT_NAME", detail: "Patient name not found in claim text." });
  if (!claim?.serviceDate) flags.push({ severity: "MED", code: "MISSING_SERVICE_DATE", detail: "Service/admission date not found in claim text." });
  if (!claim?.diagnosis) flags.push({ severity: "MED", code: "MISSING_DIAGNOSIS", detail: "Diagnosis not found in claim text." });

  const sd = parseDateLoose(claim?.serviceDate);
  const ps = parseDateLoose(claim?.policyStartDate);
  if (sd && ps) {
    const deltaDays = diffInDays(sd, ps);
    if (deltaDays < 0) {
      flags.push({
        severity: "HIGH",
        code: "SERVICE_BEFORE_POLICY_START",
        detail: `Service date (${claim.serviceDate}) is before policy start (${claim.policyStartDate}).`
      });
    }
    if (deltaDays >= 0 && deltaDays <= 2) {
      flags.push({
        severity: "MED",
        code: "CLAIM_SOON_AFTER_POLICY_START",
        detail: `Claim is very soon after policy start (${deltaDays} days).`
      });
    }
  }

  if (totals.total > 250000) flags.push({ severity: "HIGH", code: "HIGH_TOTAL_AMOUNT", detail: `Total claim amount is high: ₹${totals.total}` });
  else if (totals.total > 100000) flags.push({ severity: "MED", code: "ELEVATED_TOTAL_AMOUNT", detail: `Total claim amount is elevated: ₹${totals.total}` });

  const seen = new Map();
  for (const i of items) {
    const k = safeLower(i.description || "").replace(/\s+/g, " ").trim();
    if (!k) continue;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const [k, n] of seen.entries()) {
    if (n >= 2) flags.push({ severity: "MED", code: "DUPLICATE_LINE_ITEMS", detail: `Duplicate line item appears ${n} times: "${k}"` });
  }

  const roomLines = (decision?.lineItems || []).filter((l) => l.category === "ROOM_RENT");
  for (const l of roomLines) {
    if (l.status === "PARTIAL" && (l.requested || 0) >= 2 * (l.payable || 0)) {
      flags.push({
        severity: "MED",
        code: "ROOM_RENT_INFLATION_SUSPECT",
        detail: `Room rent requested (₹${l.requested}) is much higher than payable cap (₹${l.payable}).`
      });
    }
  }

  const largeRound = items.filter((i) => (Number(i.amount) || 0) >= 20000 && isRoundNumber(Number(i.amount) || 0));
  if (largeRound.length >= 2) {
    flags.push({
      severity: "LOW",
      code: "MULTIPLE_ROUND_LARGE_CHARGES",
      detail: `Multiple large charges are round numbers (${largeRound.length} items).`
    });
  }

  const maxLine = items.reduce((best, i) => Math.max(best, Number(i.amount) || 0), 0);
  if (maxLine >= 200000) flags.push({ severity: "HIGH", code: "VERY_HIGH_SINGLE_CHARGE", detail: `A single line item is very high: ₹${maxLine}` });

  const risk = fraudRiskFromSignals({ claim, decision });
  if (risk.level !== "LOW") {
    flags.push({
      severity: risk.level === "HIGH" ? "HIGH" : "MED",
      code: "FAKE_DOCUMENT_SUSPECT",
      detail: `Fraud risk ${risk.level} (score ${risk.score}/100): ${risk.reasons.join("; ")}`
    });
  }

  return flags;
}

module.exports = { fraudAndAnomalyFlags, fraudRiskFromSignals, claimRiskScore };

