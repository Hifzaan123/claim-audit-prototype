# READ THIS FIRST (not code)

- **This file is only a written summary** for you to copy into **Word / Google Docs** and export as **PDF**. It is **not** part of the running app (“code”). You can delete this file from the folder after you submit if you want; it is there so you have one place with all sections filled.
- **GitHub repository:** This project lives on **your computer** until **you** create a repo on **github.com**, push your code, and set it to **public**. Nobody else can “make” your repo for you—you paste **your** link in the Google form and in the table below.
- **“Points” / bullets:** Those are **section headings** from Google’s template so you don’t miss anything. Replace only the lines that say **YOUR_…**.

---

# Official submission checklist (from email)

| Requirement | What to do |
|-------------|------------|
| **Deadline** | **April 5, Sunday, 11:59 PM IST** (final) |
| **PDF file name** | `YourName_The Big Code_2026.pdf` (use **your** real name) |
| **Length** | Summary **≤ 4 pages** (this draft is tight; remove References extras if you go over) |
| **Upload** | Put the PDF on **Google Drive** → Share → **Anyone with the link** (Viewer) → paste that link in the **submission form** |
| **README / repo links** | Put **GitHub** (and any other) links in the **form** **and** in this document (table below) |

---

# The Big Code 2026 — Solution Summary (Insurance Claim Settlement Agent)

**Project Name:** Insurance Claim Settlement Agent  

**Participant Name:** YOUR_FULL_NAME  

**Participant Email ID:** YOUR_EMAIL (same as hackathon mail)  

**Participant Year of Degree:** YOUR_YEAR (1st / 2nd / 3rd / 4th or Dual Degree)  

**README / repository links (required)**  

| Link type | URL |
|-----------|-----|
| **Public GitHub repository** | `https://github.com/YOUR_USERNAME/YOUR_REPO` |
| **Primary README** (paste in form with a label) | `Primary README: https://github.com/YOUR_USERNAME/YOUR_REPO/blob/main/README.md` |
| **Backend README** (optional, labeled) | `Supplementary README: https://github.com/YOUR_USERNAME/YOUR_REPO/blob/main/backend/README.md` |

Use branch **`main`** or **`master`** to match your repo. **Public repo** = view access for anyone (no Drive sharing).

---

## Brief Summary

We present a prototype **Insurance Claim Settlement Agent** aligned with the problem statement: use **OCR** and **NLP** to read **hospital bills** (and optional **discharge summary**) together with **policy PDFs**, then **approve, reject, partially pay, or send for review** using a **rule engine**. For every line item that is denied or capped, the system returns a **precise citation**—**page and paragraph** (and clause id + snippet)—so the decision is **auditable**. The stack is **Node.js + Express**, **PDF text extraction (pdfjs)**, **Tesseract OCR** for images, **embedding-based clause retrieval** with a **fallback**, **NER**-based field enrichment where available, and a **synthetic test suite** plus **`GET /api/evaluation`** for **rubric-style evaluation**.

---

## Problem Statement

**What we are solving:** Claim processing is slow and opaque; patients often cannot see **which clause** in the policy caused a denial or a partial payment. Bills arrive as PDFs or scans; policies are long legal documents.  

**Why it matters:** Without transparency, trust drops and disputes rise. Insurers need **consistent** application of rules at scale.  

**For whom:** **Policyholders** (clarity), **insurers / TPAs** (automation + audit trail), and **compliance** (traceable decisions).  

**Our choice of problem statement:** **Insurance Claim Settlement Agent** (The Big Code 2026).

---

## Design Idea and Approach

**Pipeline (short):** Upload **policy + bill** (+ optional **discharge**) → extract text (PDF or OCR) → parse **policy into clauses** → extract **claim fields and line items** → **retrieve top matching clauses** (embeddings + fallback) → **rule engine** (waiting period, exclusions, room-rent caps, investigational review, low-confidence review, compliance / fraud escalation) → output **status**, **totals**, **per-line reasons**, and **citations**.

**Technologies:** JavaScript, Express, pdfjs-dist, tesseract.js, @xenova/transformers (embeddings + NER when loaded), custom rule and evaluation modules, static web UI.

**What we built:** Services for extraction, parsing, NLP retrieval, decisions, fraud/risk signals, citations, and a **synthetic test suite**; REST APIs including **`/api/evaluation`** for judges; optional **data ingestion** script for scaling (`collect:data`).

**Scaling (honest):** Bottlenecks are **model load**, **CPU** for OCR/embeddings, and **clause count**. A production system would use **queued workers**, **cached embeddings**, **GPU or hosted embedding API**, and a **database** for cases—not required for this prototype.

**Rollout:** Shadow mode → limited LOB with strict human review on low confidence → broader rollout with monitoring.

**Security / privacy:** Demo runs locally; production needs encryption, access control, retention policy, and consent for any cloud OCR/LLM.

