function parseDateLoose(s) {
  const str = String(s || "").trim();
  if (!str) return null;

  // Try ISO first
  const iso = new Date(str);
  if (!Number.isNaN(iso.getTime())) return iso;

  // Try dd/mm/yyyy or dd-mm-yyyy
  const m = str.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yyyy = Number(m[3]);
    const d = new Date(Date.UTC(yyyy, mm, dd));
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

function diffInDays(a, b) {
  if (!a || !b) return null;
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function diffInMonthsApprox(a, b) {
  const days = diffInDays(a, b);
  if (days == null) return null;
  return days / 30.4375;
}

module.exports = { parseDateLoose, diffInDays, diffInMonthsApprox };

