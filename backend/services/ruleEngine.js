const { makeCitation } = require("./citationService");
const { semanticTopK } = require("./nlpService");
const { parseDateLoose, diffInMonthsApprox } = require("./dateUtils");
const { fraudAndAnomalyFlags, fraudRiskFromSignals, claimRiskScore } = require("./fraudService");

function safeLower(text) {
  return String(text || "").toLowerCase();
}

function parseRoomRentLimit(text) {
  const t = safeLower(text);
  if (!t.includes("room rent")) return null;
  const m = t.match(/up\s*to\s*(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*)/i);
  if (!m) return null;
  return Number(String(m[1]).replace(/,/g, ""));
}

function parseWaitingPeriodMonths(text) {
  const t = safeLower(text);
  if (!t.includes("waiting period")) return null;
  const m = t.match(/waiting\s*period\s*(?:of)?\s*(\d+)\s*(month|months|year|years|day|days)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit.startsWith("year")) return n * 12;
  if (unit.startsWith("day")) return n / 30.4375;
  return n;
}

function isExcludedClause(text) {
  const t = safeLower(text);
  return t.includes("not covered") || t.includes("excluded") || t.includes("exclusion");
}

function looksLikeRoomRentItem(desc) {
  const t = safeLower(desc);
  return t.includes("room rent") || t.includes("room") || t.includes("icu rent") || t.includes("ward");
}

function classifyItem(desc) {
  const t = safeLower(desc);
  if (looksLikeRoomRentItem(t)) return "ROOM_RENT";
  if (t.includes("medicine") || t.includes("drug")) return "MEDICINE";
  if (t.includes("diagnostic") || t.includes("test") || t.includes("lab") || t.includes("mri") || t.includes("ct")) return "DIAGNOSTIC";
  if (t.includes("surgery") || t.includes("operation") || t.includes("procedure")) return "PROCEDURE";
  return "OTHER";
}

function clauseForCitation(citationClause, best, top) {
  return citationClause || best || top[0]?.clause || null;
}

function primaryCitationFromLineItems(lineItems, best, top) {
  const rej = (lineItems || []).find((i) => i.status === "REJECTED" && i.citation);
  if (rej?.citation) return rej.citation;
  const partial = (lineItems || []).find((i) => i.status === "PARTIAL" && i.citation);
  if (partial?.citation) return partial.citation;
  return makeCitation(best || top[0]?.clause || null);
}

function buildCitationAudit(lineItems) {
  const rejectedLines = (lineItems || []).filter((i) => i.status === "REJECTED");
  const audit = {
    hackathonRequirement:
      "Rejected line items must cite the triggering policy passage (page + paragraph) when a matching clause exists.",
    rejectedLineCount: rejectedLines.length,
    rejectionsFullyCited: true,
    linesMissingPolicyCitation: []
  };
  for (const li of rejectedLines) {
    const c = li.citation;
    if (!c || c.page == null || c.paragraph == null) {
      audit.rejectionsFullyCited = false;
      audit.linesMissingPolicyCitation.push({ description: li.description || "", reason: li.reason || "" });
    }
  }
  return audit;
}

function suggestionFromDecision({ status, triggers, lineItems }) {
  const rejectedCount = (lineItems || []).filter((x) => x.status === "REJECTED").length;
  if (triggers.includes("MANDATORY_DOCUMENTS_MISSING")) {
    return "Manual review pending: upload complete hospital bill package (hospital name, invoice number, provider registration, treating doctor, and discharge summary).";
  }
  if (triggers.includes("HIGH_FRAUD_RISK_MANUAL_REVIEW")) {
    return "Claim routed to investigation queue due to high fraud indicators. Submit original stamped bills and provider verification documents.";
  }
  if (triggers.includes("DATE_VALIDATION_FAILED")) {
    return "Date validation failed. Provide clear policy start date and service/admission date documents.";
  }
  if (triggers.includes("WAITING_PERIOD")) {
    return "Waiting period not completed. Re-submit after waiting period end date or claim only covered non-procedure expenses.";
  }
  if (triggers.includes("EXCLUSION_CLAUSE")) {
    return "This treatment appears excluded. Check rider/add-on benefits (OPD, accidental cover, critical illness) and try the appropriate bucket.";
  }
  if (status === "PARTIAL") {
    return "Some items are payable. Submit itemized bills and separate capped charges (e.g., room rent) to maximize approved payout.";
  }
  if (status === "REVIEW") {
    return "Upload clearer documents (invoice number, hospital registration, discharge summary) for a higher-confidence decision.";
  }
  if (rejectedCount === 0) {
    return "Claim looks healthy. Keep all supporting documents for final insurer audit.";
  }
  return "Please verify policy clauses and submit missing supporting documents.";
}

