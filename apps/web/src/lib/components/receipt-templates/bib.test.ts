// Authored for fartola. Not ported from upstream.
//
// SOFT TR 7.5.4: the receipt mirror's Klassisk and Detaljerad show the
// runner's bib next to the class and club, as the printed receipt does.

import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

import Classic from './Classic.svelte';
import Detailed from './Detailed.svelte';
import type { ReceiptRead } from './types.ts';

const read = (bib: string | null): ReceiptRead => ({
  cardNumber: 123,
  name: 'Anna Ek',
  cls: 'H21',
  classId: 'h21',
  club: 'OK Ek',
  bib,
  startTime: '—',
  readTime: '11:00:00',
  elapsed: '45:00',
  status: 'OK',
  statusLabel: 'Godkänd',
  place: 1,
  punches: [],
  progress: { place: 1, finishedInClass: 1, startersInClass: 1, behind: null },
  competitionName: 'Test',
  competitionDate: '2026-10-10',
});

describe('receipt mirror bib (SOFT TR 7.5.4)', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  for (const [name, template] of [
    ['Klassisk', Classic],
    ['Detaljerad', Detailed],
  ] as const) {
    it(`${name} shows the bib when the runner has one`, () => {
      component = mount(template, { target: document.body, props: { read: read('A101') } });
      flushSync();
      expect(document.body.textContent).toContain('H21 · OK Ek · Startnr A101');
      void unmount(component);
      component = mount(template, { target: document.body, props: { read: read(null) } });
      flushSync();
      expect(document.body.textContent).not.toContain('Startnr');
    });
  }
});
