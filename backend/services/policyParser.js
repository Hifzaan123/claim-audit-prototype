function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoParagraphs(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const hasBlankLine = /\n\s*\n/.test(normalized);
  const hasMultipleLines = (normalized.match(/\n/g) || []).length >= 2;

  // If the policy is line-separated (common when extracted), treat each line as a paragraph.
  if (!hasBlankLine && hasMultipleLines) {
    return normalized
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
  }

  // Otherwise, prefer true paragraphs; fallback to non-empty lines.
  const paras = normalized
    .split(/\n\s*\n/g)
    .map(p => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  return paras.length > 0
    ? paras
    : normalized
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
}

function parsePolicyClausesFromPages(pages) {
  const clauses = [];
  let idx = 1;

  for (const page of pages || []) {
    const pageNumber = page.pageNumber ?? page.page ?? 1;
    const paras = splitIntoParagraphs(page.text || "");
    let paragraph = 1;

    for (const p of paras) {
      clauses.push({
        clauseId: `C${String(idx).padStart(4, "0")}`,
        page: pageNumber,
        paragraph,
        text: p
      });
      idx += 1;
      paragraph += 1;
    }
  }

  return clauses;
}

function parsePolicyClauses(policyText) {
  return parsePolicyClausesFromPages([{ pageNumber: 1, text: policyText }]);
}

module.exports = { parsePolicyClauses, parsePolicyClausesFromPages };