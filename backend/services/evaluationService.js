const fs = require("fs");
const path = require("path");

const { parsePolicyClauses } = require("./policyParser");
const { extractClaimFields } = require("./claimExtractor");
const { decideClaim } = require("./ruleEngine");

async function runSyntheticTests() {
  const raw = fs.readFileSync(path.join(__dirname, "..", "data", "synthetic-tests.json"), "utf8");
  const tests = JSON.parse(raw);

  const out = [];
  for (const t of tests) {
    const clauses = parsePolicyClauses(t.policyText);
    const claim = await extractClaimFields(t.claimText);
    const decision = await decideClaim(claim, clauses);
    const passed = String(decision.status).toUpperCase() === String(t.expectedStatus).toUpperCase();

    const expected = t.expected || {};
    const topQuote = decision.retrieval?.topMatches?.[0]?.text || "";
    const citationOk = expected.citationMustContain
      ? String(topQuote).toLowerCase().includes(String(expected.citationMustContain).toLowerCase())
      : null;

    const payableOk = typeof expected.minPayable === "number" ? (decision.totals?.payable || 0) >= expected.minPayable : null;

    const fieldChecks = [];
    if (expected.fields?.diagnosis) {
      fieldChecks.push({
        field: "diagnosis",
        expected: expected.fields.diagnosis,
        actual: claim.diagnosis,
        ok: String(claim.diagnosis || "").toLowerCase().includes(String(expected.fields.diagnosis).toLowerCase())
      });
    }

    out.push({
      id: t.id,
      expectedStatus: t.expectedStatus,
      actualStatus: decision.status,
      passed,
      checks: {
        citationOk,
        payableOk,
        fields: fieldChecks
      },
      totals: decision.totals,
      triggers: decision.triggers,
      topCitation: decision.retrieval?.topMatches?.[0]?.citation || null,
      citationAudit: decision.citationAudit || null
    });
  }

  const passedCount = out.filter((r) => r.passed).length;
  const citationChecked = out.filter((r) => r.checks.citationOk !== null);
  const citationOkCount = citationChecked.filter((r) => r.checks.citationOk).length;
  const payableChecked = out.filter((r) => r.checks.payableOk !== null);
  const payableOkCount = payableChecked.filter((r) => r.checks.payableOk).length;

  const summary = {
    total: out.length,
    passed: passedCount,
    passRate: out.length ? passedCount / out.length : 0,
    citationChecks: {
      total: citationChecked.length,
      ok: citationOkCount,
      rate: citationChecked.length ? citationOkCount / citationChecked.length : null
    },
    payableChecks: {
      total: payableChecked.length,
      ok: payableOkCount,
      rate: payableChecked.length ? payableOkCount / payableChecked.length : null
    },
    citationIntegrity: {
      testsWithFullRejectionCitations: out.filter((r) => r.citationAudit?.rejectionsFullyCited !== false).length,
      total: out.length
    }
  };

  return { summary, results: out };
}

function buildHackathonEvaluationReport(summary, results) {
  return {
    event: "The Big Code 2026",
    problemStatement: "Insurance Claim Settlement Agent",
    howWeAddressIt: {
      ocr: "Hospital bills & policies: PDF text extraction (pdfjs-dist); images → Tesseract.js OCR.",
      nlp: "Clause retrieval via embeddings (Xenova/all-MiniLM-L6-v2) with token-overlap fallback; NER enrichment on claims (Xenova/bert-base-NER when available).",
      reconciliation: "Claim line items vs parsed policy clauses; waiting period, exclusions, room-rent caps; optional discharge summary merged with bill text.",
      ruleEngine: "Deterministic rules + compliance gate (documentation / fraud escalation → REVIEW).",
      transparency:
        "Each line item includes citation (Page, Paragraph, clause id, snippet). primaryCitation + citationAudit summarize rejection citation coverage for judges."
    },
    evaluationRubricMapping: {
      impactAndUniqueness_weight20pct:
        "Explainable adjudication, risk/fraud signals, multi-document flow, audit-friendly citations.",
      dsAiArchitecture_weight50pct:
        "Embeddings + NER + modular rule engine; scalable data pipeline (npm run collect:data) with train/val/test splits.",
      codeQuality_weight10pct:
        "Separated services: policyParser, claimExtractor, nlpService, ruleEngine, fraudService, routes.",
      modelEvaluationAndTesting_weight20pct: {
        syntheticSuite: "backend/data/synthetic-tests.json",
        endpoints: ["GET /api/run-tests", "GET /api/evaluation"],
        metrics: {
          decisionAccuracyPassRate: summary.passRate,
          citationSnippetChecksPassRate: summary.citationChecks.rate,
          payableAmountChecksPassRate: summary.payableChecks.rate,
          rejectionCitationIntegrityTests: `${summary.citationIntegrity.testsWithFullRejectionCitations}/${summary.citationIntegrity.total} scenarios fully cited on rejections`
        }
      }
    },
    summary,
    results
  };
}

module.exports = {
  runSyntheticTests,
  buildHackathonEvaluationReport
};
