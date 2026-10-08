// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 2: recent start-time changes stay in a list they can be
// undone from. The mounted StartTimeHistory (jsdom, routed fake fetch)
// lists the changes, undoes one whole, and shows a refused undo next to it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import StartTimeHistory from './StartTimeHistory.svelte';
import { ApiError, type StartTimeHistoryItem } from '#lib/api/client.ts';
import { canUndo, undoErrorOf } from '#lib/screens/start-time-history.ts';

// 10:00:00 on the competition clock (UTC+2).
const AT = Date.UTC(2026, 9, 8, 8, 0, 0);

const row = (over: Partial<StartTimeHistoryItem>): StartTimeHistoryItem => ({
  node_id: 'n1',
  local_seq: 1,
  at_ms: AT,
  cause: 'draw',
  class_id: 'h21',
  changed: 12,
  undone: false,
  ...over,
});

describe('start-time history helpers', () => {
  it('a clock shift and an undone change cannot be undone', () => {
    expect(canUndo(row({}))).toBe(true);
    expect(canUndo(row({ undone: true }))).toBe(false);
    expect(canUndo(row({ cause: 'clock_shift' }))).toBe(false);
  });

  it('a refused undo says why', () => {
    const err = (body: unknown) => new ApiError(409, 'x', body, '');
    expect(undoErrorOf(err({ error: 'start_changed_since', competitor_ids: ['a', 'b'] }))).toEqual({
      key: 'history.err.changedSince',
      vars: { count: 2 },
    });
    expect(undoErrorOf(err({ error: 'grid_changed_since' })).key).toBe(
      'history.err.gridChangedSince'
    );
    expect(undoErrorOf(err({ error: 'already_undone' })).key).toBe('history.err.alreadyUndone');
  });

  it('sv + en name every cause', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const c of [
      'draw',
      'late_entrants',
      'manual',
      'missing_starts',
      'start_list_import',
      'clock_shift',
      'undo',
    ]) {
      expect(sv[`history.cause.${c}`], c).toBeTruthy();
      expect(en[`history.cause.${c}`], c).toBeTruthy();
    }
  });
});

describe('StartTimeHistory (mounted)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let items: StartTimeHistoryItem[];
  let undoAnswer: { status: number; body: unknown };
  let undoBodies: unknown[];
  const onUndone = vi.fn();

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  beforeEach(() => {
    items = [
      row({ local_seq: 3, cause: 'manual', class_id: 'h21', changed: 1 }),
      row({ local_seq: 2, cause: 'clock_shift', class_id: null, changed: 40 }),
      row({ local_seq: 1, cause: 'draw', class_id: 'h21', changed: 12 }),
    ];
    undoAnswer = { status: 201, body: { local_seq: 4, changed: 1 } };
    undoBodies = [];
    onUndone.mockReset();
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method === 'POST') {
        expect(url).toBe('/api/competitions/c1/start-times/undo');
        const body = JSON.parse(String(init.body)) as { local_seq: number };
        undoBodies.push(body);
        if (undoAnswer.status === 201)
          items = items.map((i) => (i.local_seq === body.local_seq ? { ...i, undone: true } : i));
        return json(undoAnswer.body, undoAnswer.status);
      }
      if (url.endsWith('/start-times/history')) return json({ items });
      return json({ competition: { date: '2026-10-08', clock_offset_min: 120 } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="history-row"]')];
  const mountIt = async () => {
    component = mount(StartTimeHistory, {
      target: document.body,
      props: { competitionId: 'c1', classNames: { h21: 'H21' }, onUndone },
    });
    await settle();
  };

  it('lists the changes with time, cause, class and count; a clock shift cannot be undone', async () => {
    await mountIt();
    expect(rows()).toHaveLength(3);
    expect(rows()[2]!.textContent).toContain('10:00:00');
    expect(rows()[2]!.textContent).toContain('Lottning');
    expect(rows()[2]!.textContent).toContain('H21');
    expect(rows()[2]!.textContent).toContain('12 löpare');
    expect(rows()[1]!.textContent).toContain('Klockjustering');
    expect(rows()[1]!.textContent).toContain('Kan inte ångras');
    expect(rows()[1]!.querySelector('[data-testid="history-undo"]')).toBeNull();
  });

  it('undo puts the change back whole and says what it did', async () => {
    await mountIt();
    rows()[0]!.querySelector<HTMLButtonElement>('[data-testid="history-undo"]')!.click();
    await settle();
    expect(undoBodies).toEqual([{ node_id: 'n1', local_seq: 3 }]);
    expect(onUndone).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-testid="history-done"]')!.textContent).toBe(
      'Ångrat: 1 löpare fick tillbaka sin tidigare starttid.'
    );
    expect(rows()[0]!.querySelector('[data-testid="history-undone"]')!.textContent).toBe('Ångrad');
  });

  it('a refused undo is explained next to that change, and nothing is undone', async () => {
    undoAnswer = {
      status: 409,
      body: { error: 'start_changed_since', competitor_ids: ['r1'] },
    };
    await mountIt();
    rows()[2]!.querySelector<HTMLButtonElement>('[data-testid="history-undo"]')!.click();
    await settle();
    expect(onUndone).not.toHaveBeenCalled();
    expect(rows()[2]!.querySelector('[data-testid="history-error"]')!.textContent).toContain(
      'Kan inte ångras: 1 löpare har fått ny starttid efter den här ändringen.'
    );
    expect(rows()[0]!.querySelector('[data-testid="history-error"]')).toBeNull();
  });
});
