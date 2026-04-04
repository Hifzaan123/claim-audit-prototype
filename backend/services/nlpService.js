function safeLower(text) {
  return String(text || "").toLowerCase();
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

let _pipelines = null;
let _initError = null;

async function initPipelines() {
  if (_pipelines || _initError) return;
  try {
    const { pipeline } = await import("@xenova/transformers");
    const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    const ner = await pipeline("token-classification", "Xenova/bert-base-NER", { aggregation_strategy: "simple" });
    _pipelines = { embedder, ner };
  } catch (e) {
    _initError = e;
  }
}

async function getEmbedding(text) {
  await initPipelines();
  if (!_pipelines?.embedder) return null;

  const out = await _pipelines.embedder(text, { pooling: "mean", normalize: true });
  if (Array.isArray(out)) return out;
  if (out?.data) return Array.from(out.data);
  if (out?.tolist) return out.tolist();
  return null;
}

async function extractEntities(text) {
  await initPipelines();
  if (!_pipelines?.ner) return { entities: [], available: false, error: _initError ? String(_initError) : null };

  const ents = await _pipelines.ner(text);
  const entities = (ents || []).map((e) => ({
    type: e.entity_group || e.entity || "UNKNOWN",
    text: e.word,
    score: e.score
  }));

  return { entities, available: true, error: null };
}

async function semanticTopK(queryText, clauses, k = 5) {
  const qEmb = await getEmbedding(queryText);
  if (qEmb) {
    const scored = [];
    for (const clause of clauses || []) {
      const cEmb = clause._embedding || (clause.text ? await getEmbedding(clause.text) : null);
      if (cEmb) clause._embedding = cEmb;
      const score = cEmb ? cosine(qEmb, cEmb) : 0;
      scored.push({ clause, score, method: "embeddings" });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  const qTokens = new Set(
    safeLower(queryText)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );

  const scored = (clauses || []).map((clause) => {
    const tokens = safeLower(clause.text || "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    let hit = 0;
    for (const t of tokens) if (qTokens.has(t)) hit += 1;
    const score = tokens.length ? hit / tokens.length : 0;
    return { clause, score, method: "token-overlap" };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

module.exports = {
  extractEntities,
  semanticTopK
};

