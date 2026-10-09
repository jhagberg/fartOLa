// Authored for fartola. Not ported from upstream.
//
// Reactive props for StartTimeHistory.test.ts ($state needs a .svelte.ts file).
export const historyProps = $state({
  competitionId: 'c1',
  classNames: { h21: 'H21' } as Record<string, string>,
  refreshKey: 0,
});