**Core logic:** **Hybrid** — ML/NLP finds **relevant policy text**; **rules** apply **deterministic** insurance logic; citations tie **decisions** to **policy wording**.

### The approach used to generate the algorithm

*(This is the item called out in the official template under Design Idea and Approach.)*

**What “the algorithm” is here:** We do **not** train a proprietary end-to-end neural network on private claims data (not available in a hackathon). The **decision algorithm** is a **composed system**: (1) **information extraction**, (2) **clause relevance scoring**, (3) **deterministic policy rules** on structured inputs, (4) **citation attachment** — so outputs stay **explainable** and **testable**.

**Step A — Build structured inputs from documents**  
- **Policy:** Text is split into **page / paragraph clauses** with stable ids (so “page + paragraph” citations are well-defined).  
- **Claim:** Regex (and **NER** when the model loads) extracts **patient, dates, diagnosis, provider fields, and line items** (description + amount). Optional **discharge summary** text is **concatenated** with the bill so clinical context improves extraction.

**Step B — Generate “which clauses matter” (retrieval algorithm)**  
- We form a **query string** from diagnosis, line descriptions, and raw claim text.  
- Each clause and the query are embedded with a **pretrained** sentence model (**MiniLM-class** via `@xenova/transformers`). We rank clauses by **cosine similarity** and take the **top-k**.  
- If embeddings are unavailable, we fall back to **token-overlap** scoring so the pipeline still runs.  
- *Rationale:* Legal wording varies; dense retrieval finds **semantically related** clauses beyond exact keywords.

**Step C — Generate the approve / reject / partial decision (rule algorithm)**  
- From the top retrieved clauses we **parse numeric / boolean constraints** with **patterns** (e.g. **waiting period** months, **room rent** cap, **exclusion** phrasing).  
- For **each bill line item**, we assign a **category** (e.g. procedure vs room rent), then apply **if–then rules**: exclusion match → **reject line**; waiting period not met for procedures → **reject line**; room rent above cap → **partial line**; else **covered**.  
- **Overall status** aggregates line outcomes (e.g. all lines rejected → **REJECT**, mixed → **PARTIAL**).  
- Additional **governance rules** force **REVIEW** for **low retrieval confidence**, **investigational treatments**, or **compliance / fraud** escalation—mirroring real **manual adjudication** queues.

**Step D — Generate citations (transparency algorithm)**  
- Every line outcome stores **`makeCitation(clause)`**: **page, paragraph, clause id, snippet**. We use the **clause that triggered** the rule when possible, with **fallback** to the best retrieved clause so rejections are still grounded in policy text where feasible. **`citationAudit`** checks that **rejected** lines cite a passage when a clause exists.

**Step E — How we validate the algorithm**  
- **`synthetic-tests.json`** defines scenarios with **expected status** and optional **citation substring** and **payable** checks.  
- **`GET /api/run-tests`** and **`GET /api/evaluation`** run the full pipeline and report **pass rate** and rubric-aligned metrics for reviewers.

In one line: **pretrained embeddings for “where to look” + hand-auditable rules for “what to decide” + explicit citations for “why.”**

---

## Impact

*(Template prompts: societal challenge and extent; research/data grounding; deployment plan; expected outcomes.)*

**1. Societal challenge and extent**  
Health insurance claims are often **slow** and **hard to understand**: patients receive a denial or a partial payment without a clear link to the **exact policy wording**. That erodes **trust**, increases **stress** (especially during illness), and fuels **disputes** and repeated calls to insurers. Our project addresses this by automating **first-pass adjudication** with **line-level decisions** and **page-and-paragraph citations**, so people can see **why** each charge was allowed, capped, or rejected. The **extent** of impact at prototype stage is **demonstration and methodology**; at scale, the same design reduces opaque decisions for **millions** of claims processed annually by insurers and TPAs, and supports **fairer**, more **consistent** treatment of similar cases.

**2. Grounding in research and data (problem and solution)**  
**Problem side:** The difficulty of opaque, document-heavy claims is widely documented in **industry practice** (OCR/NLP in claims workflows, need for audit trails) and aligns with the **hackathon problem statement** itself. **Solution side:** We ground the approach in established **NLP** ideas—**semantic retrieval** over long documents and **structured extraction** from forms and bills—combined with **rule-based** policy logic that insurers already use in principle. **Empirically**, we use a **synthetic test suite** (`synthetic-tests.json`) with **expected outcomes** and **citation checks**, and an **`/api/evaluation`** report so performance is **measurable**, not only narrative. Where **real** claims cannot be used, we follow organizer guidance: **proxy datasets** and **synthetic** scenarios, with a path to swap in licensed real data later.

