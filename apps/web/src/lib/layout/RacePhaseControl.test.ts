// Authored for fartola. Not ported from upstream.
//
// 2026-10-12: "Återställ" then "Starta tävling" during a real race made 623
// read-outs stop counting. The mounted RacePhaseControl (jsdom, routed fake
// fetch) says how many read-outs a reset takes away before it does it, and
// offers the way back afterwards (ADR-0016 rules 1 and 2).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import RacePhaseControl from './RacePhaseControl.svelte';
import { activeCompetition } from '#lib/stores/activeCompetition.svelte.ts';

// 10:05 local time.
const START = new Date(2026, 9, 12, 10, 5).getTime();

describe('RacePhaseControl', () => {
  let component: ReturnType<typeof mount> | null = null;
  let startedAtMs: number | null;
  let readsSinceStart: number;
  let undo: { started_at_ms: number; reads: number } | null;
  let posts: Array<{ url: string; body: unknown }>;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };
  const el = <T extends HTMLElement = HTMLElement>(testid: string) =>
    document.querySelector<T>(`[data-testid="${testid}"]`);
  const click = async (testid: string) => {
    el(testid)!.click();
    await settle();
  };
  const text = () => document.body.textContent ?? '';

  beforeEach(async () => {
    startedAtMs = START;
    readsSinceStart = 623;
    undo = null;
    posts = [];
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      const comp = () => ({ id: 'c1', name: 'Test', race_started_at_ms: startedAtMs });
      if (init?.method === 'POST' && url.includes('/reset-race')) {
        const body = JSON.parse(String(init.body)) as { force?: boolean };
        posts.push({ url, body });
        if (url.endsWith('/reset-race/undo')) {
          startedAtMs = undo!.started_at_ms;
          undo = null;
        } else if (readsSinceStart > 0 && body.force !== true) {
          return json({ error: 'reads_since_start', reads: readsSinceStart }, 409);
        } else {
          if (readsSinceStart > 0) undo = { started_at_ms: startedAtMs!, reads: readsSinceStart };
          startedAtMs = null;
        }
        return json(comp(), 201);
      }
      if (url.endsWith('/reset-race/undo')) return json({ undo });
      if (url === '/api/competitions') return json({ competitions: [comp()] });
      return json({});
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  const mountIt = async () => {
    await activeCompetition.set('c1');
    await activeCompetition.refreshList();
    component = mount(RacePhaseControl, { target: document.body });
    await settle();
  };

  it('a reset during a real race says how many read-outs stop counting and needs a tick first', async () => {
    await mountIt();
    await click('reset-race-btn');
    await click('reset-race-confirm');
    expect(posts.map((p) => p.body)).toEqual([{}]);
    expect(text()).toContain('623 avläsningar har gjorts sedan starten');
    expect(el('race-phase-pill')).toBeNull();
    const go = el<HTMLButtonElement>('reset-race-confirm')!;
    expect(go.textContent).toContain('Återställ ändå');
    expect(go.disabled).toBe(true);
    await click('reset-race-force-check');
    expect(go.disabled).toBe(false);
    await click('reset-race-confirm');
    expect(posts.map((p) => p.body)).toEqual([{}, { force: true }]);
    expect(el('race-phase-pill')!.textContent).toContain('Före tävling');
  });

  it('a start by mistake (no read-outs since) resets on the first confirm', async () => {
    readsSinceStart = 0;
    await mountIt();
    await click('reset-race-btn');
    await click('reset-race-confirm');
    expect(posts.map((p) => p.body)).toEqual([{}]);
    expect(el('race-phase-pill')!.textContent).toContain('Före tävling');
    expect(el('undo-reset-btn')).toBeNull();
  });

  it('after a reset that took read-outs away, undo says what it restores and does it', async () => {
    // Reset at 10:05, started again later: the 623 read-outs do not count.
    undo = { started_at_ms: START, reads: 623 };
    startedAtMs = START + 3_600_000;
    await mountIt();
    expect(el('undo-reset-note')!.textContent).toContain('623 avläsningar räknas inte');
    await click('undo-reset-btn');
    expect(text()).toContain('Starten sätts tillbaka till 10:05 och 623 avläsningar räknas igen');
    expect(posts).toEqual([]);
    await click('undo-reset-confirm');
    expect(posts).toEqual([{ url: '/api/competitions/c1/reset-race/undo', body: {} }]);
    expect(el('race-phase-pill')!.textContent).toContain('10:05');
    expect(el('undo-reset-btn')).toBeNull();
  });

  it('sv + en have the same race texts', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    const keys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith('race.'));
    expect(keys(en)).toEqual(keys(sv));
    for (const k of ['race.reset.readsBody', 'race.undo.note', 'race.undo.body']) {
      expect(sv[k], k).toContain('{{count}}');
      expect(en[k], k).toContain('{{count}}');
    }
  });
});
