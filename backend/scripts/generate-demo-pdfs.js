const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writePdf(filePath, { title, pages }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);

    doc.fontSize(18).text(title, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333").text("Generated demo PDF for testing this prototype.", { italic: true });

    pages.forEach((p, i) => {
      if (i > 0) doc.addPage();
      doc.fillColor("#000").fontSize(12).moveDown(1.2);
      doc.fontSize(13).text(p.heading);
      doc.moveDown(0.6);
      doc.fontSize(11).text(p.body, { lineGap: 4 });
      doc.moveDown(1);
      doc.fillColor("#555").fontSize(10).text(`Page ${i + 1}`, { align: "right" });
    });

    doc.end();
    out.on("finish", resolve);
    out.on("error", reject);
  });
}

async function main() {
  const outDir = path.join(__dirname, "..", "data", "demo-pdfs");
  ensureDir(outDir);
  const suffix = "_v2";

  await writePdf(path.join(outDir, `policy_demo_1${suffix}.pdf`), {
    title: "Health Insurance Policy Wording (Demo #1)",
    pages: [
      {
        heading: "Section 1 — Coverage Overview",
        body:
          [
            "1. Hospitalization is covered.",
            "2. Diagnostic tests are covered.",
            "3. Room rent is covered up to Rs 3000 per day.",
            "",
            "Definitions:",
            "- Hospitalization means admission > 24 hours unless otherwise stated."
          ].join("\n")
      },
      {
        heading: "Section 2 — Exclusions",
        body:
          [
            "4. Cosmetic surgery is not covered (excluded).",
            "5. Dental treatment is not covered unless due to accident.",
            "",
            "Note: Expenses that fall under exclusions are rejected with clause citation."
          ].join("\n")
      },
      {
        heading: "Section 3 — Waiting Periods",
        body:
          [
            "6. Knee surgery is covered after a waiting period of 12 months from policy start date.",
            "7. Pre-existing conditions are covered only after 36 months waiting period.",
            "",
            "This demo is designed to trigger page+paragraph citations."
          ].join("\n")
      }
    ]
  });

  await writePdf(path.join(outDir, `claim_demo_1${suffix}.pdf`), {
    title: "Hospital Bill (Demo #1)",
    pages: [
      {
        heading: "Patient + Admission Details",
        body:
          [
            "Patient: Rahul Kumar",
            "Service Date: 10/02/2026",
            "Policy Start Date: 01/01/2026",
            "Diagnosis: Knee surgery",
            "",
            "This claim should trigger the waiting period clause."
          ].join("\n")
      },
      {
        heading: "Itemized Charges",
        body:
          [
            "Knee surgery - 50000",
            "Room rent - 8000",
            "Diagnostic tests - 2500"
          ].join("\n")
      }
    ]
  });

  await writePdf(path.join(outDir, `claim_demo_2_cosmetic${suffix}.pdf`), {
    title: "Hospital Bill (Demo #2 - Cosmetic)",
    pages: [
      {
        heading: "Patient + Admission Details",
        body:
          [
            "Patient: Asha Singh",
            "Service Date: 18/03/2026",
            "Policy Start Date: 01/01/2024",
            "Diagnosis: Cosmetic surgery"
          ].join("\n")
      },
      {
        heading: "Itemized Charges",
        body: ["Cosmetic surgery - 120000", "Room rent - 2000"].join("\n")
      }
    ]
  });

  await writePdf(path.join(outDir, `policy_demo_2${suffix}.pdf`), {
    title: "Health Insurance Policy Wording (Demo #2)",
    pages: [
      {
        heading: "Section 1 — Benefits",
        body:
          [
            "1. Hospitalization is covered.",
            "2. Medicines are covered during hospitalization.",
            "3. Diagnostic tests are covered.",
            "4. Room rent is covered up to Rs 5000 per day."
          ].join("\n")
      },
      {
        heading: "Section 2 — Exclusions",
        body:
          [
            "5. Dental treatment is not covered unless due to accident.",
            "6. Cosmetic surgery is excluded."
          ].join("\n")
      }
    ]
  });

  await writePdf(path.join(outDir, `claim_demo_3_roomrent_only${suffix}.pdf`), {
    title: "Hospital Bill (Demo #3 - Room Rent Cap)",
    pages: [
      {
        heading: "Patient + Admission Details",
        body:
          [
            "Patient: John Doe",
            "Service Date: 05/04/2026",
            "Policy Start Date: 01/01/2025",
            "Diagnosis: Hospitalization"
          ].join("\n")
      },
      {
        heading: "Itemized Charges",
        body: ["Room rent - 15000", "Medicines - 1800"].join("\n")
      }
    ]
  });

  console.log("Demo PDFs generated in:", outDir);
  console.log("Files:");
  for (const f of fs.readdirSync(outDir)) console.log(" -", f);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

