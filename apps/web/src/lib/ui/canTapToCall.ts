// Authored for fartola. Not ported from upstream.
//
// A tel: link is only useful on a touch screen. On a laptop it hands the
// number to whatever handles tel: (Zoom, Teams), so show plain text there.
export function canTapToCall(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
