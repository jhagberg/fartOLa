// Authored for fartola. Not ported from upstream.
// Date check for the new-competition wizard.

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** ISO shape AND a real calendar day (2026-13-99 and 2027-02-29 are not). */
export function validDate(v: string): boolean {
  if (!isoDate.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
