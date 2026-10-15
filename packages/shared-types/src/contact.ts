// Authored for fartola. Not ported from upstream.
//
// A light check of a hire card's contact details, shared by the screen (on
// blur) and the edge (authoritative). Empty is valid here: "phone or e-mail"
// is a separate rule.

/** At least 5 digits, and nothing but digits, spaces, `+` and `-`. */
export function phoneValid(phone: string): boolean {
  const v = phone.trim();
  return /^[\d\s+-]+$/.test(v) && v.replace(/\D/g, '').length >= 5;
}

/** One `@` with text on both sides. */
export function emailValid(email: string): boolean {
  return /^[^@\s]+@[^@\s]+$/.test(email.trim());
}
