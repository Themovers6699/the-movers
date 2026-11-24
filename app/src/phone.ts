// Phone helpers. Numbers are STORED as +1XXXXXXXXXX (the database converts them on save, which Twilio,
// Square and duplicate matching rely on). People never need to type or see the +1:
// the app shows (469) 555-0199 and search ignores dashes, spaces, brackets and the leading 1.

const digitsOf = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

// Ten-digit US number without the country code, or null if it isn't a valid US number.
function national(v: string | null | undefined): string | null {
  let d = digitsOf(v);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : null;
}

/** For display: "(469) 555-0199". Anything that isn't a valid US number is shown as typed. */
export function formatPhone(v: string | null | undefined): string {
  const d = national(v);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (v ?? '');
}

/** For sending to functions that require +1XXXXXXXXXX. Returns null if not a valid US number. */
export function toE164(v: string | null | undefined): string | null {
  const d = national(v);
  return d ? '+1' + d : null;
}

/** True if the search text matches the phone by digits. Needs at least 3 digits typed. */
export function phoneMatches(search: string, phone: string | null | undefined): boolean {
  const q = digitsOf(search);
  if (q.length < 3 || !phone) return false;
  const stored = national(phone) ?? digitsOf(phone);
  return stored.includes(q.length === 11 && q.startsWith('1') ? q.slice(1) : q);
}
