const $ = (id) => document.getElementById(id);

function setBusy(isBusy) {
  const buttons = document.querySelectorAll("button, input[type=file], textarea");
  buttons.forEach((el) => (el.disabled = isBusy));
  document.body.style.cursor = isBusy ? "progress" : "default";
}

function showDecision(payload) {
  const d = payload.decision;
  $("resultCard").hidden = false;

  const badge = $("statusBadge");
  badge.className = "badge";
  badge.textContent = d.status || "—";
  const s = String(d.status || "").toUpperCase();
  if (s === "APPROVE") badge.classList.add("approve");
  else if (s === "REJECT") badge.classList.add("reject");
  else if (s === "PARTIAL") badge.classList.add("partial");
  else badge.classList.add("review");

  $("resultSubtitle").textContent =
    payload.extraction
      ? `Extracted policy/pages: ${payload.extraction.policy.pages}, claim/pages: ${payload.extraction.claim.pages}`
      : "Text analysis";

  $("reason").textContent = d.reason || "—";
  $("confidence").textContent = typeof d.confidence === "number" ? `${Math.round(d.confidence * 100)}%` : "—";
  $("triggers").textContent = (d.triggers && d.triggers.length) ? d.triggers.join("\n") : "None";

  const totals = d.totals || {};
  $("totals").textContent =
    (typeof totals.requested === "number" || typeof totals.payable === "number")
      ? `Requested: ₹${totals.requested ?? "—"}\nPayable: ₹${totals.payable ?? "—"}`
      : "—";

  const top = d.retrieval?.topMatches?.[0];
  const cite = d.primaryCitation || top?.citation;
  if (cite) {
    $("citation").textContent = `${cite.label}${cite.clauseId ? ` (${cite.clauseId})` : ""}`;
    const quoteRaw = top?.text || cite.quote || top?.citation?.quote || "—";
    const terms = Array.isArray(d.highlightTerms) ? d.highlightTerms : [];
    let highlighted = quoteRaw;
    for (const term of terms) {
      const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
      highlighted = highlighted.replace(re, "<mark>$1</mark>");
    }
    $("quote").innerHTML = highlighted;
  } else {
    $("citation").textContent = "—";
    $("quote").innerHTML = "—";
  }

  const ca = d.citationAudit;
  $("citationAudit").textContent = ca
    ? `${ca.hackathonRequirement}\n\nRejected line items: ${ca.rejectedLineCount}\nAll rejections cite a policy passage: ${ca.rejectionsFullyCited ? "YES" : "NO"}${
        ca.linesMissingPolicyCitation?.length
          ? `\n\nMissing citation:\n${ca.linesMissingPolicyCitation.map((x) => `- ${x.description || "(item)"}: ${x.reason || ""}`).join("\n")}`
          : ""
      }`
    : "—";

  // Line items table
  const items = Array.isArray(d.lineItems) ? d.lineItems : [];
  const rows = items.map((it) => {
    const st = String(it.status || "").toUpperCase();
    const badge =
      st === "REJECTED" ? `<span class="tag fail">REJECTED</span>` :
      st === "PARTIAL" ? `<span class="tag fail" style="border-color:rgba(250,204,21,0.32);background:rgba(250,204,21,0.16);color:#fff2bf;">PARTIAL</span>` :
      `<span class="tag pass">COVERED</span>`;
    const cit = it.citation?.label ? `${it.citation.label}${it.citation.clauseId ? ` (${it.citation.clauseId})` : ""}` : "—";
    return `
      <tr>
        <td>${badge}</td>
        <td class="mono">${it.description || "—"}</td>
        <td class="mono">${it.category || "—"}</td>
        <td class="mono">₹${it.requested ?? "—"}</td>
        <td class="mono">₹${it.payable ?? "—"}</td>
        <td class="mono">${cit}</td>
        <td class="mono">${it.reason || "—"}</td>
      </tr>
    `;
  }).join("");

  $("lineItems").innerHTML = items.length ? `
    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Description</th>
            <th>Category</th>
            <th>Requested</th>
            <th>Payable</th>
            <th>Citation</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  ` : `<div class="mono">No line items detected.</div>`;

  const anomalies = Array.isArray(d.anomalies) ? d.anomalies : [];
  $("anomalies").textContent = anomalies.length ? anomalies.map(a => `- ${a.code}: ${a.detail}`).join("\n") : "None";

  const fr = d.fraudRisk;
  $("fraudRisk").textContent = fr
    ? `Level: ${fr.level}\nScore: ${fr.score}/100\nSignals:\n- ${fr.reasons.join("\n- ")}`
    : "—";

  const cr = d.claimRisk;
  $("claimRisk").textContent = cr
    ? `riskScore: ${cr.riskScore}\nriskLevel: ${cr.riskLevel}\nFactors:\n- ${cr.reasons.join("\n- ")}`
    : "—";

  const comp = d.compliance;
  const compText = comp
    ? `Compliance Gate: ${comp.rulebook}\nManual Review Required: ${comp.manualReviewRequired ? "YES" : "NO"}${comp.holdReasons?.length ? `\nHold Reasons:\n- ${comp.holdReasons.join("\n- ")}` : ""}`
    : "";
  $("suggestion").textContent = compText ? `${d.suggestion || "—"}\n\n${compText}` : (d.suggestion || "—");
}