function getMissingComplianceFields(claim) {
  const missing = [];
  if (!claim?.patientName) missing.push("patientName");
  if (!claim?.serviceDate) missing.push("serviceDate");
  if (!claim?.policyStartDate) missing.push("policyStartDate");
  if (!claim?.diagnosis) missing.push("diagnosis");
  if (!claim?.provider?.hospitalName) missing.push("provider.hospitalName");
  if (!claim?.provider?.invoiceNumber) missing.push("provider.invoiceNumber");
  if (!claim?.provider?.registrationNumber) missing.push("provider.registrationNumber");
  return missing;
}

function applyComplianceGate({ claim, currentStatus, triggerSet, fraudRisk, totalRequested }) {
  const holdReasons = [];
  let status = currentStatus;
  const extraTriggers = [];
  const missing = getMissingComplianceFields(claim);

  if (missing.length > 0) {
    extraTriggers.push("MANDATORY_DOCUMENTS_MISSING");
    holdReasons.push(`Mandatory fields missing: ${missing.join(", ")}`);
  }

  if (!claim?.serviceDate || !claim?.policyStartDate) {
    extraTriggers.push("DATE_VALIDATION_FAILED");
    holdReasons.push("Policy start date and service date are mandatory for timeline checks.");
  }

  if (String(fraudRisk?.level || "").toUpperCase() === "HIGH") {
    extraTriggers.push("HIGH_FRAUD_RISK_MANUAL_REVIEW");
    holdReasons.push("High fraud risk score requires manual investigation (SIU-style review).");
  }

  if (totalRequested >= 200000 && missing.length > 0) {
    extraTriggers.push("HIGH_AMOUNT_WITH_WEAK_DOCUMENTATION");
    holdReasons.push("High-value claim with incomplete documentation cannot be auto-approved.");
  }

  const mustReview = extraTriggers.length > 0 && status !== "REJECT";
  if (mustReview) status = "REVIEW";

  return {
    status,
    extraTriggers,
    compliance: {
      rulebook: "real-time-insurer-gate-v1",
      holdReasons,
      missingFields: missing,
      manualReviewRequired: mustReview
    }
  };
}

