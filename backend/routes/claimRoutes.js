const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const { parsePolicyClauses, parsePolicyClausesFromPages } = require("../services/policyParser");
const { extractClaimFields } = require("../services/claimExtractor");
const { decideClaim } = require("../services/ruleEngine");
const { extractTextFromUploadedFile } = require("../services/documentTextExtractor");
const { runSyntheticTests, buildHackathonEvaluationReport } = require("../services/evaluationService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const analyticsState = { total: 0, statuses: { APPROVE: 0, PARTIAL: 0, REJECT: 0, REVIEW: 0 }, fraudHigh: 0 };

function recordAnalytics(decision) {
  analyticsState.total += 1;
  const status = String(decision?.status || "REVIEW").toUpperCase();
  if (!analyticsState.statuses[status]) analyticsState.statuses[status] = 0;
  analyticsState.statuses[status] += 1;
  if (String(decision?.fraudRisk?.level || "").toUpperCase() === "HIGH") analyticsState.fraudHigh += 1;
}

router.post("/analyze", async (req, res) => {
  const { policyText, claimText } = req.body;

  if (!policyText || !claimText) {
    return res.status(400).json({ error: "policyText and claimText are required" });
  }

  const clauses = parsePolicyClauses(policyText);
  const claim = await extractClaimFields(claimText);
  const decision = await decideClaim(claim, clauses);
  recordAnalytics(decision);

  return res.json({ claim, clauses, decision });
});

router.get("/sample", (req, res) => {
  try {
    const policyText = fs.readFileSync(path.join(__dirname, "..", "data", "sample-policy.txt"), "utf8");
    const claimText = fs.readFileSync(path.join(__dirname, "..", "data", "sample-claim.txt"), "utf8");
    return res.json({ policyText, claimText });
  } catch {
    return res.status(500).json({ error: "Failed to load sample data" });
  }
});

router.get("/run-tests", async (req, res) => {
  try {
    const { summary, results } = await runSyntheticTests();
    return res.json({ summary, results });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to run tests" });
  }
});

router.get("/evaluation", async (req, res) => {
  try {
    const { summary, results } = await runSyntheticTests();
    return res.json(buildHackathonEvaluationReport(summary, results));
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Failed to build evaluation report" });
  }
});

router.get("/analytics", (req, res) => {
  const total = analyticsState.total || 0;
  const pct = (n) => (total ? Number(((n / total) * 100).toFixed(1)) : 0);
  return res.json({
    total,
    approvedPct: pct(analyticsState.statuses.APPROVE || 0),
    partialPct: pct(analyticsState.statuses.PARTIAL || 0),
    rejectedPct: pct(analyticsState.statuses.REJECT || 0),
    reviewPct: pct(analyticsState.statuses.REVIEW || 0),
    fraudCasesPct: pct(analyticsState.fraudHigh || 0),
    raw: analyticsState
  });
});

router.post(
  "/analyze-files",
  upload.fields([
    { name: "policyFile", maxCount: 1 },
    { name: "claimFile", maxCount: 1 },
    { name: "dischargeSummaryFile", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const policyFile = req.files?.policyFile?.[0];
      const claimFile = req.files?.claimFile?.[0];
      const dischargeSummaryFile = req.files?.dischargeSummaryFile?.[0] || null;

      if (!policyFile || !claimFile) {
        return res.status(400).json({ error: "policyFile and claimFile are required (dischargeSummaryFile optional but recommended)" });
      }

      const policyExtraction = await extractTextFromUploadedFile(policyFile);
      const claimExtraction = await extractTextFromUploadedFile(claimFile);
      const dischargeExtraction = dischargeSummaryFile ? await extractTextFromUploadedFile(dischargeSummaryFile) : null;

      const clauses = parsePolicyClausesFromPages(policyExtraction.pages);
      const combinedClaimText = dischargeExtraction
        ? `${claimExtraction.fullText}\n\nDischarge Summary:\n${dischargeExtraction.fullText}`
        : claimExtraction.fullText;
      const claim = await extractClaimFields(combinedClaimText);
      const decision = await decideClaim(claim, clauses);
      recordAnalytics(decision);

      return res.json({
        extraction: {
          policy: { pages: policyExtraction.pages.length, chars: policyExtraction.fullText.length },
          claim: { pages: claimExtraction.pages.length, chars: claimExtraction.fullText.length },
          dischargeSummary: dischargeExtraction
            ? { pages: dischargeExtraction.pages.length, chars: dischargeExtraction.fullText.length }
            : null
        },
        claim,
        decision
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "Failed to analyze files" });
    }
  }
);

module.exports = router;

