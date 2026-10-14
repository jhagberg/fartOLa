// Authored for fartola. Not ported from upstream.
//
// Reactive props for CorrectionsPanel.test.ts ($state needs a .svelte.ts file).
// `obj` stands for the readout's competitor object, rebuilt after every read;
// `readKey` for the runner's latest read.
export const panelProps = $state({ obj: { id: 'r1' }, readKey: 'k1' });
