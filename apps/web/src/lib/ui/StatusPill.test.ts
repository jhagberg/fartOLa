// Authored for fartola. Not ported from upstream.
//
// X3 (UI audit 2026-10-09): a pill never shows a raw status code; without
// a label it shows the operator word (status.*), with a label (results:
// SOFT's published word) it shows that.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import StatusPill from './StatusPill.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

function text(props: {
  status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
  label?: string;
}): string {
  instance = mount(StatusPill, { target: document.body, props: { ...props, tooltip: false } });
  flushSync();
  return document.body.querySelector('.status')?.textContent?.trim() ?? '';
}

describe('StatusPill label', () => {
  it.each([
    ['OK', 'Godkänd'],
    ['MP', 'Felstämplad'],
    ['DNF', 'Utgått'],
    ['PEND', 'Väntar'],
    ['DNS', 'Ej start'],
    ['DQ', 'Diskad'],
    ['CANCEL', 'Återbud'],
    ['MAX', 'Maxtid'],
  ] as const)('%s → "%s"', (status, word) => {
    expect(text({ status })).toBe(word);
  });

  it('uses the label it is given (results pass SOFT words)', () => {
    expect(text({ status: 'MP', label: 'Ej godkänd' })).toBe('Ej godkänd');
  });
});