async function decideClaim(claim, clauses) {
  const query = [
    claim.diagnosis || "",
    ...(claim.items || []).map((i) => i.description),
    claim.rawText || ""
  ].join(" ");

  const top = await semanticTopK(query, clauses, 8);
  const best = top[0]?.clause || null;
  const bestScore = top[0]?.score ?? 0;
  const retrievalMethod = top[0]?.method || "unknown";

  const triggers = [];
  let anomalies = [];

  const serviceDate = parseDateLoose(claim.serviceDate);
  const policyStart = parseDateLoose(claim.policyStartDate);
  const monthsSinceStart = serviceDate && policyStart ? diffInMonthsApprox(serviceDate, policyStart) : null;

  let roomRentLimit = null;
  let waitingMonths = null;
  const exclusionClauses = [];

  for (const r of top) {
    const txt = r.clause?.text || "";
    const rr = parseRoomRentLimit(txt);
    if (rr != null) roomRentLimit = roomRentLimit == null ? rr : Math.min(roomRentLimit, rr);

    const wm = parseWaitingPeriodMonths(txt);
    if (wm != null) waitingMonths = waitingMonths == null ? wm : Math.max(waitingMonths, wm);

    if (isExcludedClause(txt)) exclusionClauses.push(r.clause);
  }

  const lineItems = [];
  let totalRequested = 0;
  let totalPayable = 0;

  for (const item of claim.items || []) {
    const requested = Number(item.amount) || 0;
    totalRequested += requested;
    const category = classifyItem(item.description || "");

    let status = "COVERED";
    let payable = requested;
    let reason = "Covered under policy (no blocking trigger detected).";
    let citationClause = best;

    const textBlob = safeLower([claim.diagnosis || "", item.description || ""].join(" "));
    const matchedExclusion = exclusionClauses.find((c) => {
      const ct = safeLower(c.text || "");
      return (ct.includes("cosmetic") && textBlob.includes("cosmetic")) ||
        (ct.includes("dental") && textBlob.includes("dental")) ||
        (ct.includes("not covered") && (textBlob.includes("cosmetic") || textBlob.includes("dental")));
    });
    if (matchedExclusion) {
      status = "REJECTED";
      payable = 0;
      reason = "Rejected: excluded under policy.";
      citationClause = matchedExclusion;
      triggers.push("EXCLUSION_CLAUSE");
    }

    const itemLooksLikeProcedure = category === "PROCEDURE" || safeLower(item.description).includes("surgery") || safeLower(item.description).includes("procedure");
    if (status !== "REJECTED" && waitingMonths != null && itemLooksLikeProcedure) {
      if (monthsSinceStart != null && monthsSinceStart < waitingMonths) {
        status = "REJECTED";
        payable = 0;
        reason = `Rejected: waiting period not completed (${monthsSinceStart.toFixed(1)} months since start; requires ${waitingMonths} months).`;
        const waitingClause = top.find((r) => safeLower(r.clause?.text || "").includes("waiting period"))?.clause || best;
        citationClause = waitingClause;
        triggers.push("WAITING_PERIOD");
      }
    }

    if (status !== "REJECTED" && category === "ROOM_RENT" && roomRentLimit != null) {
      if (requested > roomRentLimit) {
        status = "PARTIAL";
        payable = roomRentLimit;
        reason = `Partial: room rent capped at ₹${roomRentLimit} per day (prototype assumes 1 day if not specified).`;
        const rrClause = top.find((r) => safeLower(r.clause?.text || "").includes("room rent"))?.clause || best;
        citationClause = rrClause;
        triggers.push("ROOM_RENT_SUBLIMIT");
      }
    }

    totalPayable += payable;
    lineItems.push({
      description: item.description,
      category,
      requested,
      payable,
      status,
      reason,
      citation: makeCitation(clauseForCitation(citationClause, best, top))
    });
  }

  const anyRejected = lineItems.some((i) => i.status === "REJECTED");
  const anyPartial = lineItems.some((i) => i.status === "PARTIAL");

  let status = "APPROVE";
  if (anyRejected && totalPayable === 0) status = "REJECT";
  else if (anyRejected || anyPartial) status = "PARTIAL";

  const diagLower = safeLower(claim.diagnosis || "");
  if (diagLower.includes("experimental") || diagLower.includes("gene therapy") || diagLower.includes("gene-therapy")) {
    triggers.push("INVESTIGATIONAL_TREATMENT_REVIEW");
    status = "REVIEW";
  }

  const confidence = Math.max(0.5, Math.min(0.95, 0.62 + bestScore));
  if (!best || bestScore < 0.12) {
    triggers.push("LOW_RETRIEVAL_CONFIDENCE");
    status = "REVIEW";
  }

  anomalies = fraudAndAnomalyFlags({ claim, decision: { status, totals: { requested: totalRequested, payable: totalPayable }, lineItems } });
  const fraudRisk = fraudRiskFromSignals({ claim, decision: { status, totals: { requested: totalRequested, payable: totalPayable }, lineItems } });

  let triggerSet = Array.from(new Set(triggers));

  const complianceGate = applyComplianceGate({
    claim,
    currentStatus: status,
    triggerSet,
    fraudRisk,
    totalRequested
  });
  status = complianceGate.status;
  triggerSet = Array.from(new Set(triggerSet.concat(complianceGate.extraTriggers)));

  const reason =
    status === "APPROVE"
      ? "Approved: policy match passed and compliance checks are complete."
      : status === "REJECT"
        ? "Rejected: requested charges are blocked by policy terms (exclusion/waiting/rule constraints)."
        : status === "PARTIAL"
          ? "Partial: some line items are payable while others are rejected/capped by policy rules."
          : `Review: routed for manual adjudication. ${complianceGate.compliance.holdReasons[0] || "Additional verification required."}`;

  const suggestion = suggestionFromDecision({ status, triggers: triggerSet, lineItems });
  const claimRisk = claimRiskScore({ claim, decision: { status, triggers: triggerSet, totals: { requested: totalRequested, payable: totalPayable }, lineItems } });
  const citationAudit = buildCitationAudit(lineItems);
  const primaryCitation = primaryCitationFromLineItems(lineItems, best, top);

  const highlightTerms = Array.from(
    new Set(
      [claim.diagnosis, ...(claim.items || []).map((x) => x.description)]
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4)
        .concat(
          (safeLower(claim.diagnosis).includes("plastic") ? ["cosmetic"] : []),
          (safeLower(claim.diagnosis).includes("cosmetic") ? ["plastic"] : [])
        )
    )
  ).slice(0, 8);

  return {
    status,
    confidence,
    reason,
    triggers: triggerSet,
    primaryCitation,
    citationAudit,
    retrieval: {
      method: retrievalMethod,
      topMatches: top.slice(0, 3).map((r) => ({
        score: r.score,
        clauseId: r.clause?.clauseId,
        citation: makeCitation(r.clause),
        text: r.clause?.text
      }))
    },
    totals: { requested: totalRequested, payable: totalPayable },
    lineItems,
    anomalies,
    fraudRisk,
    claimRisk,
    compliance: complianceGate.compliance,
    suggestion,
    highlightTerms
  };
}

module.exports = { decideClaim };