async function apiJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || "Invalid server response");
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

$("loadSample").addEventListener("click", async () => {
  try {
    setBusy(true);
    const data = await apiJson("/api/sample");
    $("policyText").value = data.policyText || "";
    $("claimText").value = data.claimText || "";
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
});

$("analyzeText").addEventListener("click", async () => {
  try {
    setBusy(true);
    const policyText = $("policyText").value;
    const claimText = $("claimText").value;
    const payload = await apiJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policyText, claimText }),
    });
    showDecision(payload);
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
});

$("filesForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    // Important: create FormData BEFORE disabling inputs.
    // Disabled form fields are omitted by the browser, including file inputs.
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    const payload = await apiJson("/api/analyze-files", { method: "POST", body: form });
    showDecision(payload);
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
});

$("runTests").addEventListener("click", async () => {
  try {
    setBusy(true);
    const data = await apiJson("/api/run-tests");
    const s = data.summary;
    const cit = s.citationChecks?.rate == null ? "—" : `${Math.round(s.citationChecks.rate * 100)}%`;
    const pay = s.payableChecks?.rate == null ? "—" : `${Math.round(s.payableChecks.rate * 100)}%`;
    $("testSummary").textContent = `Decision: ${Math.round(s.passRate * 100)}% (${s.passed}/${s.total}) • Citation: ${cit} • Payable: ${pay}`;
    const wrap = $("testResults");
    wrap.style.display = "block";

    const rows = data.results
      .map((r) => {
        const tag = r.passed ? `<span class="tag pass">PASS</span>` : `<span class="tag fail">FAIL</span>`;
        const citation = r.topCitation?.label ? `${r.topCitation.label}${r.topCitation.clauseId ? ` (${r.topCitation.clauseId})` : ""}` : "—";
        const checks = r.checks || {};
        const cOk = checks.citationOk === null ? "—" : (checks.citationOk ? "OK" : "BAD");
        const pOk = checks.payableOk === null ? "—" : (checks.payableOk ? "OK" : "BAD");
        return `
          <tr>
            <td>${tag}</td>
            <td>${r.id}</td>
            <td>${r.expectedStatus}</td>
            <td>${r.actualStatus}</td>
            <td>${citation}</td>
            <td>${`citation=${cOk}<br/>payable=${pOk}`}</td>
          </tr>
        `;
      })
      .join("");

    wrap.innerHTML = `
      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Result</th>
              <th>Test</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Citation</th>
              <th>Checks</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
});

async function refreshAnalytics() {
  let a = null;
  let usedFallback = false;
  try {
    a = await apiJson("/api/analytics");
  } catch {
    // Backward compatibility: older backend builds may not expose /api/analytics.
    // Derive a lightweight snapshot from test results so dashboard still works.
    const tests = await apiJson("/api/run-tests");
    const results = Array.isArray(tests.results) ? tests.results : [];
    const total = results.length;
    const count = (status) => results.filter((r) => String(r.actualStatus || "").toUpperCase() === status).length;
    const pct = (n) => (total ? Number(((n / total) * 100).toFixed(1)) : 0);
    const fraudHigh = results.filter((r) => {
      const triggers = Array.isArray(r.triggers) ? r.triggers.map((t) => String(t).toUpperCase()) : [];
      return triggers.includes("FRAUD_HIGH") || triggers.includes("FRAUD_SUSPECTED");
    }).length;
    a = {
      total,
      approvedPct: pct(count("APPROVE")),
      partialPct: pct(count("PARTIAL")),
      rejectedPct: pct(count("REJECT")),
      reviewPct: pct(count("REVIEW")),
      fraudCasesPct: pct(fraudHigh),
    };
    usedFallback = true;
  }
  $("analyticsSummary").textContent = usedFallback
    ? `Total analyzed: ${a.total} (fallback from test dataset)`
    : `Total analyzed: ${a.total}`;
  const rows = [
    ["Approved", a.approvedPct, "#4ade80"],
    ["Partial", a.partialPct, "#facc15"],
    ["Rejected", a.rejectedPct, "#f87171"],
    ["Review", a.reviewPct, "#93c5fd"],
    ["Fraud(high)", a.fraudCasesPct, "#fb7185"],
  ];
  $("analyticsBars").innerHTML = rows.map(([name, v, c]) => `
    <div style="margin:8px 0;">
      <div class="mono" style="margin-bottom:4px;">${name}: ${v}%</div>
      <div style="height:10px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;">
        <div style="height:100%;width:${Math.max(2, v)}%;background:${c};"></div>
      </div>
    </div>
  `).join("");
}

$("refreshAnalytics").addEventListener("click", async () => {
  try {
    setBusy(true);
    await refreshAnalytics();
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
});

function installTilt(el, strength = 6) {
  if (!el || !window.gsap) return;
  el.addEventListener("mousemove", (ev) => {
    const rect = el.getBoundingClientRect();
    const px = (ev.clientX - rect.left) / rect.width;
    const py = (ev.clientY - rect.top) / rect.height;
    const rotY = (px - 0.5) * strength * 2;
    const rotX = (0.5 - py) * strength * 2;
    window.gsap.to(el, {
      rotateX: rotX,
      rotateY: rotY,
      z: 6,
      duration: 0.28,
      ease: "power2.out",
      transformPerspective: 900
    });
  });
  el.addEventListener("mouseleave", () => {
    window.gsap.to(el, {
      rotateX: 0,
      rotateY: 0,
      z: 0,
      duration: 0.42,
      ease: "power2.out"
    });
  });
}

function initMotionUi() {
  if (!window.gsap) return;

  window.gsap.set("body", { perspective: 1100 });
  window.gsap.from(".brand, .heroArt", {
    y: 20,
    opacity: 0,
    duration: 0.8,
    ease: "power2.out",
    stagger: 0.08
  });
  window.gsap.from(".brandIcon, .heroArt, .chipIcon", {
    y: 18,
    opacity: 0,
    duration: 0.75,
    ease: "back.out(1.3)",
    stagger: 0.08,
    delay: 0.1
  });
  window.gsap.to(".heroArt", {
    y: 8,
    duration: 2.6,
    yoyo: true,
    repeat: -1,
    ease: "sine.inOut"
  });
  window.gsap.to(".brandIcon", {
    y: 4,
    duration: 2.1,
    yoyo: true,
    repeat: -1,
    ease: "sine.inOut"
  });

  document.querySelectorAll(".heroArt, .brandIcon").forEach((el) => installTilt(el, 8));
  document.querySelectorAll(".chipIcon").forEach((el) => installTilt(el, 12));
  document.querySelectorAll(".btn").forEach((btn) => {
    btn.addEventListener("mouseenter", () => {
      window.gsap.to(btn, { y: -2, scale: 1.015, duration: 0.2, ease: "power2.out" });
    });
    btn.addEventListener("mouseleave", () => {
      window.gsap.to(btn, { y: 0, scale: 1, duration: 0.22, ease: "power2.out" });
    });
  });
}

initMotionUi();

