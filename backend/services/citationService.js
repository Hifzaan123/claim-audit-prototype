function makeCitation(clause) {
  if (!clause) return null;
  const page = clause.page ?? "?";
  const paragraph = clause.paragraph ?? "?";
  const clauseId = clause.clauseId ?? null;
  const quote = clause.text ? String(clause.text).slice(0, 260) : null;

  return {
    page,
    paragraph,
    clauseId,
    quote,
    label: `Page ${page}, Paragraph ${paragraph}`
  };
}

module.exports = { makeCitation };