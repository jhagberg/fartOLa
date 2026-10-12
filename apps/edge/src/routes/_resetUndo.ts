// Authored for fartola. Not ported from upstream.
//
// Which race resets an undo takes back (POST …/reset-race/undo). The rule:
//
//   - A reset can be undone when it is not undone already and it took
//     results away (cards read, or runners timed by hand, that stopped
//     counting). A reset after a start by mistake took nothing. The number
//     is recorded in the race_reset event when the reset is made (`took`);
//     a reset from before that field existed cannot be undone.
//   - The undo goes back to the LATEST such reset and also takes back every
//     reset made after it (those took nothing away).
//   - So a reset stops being undoable when it is undone, and it waits while a
//     later reset that took results away is still outstanding: that one is
//     undone first, as a step of its own.
//
// A new start does not end it: "reset, then start again" is the mistake the
// undo exists for.

/** `outstanding`: the resets that are not undone, oldest first, each with how
 * many results it took away. Returns the ones an undo takes back, the first
 * of them being the target the operator confirms. */
export function resetsToUndo<T extends { took: number }>(outstanding: readonly T[]): T[] {
  const from = outstanding.findLastIndex((r) => r.took > 0);
  return from === -1 ? [] : outstanding.slice(from);
}