**3. Plan to deploy the AI for real-world impact**  
**Near term (prototype):** Run **locally** or on a **small cloud VM** for demos; judges and partners try the **UI** and **APIs**. **Pilot path:** **Shadow mode**—the engine runs **in parallel** with human adjusters; disagreements are logged; rules and retrieval are tuned on **de-identified** production samples under contract. **Production path:** **Queue-based** workers for OCR/embeddings, **encrypted** document storage, **role-based access**, **human-in-the-loop** for **REVIEW** outcomes, and **regulatory** review of auto-decision scope. **Rollout** is deliberately **phased** (see Design: Rollout) so automation never skips **mandatory** human sign-off where regulation requires it.

**4. Expected outcomes**  
- **For patients:** Fewer “black box” denials; **understandable** explanations tied to **policy text**.  
- **For insurers:** **Faster** triage, **consistent** application of waiting periods and limits, **lower** handling cost for straightforward claims, and a **traceable** log for **audit** and **complaints**.  
- **For society:** Stronger **transparency** in a critical financial–health interface, and a **reusable** open pattern (OCR + retrieval + rules + citations) for other **regulated** document workflows.

---

## Feasibility

*(Template: execution plan; data + AI expertise; partners / domain experts.)*

**Plan:** The **end-to-end prototype** is implemented and **reproducible** (README: install, `npm start`, UI + APIs including **`/api/evaluation`**). Next steps stay incremental: harden logging/errors, optional **job queue** for OCR/embeddings, accuracy pass on **de-identified** samples when available, small **cloud** demo for stakeholders—not a claim of full unsupervised automation.

**Data & skills:** **Hackathon path:** in-repo **synthetic tests** (`synthetic-tests.json`), **sample text**, and **demo PDFs**; **`data-sources.template.json`** registers **planned** public or credentialed sources as we add them. **AI:** pretrained **embeddings + NER** (see References) plus **rules**; quality is **measured** via the test suite and evaluation endpoint.

**Partners:** Judges review **GitHub + this PDF**. For real rollout: **insurer/TPA**, **legal/compliance**, and **claims/adjuster** SMEs for rule and wording sign-off—**AI + governance**, not black-box-only decisions.

---

## Use of AI

**Semantic retrieval** over policy clauses; **NER** for claim entities when available; **heuristic** risk/fraud signals—combined with **explicit rules** and **citations**, not a black-box “approve only” model.

---

## Alternatives Considered

- **Keywords only** — weak on synonyms and legal phrasing.  
- **LLM-only end-to-end** — harder to audit and to ground every rejection in a **specific clause**.  
- **Cloud-only OCR** — strong but adds cost and data-handling obligations for a student prototype.

---

## References and Appendices

*(Template: supporting references, mocks, diagrams or demos; public datasets used to predict or solve the problem.)*

**Demos & supporting materials**  
- **Runnable demo:** Clone the **public GitHub** repo → follow **README** (`npm run install:backend`, `npm start`) → open **`http://localhost:5000`**.  
- **Short walkthrough (for judges):** **Load Sample** → **Analyze** → show **decision**, **line items**, and **page/paragraph citations**; optionally upload **policy + bill PDFs**; show **`GET /api/evaluation`** (and **`/api/run-tests`**) for pass rate / rubric-style metrics.  
- **Optional video:** Add a **2-minute screen recording** link (e.g. Drive unlisted / YouTube) in the submission form or table above when you have it.  
- **Diagram / mock:** One **pipeline figure** in the PDF is enough: same flow as **Design Idea** (upload → extract/OCR → clause split → retrieval → rules → citations + UI). No separate Figma required unless you want a UI mock.

**Public datasets, models, and data sources**  
- **Pretrained models (in use):** Sentence embeddings **`Xenova/all-MiniLM-L6-v2`** and NER **`Xenova/bert-base-NER`** via **`@xenova/transformers`** (Hugging Face–style public weights; see each model’s **card** for license). These support **retrieval** and **entity hints**; **decisions** are from **rules**, not end-to-end training on private claims.  
- **In-repo evaluation data (not third-party downloads):** **`backend/data/synthetic-tests.json`** (hand-authored scenarios) and **`backend/data/demo-pdfs/`** (project-generated demo PDFs).  
- **Planned public / proxy datasets (registered, not yet required for the demo):** **`backend/data/data-sources.template.json`** lists examples such as **public policy PDFs** (e.g. regulator/insurer sites), **synthetic claims tables** (e.g. Kaggle-style sources—verify license), **invoice-OCR** research sets, and **credentialed clinical notes** (e.g. PhysioNet MIMIC-IV-Note)—**status: planned**; use only after **license** and **access** checks.

**References (documentation)**  
- **pdfjs-dist**, **tesseract.js**, **@xenova/transformers** — project dependencies; follow upstream licenses for submission.  
- **IRDAI / insurer** public circulars and policy wordings — contextual reading for Indian insurance wording (cite specific URLs if you rely on them in narrative).

---

*Before submitting: export this content to PDF, name it **`YourName_The Big Code_2026.pdf`**, upload to Google Drive with **anyone with the link** can view, submit before **April 5, 11:59 PM IST**.*
