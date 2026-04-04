# Backend notes

Start with the [main README](../README.md) in the repo root — that’s the one with install steps and the full picture. This file is mostly backend-only stuff: API shape, demo flow, and the `collect:data` script.

---

### What runs here

Express serves the static UI from `public/` and everything under `/api`.

You can upload a policy PDF and a bill (PDF or image). Text comes out via pdfjs or Tesseract. The policy gets chopped into clauses tagged by page/paragraph. Then retrieval + rules decide line by line: covered, rejected, partial, or kicked to review. Rejections try to attach the clause they’re leaning on.

Response includes stuff like confidence, which rules fired, and some basic fraud-ish flags — it’s all pretty transparent on purpose.

---

### Run it

```bash
cd backend
npm install
npm run start
```

http://localhost:5000

---

### Showing it to someone in ~2 min

Load sample → Analyze text. Walk through the status, one citation, requested vs payable, then hit Run tests so they see the synthetic suite pass rate. If you have time, do a real PDF upload.

---

### Endpoints

`POST /api/analyze` — `{ "policyText": "...", "claimText": "..." }`

`POST /api/analyze-files` — form fields `policyFile`, `claimFile`, optional `dischargeSummaryFile`

`GET /api/sample`

`GET /api/run-tests`

`GET /api/evaluation` — JSON report built from the same tests (handy for judges)

In the decision object, `primaryCitation` is the main policy hook for the outcome; `citationAudit` is a sanity check that rejected lines aren’t missing a citation when we had clause text to use.

---

### Heads-up

OCR is slower than native PDF text. This whole thing was built for a hackathon — don’t ship it to production as-is.

---

### Data when you don’t have real claims

We leaned on synthetic tests plus made-up sample PDFs. In the real world you’d pull in public policy PDFs, invoice datasets, etc., and actually read their licenses. The registry file for that is `data/data-sources.template.json` — fill it in as you add sources.

---

### `collect:data` pipeline

Drop raw files under `data/raw/`:

- `policies/` — policy docs  
- `claims/` — bills  
- `discharge-summaries/` — discharge text/PDFs  

Then:

```bash
npm run collect:data
```

You get `data/processed/dataset.jsonl`, per-doc JSON under `data/processed/documents/`, a `summary.json`, train/val/test splits under `data/processed/splits/`, and `quality-report.json`. Claim and discharge docs also get structured fields extracted where the parser can find them.

`data/processed/` is gitignored; regenerate whenever you change inputs.
