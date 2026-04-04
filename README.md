# Insurance Claim Settlement Agent

Entry for **The Big Code 2026** — the insurance claim settlement track.

The idea is straightforward: you throw in a hospital bill (and optionally a discharge note) plus a policy PDF. The app pulls text out (PDF or OCR for scans), finds the relevant policy clauses, runs a bunch of rules, and spits out approve / reject / partial / needs review. When something gets knocked back, it tries to point to **where in the policy** that came from (page + paragraph + a short snippet).

Stack is Node, Express, pdfjs + Tesseract, Xenova transformers for embeddings/NER, plus hand-written rules. Nothing fancy trained on real claims — it’s a prototype.

---

### If you’re grading this (README links)

Repo has to be **public** on GitHub so people can open the files without asking for access. That’s the GitHub version of “anyone with the link.”

For the form we usually pasted something like:

```
Primary README: https://github.com/USER/REPO/blob/main/README.md
Backend README: https://github.com/USER/REPO/blob/main/backend/README.md
```

Swap `USER`, `REPO`, and `main` if your default branch is `master`. To grab the URL: open the file on GitHub and copy what’s in the address bar.

---

### What we actually implemented vs the brief

OCR/text: PDFs go through pdfjs; images through Tesseract (`documentTextExtractor`, `ocrService`).

NLP: clause retrieval uses embeddings (`nlpService`), with a keyword fallback if models don’t load. Claims get a bit of NER when it works (`claimExtractor`).

Matching: bill + optional discharge get merged; `ruleEngine` walks line items against retrieved clauses.

Rules: waiting periods, exclusions, room rent caps, plus a few “send to human” style gates.

Citations: each line can carry a citation; there’s `primaryCitation` on the decision and `citationAudit` to catch obvious misses on rejections.

Tests: `backend/data/synthetic-tests.json`, hit `GET /api/run-tests` or `GET /api/evaluation` with the server up.

More detail on the data folder script lives in `backend/README.md`.

---

### Setup

Need **Node 18+**. Works on Windows / Mac / Linux from what we tried.

From the repo root:

```bash
npm run install:backend
npm start
```

Then open http://localhost:5000

Or if you’re already in `backend/`:

```bash
npm install
npm run start
```

First boot can take a while — it downloads the transformer models once.

---

### Other npm scripts

`npm run generate:demo-pdfs` — rebuilds the sample PDFs under `backend/data/demo-pdfs/`

`npm run collect:data` — reads stuff from `backend/data/raw/` and writes processed output + splits (see backend README)

---

### API (quick reference)

`POST /api/analyze` — JSON body with `policyText` and `claimText`

`POST /api/analyze-files` — multipart: `policyFile`, `claimFile`, optional `dischargeSummaryFile`

`GET /api/sample` — canned text for a quick try

`GET /api/run-tests` — runs the synthetic suite

`GET /api/evaluation` — same tests packaged as a report (we used this for submission)

`GET /api/analytics` — rough stats from runs in memory (demo only)

---

### Where things live

`backend/` — server, `public/` UI, routes, services  
`backend/data/synthetic-tests.json` — test scenarios  
`backend/services/` — extraction, NLP, rules, evaluation, etc.

If you don’t have real claims to use, the template for logging external datasets you might add later is `backend/data/data-sources.template.json`.

---

### License

Pick something sensible for the hackathon and check licenses on bundled model weights (Xenova pulls from Hugging Face–style repos).

---

### Write-up PDF

`HACKATHON_SUBMISSION.md` is only there to copy into Word/Docs and export to PDF — it’s not executed by the app. Deadline and filename were in the organizer email (`YourName_The Big Code_2026.pdf`, Drive link, etc.).
