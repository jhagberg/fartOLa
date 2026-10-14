// Authored for fartola. Not ported from upstream.
//
// Reactive props for EditRunnerRead.test.ts ($state needs a .svelte.ts file).
// `obj` stands for a parent's competitor object, rebuilt after every refetch.
export const readProps = $state({ obj: { id: 'r1' }, reloadKey: 0, readKey: 'k1' });
