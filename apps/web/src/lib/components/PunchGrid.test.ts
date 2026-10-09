// apps/web/src/lib/components/PunchGrid.test.ts
// Authored for fartola. Not ported from upstream.
//
// Punch tiles (design-lab spec): every state says what it is in words,
// tiles shrink above 20 course controls, and without a course no tile
// claims to be correct.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PunchGrid from './PunchGrid.svelte';
import type { ReceiptPunch } from './receipt-templates/types.ts';

const ok = (code: number): ReceiptPunch => ({ code, split: '2:00', time: '2:00', ok: true });
const finish: ReceiptPunch = {
  code: 'F' as unknown as number,
  split: '0:41',
  time: '30:00',
  finish: true,
};

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

function render(punches: ReceiptPunch[], verdict = true): HTMLElement {
  instance = mount(PunchGrid, { target: document.body, props: { punches, verdict } });
  flushSync();
  return document.body.querySelector('[data-testid="punch-grid"]')!;
}
const tiles = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.punch')];
const bottom = (tile: HTMLElement) => tile.querySelector('.split, .label')?.textContent?.trim();

describe('PunchGrid states', () => {
  const grid = () =>
    render([
      ok(31),
      { code: 32, split: '—', time: '—', ok: false },
      { ...ok(33), kind: 'struck' },
      ok(34),
      { ...ok(32), kind: 'order' },
      { code: 99, split: '0:48', time: '9:00', ok: false, kind: 'extra' },
      finish,
    ]);

  it('labels each state in words', () => {
    const t = tiles(grid());
    expect(t.map((x) => x.dataset['state'])).toEqual([
      'ok',
      'miss',
      'struck',
      'ok',
      'order',
      'extra',
      'finish',
    ]);
    expect(t.map(bottom)).toEqual([
      '2:00',
      'saknas',
      'struken',
      '2:00',
      'fel ordn.',
      'extra',
      '0:41',
    ]);
  });

  it('gives every non-finish state an icon', () => {
    const t = tiles(grid());
    expect(t.slice(0, 6).every((x) => x.querySelector('svg'))).toBe(true);
    expect(t[6]!.querySelector('svg')).toBeNull();
  });
});

describe('PunchGrid size follows course length', () => {
  const course = (n: number) => Array.from({ length: n }, (_, i) => ok(31 + i));
  it('20 course controls plus extras and finish → large', () => {
    const extras: ReceiptPunch[] = [
      { ...ok(99), ok: false, kind: 'extra' },
      { ...ok(98), ok: false, kind: 'extra' },
    ];
    expect(render([...course(20), ...extras, finish]).dataset['size']).toBe('large');
  });
  it('21 course controls → medium', () => {
    expect(render([...course(21), finish]).dataset['size']).toBe('medium');
  });
  it('struck controls count as course controls', () => {
    expect(render([...course(20), { ...ok(60), kind: 'struck' }, finish]).dataset['size']).toBe(
      'medium'
    );
  });
});

describe('PunchGrid without a course', () => {
  it('shows plain tiles: no check, no verdict', () => {
    const t = tiles(render([ok(31), ok(45), finish], false));
    expect(t.map((x) => x.dataset['state'])).toEqual(['plain', 'plain', 'finish']);
    expect(t.some((x) => x.querySelector('svg'))).toBe(false);
  });
});
