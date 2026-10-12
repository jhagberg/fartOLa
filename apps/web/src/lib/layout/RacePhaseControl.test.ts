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
  let undo: { node_id: string; local_seq: number; started_at_ms: number; reads: number } | null;
  // What the edge offers instead, once: the next undo is refused as changed.
  let changedTo: typeof undo;
  let posts: Array<{ url: string; body: unknown }>;
  // Holds back the answer to a reset until released.
  let hold: Promise<void> | null;

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
    changedTo = null;
    posts = [];
    hold = null;
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      const comp = () => ({ id: 'c1', name: 'Test', race_started_at_ms: startedAtMs });
      // A second competition, started and with read-outs of its own.
      const other = { id: 'c2', name: 'Other', race_started_at_ms: START };
      if (init?.method === 'POST' && url.includes('/reset-race')) {
        const body = JSON.parse(String(init.body)) as { force?: boolean };
        posts.push({ url, body });
        if (hold) await hold;
        if (url.includes('/c2/')) {
          if (body.force !== true) return json({ error: 'reads_since_start', reads: 7 }, 409);
          return json({ ...other, race_started_at_ms: null }, 201);
        }
        if (url.endsWith('/reset-race/undo')) {
          if (changedTo !== null) {
            undo = changedTo;
            changedTo = null;
            return json({ error: 'undo_changed' }, 409);
          }
          startedAtMs = undo!.started_at_ms;
          undo = null;
        } else if (readsSinceStart > 0 && body.force !== true) {
          return json({ error: 'reads_since_start', reads: readsSinceStart }, 409);
        } else {
          if (readsSinceStart > 0) {
            undo = {
              node_id: 'n1',
              local_seq: 7,
              started_at_ms: startedAtMs!,
              reads: readsSinceStart,
            };
          }
          startedAtMs = null;
        }
        return json(comp(), 201);
      }
      if (url.endsWith('/c2/reset-race/undo')) return json({ undo: null });
      if (url.endsWith('/reset-race/undo')) return json({ undo });
      if (url === '/api/competitions') return json({ competitions: [comp(), other] });
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
    expect(text()).toContain('623 avläsningar och måltider för hand sedan starten slutar räknas');
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
    undo = { node_id: 'n1', local_seq: 7, started_at_ms: START, reads: 623 };
    startedAtMs = START + 3_600_000;
    await mountIt();
    expect(el('undo-reset-note')!.textContent).toContain(
      '623 avläsningar och måltider för hand räknas inte'
    );
    await click('undo-reset-btn');
    expect(text()).toContain(
      'Starten sätts tillbaka till 10:05. 623 avläsningar och måltider för hand räknas igen'
    );
    expect(posts).toEqual([]);
    await click('undo-reset-confirm');
    // The request names the reset the operator saw.
    expect(posts).toEqual([
      { url: '/api/competitions/c1/reset-race/undo', body: { node_id: 'n1', local_seq: 7 } },
    ]);
    expect(el('race-phase-pill')!.textContent).toContain('10:05');
    expect(el('undo-reset-btn')).toBeNull();
  });

  it('a double click on a confirm button sends one request', async () => {
    undo = { node_id: 'n1', local_seq: 7, started_at_ms: START, reads: 623 };
    startedAtMs = null;
    await mountIt();
    await click('undo-reset-btn');
    el('undo-reset-confirm')!.click();
    el('undo-reset-confirm')!.click();
    await settle();
    expect(posts).toHaveLength(1);
    // And the forced reset.
    posts = [];
    await click('reset-race-btn');
    await click('reset-race-confirm');
    await click('reset-race-force-check');
    el('reset-race-confirm')!.click();
    el('reset-race-confirm')!.click();
    await settle();
    expect(posts.map((p) => p.body)).toEqual([{}, { force: true }]);
  });

  it('an undo that is no longer the one shown is not made: the new text is shown instead', async () => {
    undo = { node_id: 'n1', local_seq: 7, started_at_ms: START, reads: 623 };
    changedTo = { node_id: 'n1', local_seq: 9, started_at_ms: START + 3_600_000, reads: 8 };
    startedAtMs = null;
    await mountIt();
    await click('undo-reset-btn');
    await click('undo-reset-confirm');
    expect(text()).toContain('Det som kan ångras har ändrats');
    expect(text()).toContain('Starten sätts tillbaka till 11:05. 8 avläsningar');
    expect(el('race-phase-pill')).toBeNull();
    await click('undo-reset-confirm');
    expect(posts.map((p) => p.body)).toEqual([
      { node_id: 'n1', local_seq: 7 },
      { node_id: 'n1', local_seq: 9 },
    ]);
    expect(el('race-phase-pill')!.textContent).toContain('11:05');
  });

  // Codex review of PR 130: the warning and the tick belong to the
  // competition they were given for.
  it('switching competition drops the warning and the tick: no forced reset for the other one', async () => {
    await mountIt();
    await click('reset-race-btn');
    await click('reset-race-confirm');
    await click('reset-race-force-check');
    await activeCompetition.set('c2');
    await settle();
    el('reset-race-confirm')?.click();
    await settle();
    expect(posts.filter((p) => p.url.includes('/c2/'))).toEqual([]);
    expect(el('reset-race-confirm')).toBeNull();
    // Asked again for c2, it gets its own warning with its own count.
    await click('reset-race-btn');
    await click('reset-race-confirm');
    expect(posts.at(-1)).toEqual({ url: '/api/competitions/c2/reset-race', body: {} });
    expect(text()).toContain('7 avläsningar och måltider för hand sedan starten slutar räknas');
  });

  it('a refusal that arrives after a switch is not shown for the other competition', async () => {
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    await mountIt();
    await click('reset-race-btn');
    await click('reset-race-confirm');
    await activeCompetition.set('c2');
    await settle();
    hold = null;
    release();
    await settle();
    expect(text()).not.toContain('623 avläsningar');
    expect(el('reset-race-force-check')).toBeNull();
    expect(el('race-phase-pill')!.textContent).toContain('Tävling pågår');
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
