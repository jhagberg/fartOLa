// Authored for fartola. Not ported from upstream.
//
// The read block of the edit dialog (mounted, routed fake fetch): the card
// and the rental show whether or not the read loaded, a failed fetch is not
// "never read", and only the latest fetch lands — another runner, or a
// refetch after a correction.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import EditRunnerRead from './EditRunnerRead.svelte';
import type { CorrectionsDTO } from '#lib/api/client.ts';
import { readProps } from './EditRunnerRead.testprops.svelte.ts';

const clk = (s: number) => ({ seconds_in_half_day: s, half_day: 0 });
const base: CorrectionsDTO = {
  status: 'PEND',
  elapsed_time_ms: null,
  start_ms: null,
  read_at_ms: null,
  drawn_start_ms: null,
  late_start_ms: null,
  read_count: 0,
  start_source: null,
  latest_read: null,
  missing_codes: [],
  manual_finish_ms: null,
  manual_finish_reason: null,
  manual_punches: [],
  time_addition_min: 0,
  time_addition_reason: null,
  start_method: 'auto',
};
const readOf = (status: CorrectionsDTO['status'], punches: number[]): CorrectionsDTO => ({
  ...base,
  status,
  read_count: 1,
  read_at_ms: Date.UTC(2026, 9, 9, 8, 20),
  start_source: 'drawn',
  latest_read: {
    card_type: 'SI10',
    read_at_ms: Date.UTC(2026, 9, 9, 8, 20),
    start_ms: Date.UTC(2026, 9, 9, 8, 0),
    finish_ms: Date.UTC(2026, 9, 9, 8, 12),
    start: clk(36000),
    finish: clk(36720),
    punches: punches.map((code, i) => ({ code, ...clk(36000 + 120 * (i + 1)) })),
    first_last: { start: null, finish: null },
  },
});

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void };

describe('EditRunnerRead (mounted)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let corrections: Map<string, Pending[]>;
  let hired: number[];
  let hiredFails: boolean;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };
  const $ = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const answer = (id: string, i: number, body: unknown): void =>
    corrections.get(id)![i]!.resolve(json(body));

  beforeEach(() => {
    corrections = new Map();
    hired = [];
    hiredFails = false;
    global.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      const m = /competitors\/([^/]+)\/corrections$/.exec(url);
      if (m) {
        return new Promise<Response>((resolve, reject) => {
          const list = corrections.get(m[1]!) ?? [];
          list.push({ resolve, reject });
          corrections.set(m[1]!, list);
        });
      }
      if (url.endsWith('/voided-controls')) return Promise.resolve(json({ control_codes: [] }));
      if (url.endsWith('/hired-cards')) {
        return Promise.resolve(
          hiredFails
            ? json({ error: 'x' }, 500)
            : json({ open: hired.map((card_number) => ({ card_number })), returned: [] })
        );
      }
      return Promise.resolve(
        json({
          competition: { date: '2026-10-09', clock_offset_min: 120 },
          classes: [{ id: 'k1', no_timing: false, course_id: 'co1' }],
          courses: [
            {
              id: 'co1',
              class_id: 'k1',
              controls: [31, 32, 33].map((control_code, order_idx) => ({
                control_code,
                order_idx,
              })),
            },
          ],
        })
      );
    }) as typeof fetch;
    readProps.obj = { id: 'r1' };
    readProps.reloadKey = 0;
    readProps.readKey = 'k1';
  });
  const mountIt = (): void => {
    component = mount(EditRunnerRead, {
      target: document.body,
      props: {
        competitionId: 'c1',
        get competitorId() {
          return readProps.obj.id;
        },
        classId: 'k1',
        cardNumber: 7501853,
        get reloadKey() {
          return readProps.reloadKey;
        },
        get readKey() {
          return readProps.readKey;
        },
      },
    });
  };
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  it('shows the card and the rental while loading and after a failed load', async () => {
    hired = [7501853];
    mountIt();
    await settle();
    expect($('edit-read-card')!.textContent).toContain('7501853');
    expect($('edit-read-hire')).not.toBeNull();
    expect($('edit-read-loading')).not.toBeNull();
    corrections.get('r1')![0]!.reject(new Error('down'));
    await settle();
    expect($('edit-read-error')!.textContent).toContain('Kunde inte hämta stämplingarna');
    expect($('edit-read-never')).toBeNull();
    expect($('edit-read-card')!.textContent).toContain('7501853');
    expect($('edit-read-hire')).not.toBeNull();
  });

  it('retry resets to loading and shows the read when it works', async () => {
    mountIt();
    await settle();
    corrections.get('r1')![0]!.reject(new Error('down'));
    await settle();
    $('edit-read-error')!.querySelector('button')!.click();
    await settle();
    expect($('edit-read-error')).toBeNull();
    expect($('edit-read-loading')).not.toBeNull();
    answer('r1', 1, base);
    await settle();
    expect($('edit-read-never')!.textContent).toBe('Inte avläst ännu');
  });

  it('shows the missing control and the splits of a read', async () => {
    mountIt();
    await settle();
    answer('r1', 0, { ...readOf('MP', [31, 33]), missing_codes: [32] });
    await settle();
    expect($('punch-grid')!.querySelector('[data-state="miss"]')!.textContent).toContain('saknas');
    expect($('splits-table')).not.toBeNull();
    expect($('edit-read-never')).toBeNull();
  });

  it('a slow answer for the previous runner never lands on the next', async () => {
    mountIt();
    await settle();
    readProps.obj = { id: 'r2' };
    await settle();
    answer('r2', 0, readOf('OK', [31, 32, 33]));
    await settle();
    answer('r1', 0, { ...base, late_start_ms: 192_000 });
    await settle();
    expect($('edit-read-late')).toBeNull();
    expect($('edit-read-status')!.textContent).toContain('Godkänd');
  });

  it('the refetch after a correction supersedes an older fetch', async () => {
    mountIt();
    await settle();
    readProps.reloadKey = 1;
    await settle();
    answer('r1', 1, readOf('OK', [31, 32, 33]));
    await settle();
    answer('r1', 0, readOf('MP', [31, 33]));
    await settle();
    expect($('edit-read-status')!.textContent).toContain('Godkänd');
    expect($('punch-grid')!.querySelector('[data-state="miss"]')).toBeNull();
  });

  it('a new read of the runner fetches the read again', async () => {
    mountIt();
    await settle();
    answer('r1', 0, readOf('MP', [31, 33]));
    await settle();
    expect($('edit-read-status')!.textContent).not.toContain('Godkänd');
    // A reread on the readout finds the missing control.
    readProps.obj = { id: 'r1' };
    readProps.readKey = 'k2';
    await settle();
    expect(corrections.get('r1')).toHaveLength(2);
    answer('r1', 1, readOf('OK', [31, 32, 33]));
    await settle();
    expect($('edit-read-status')!.textContent).toContain('Godkänd');
  });

  it('Sen start shows only when the payload has it', async () => {
    mountIt();
    await settle();
    answer('r1', 0, { ...readOf('OK', [31, 32, 33]), late_start_ms: 192_000 });
    await settle();
    expect($('edit-read-late')!.textContent).toContain('Sen start +3:12');
    readProps.reloadKey = 1;
    await settle();
    answer('r1', 1, readOf('OK', [31, 32, 33]));
    await settle();
    expect($('edit-read-late')).toBeNull();
  });

  it('shows the first and last finish only when the read has two (ADR-0019 step 2)', async () => {
    mountIt();
    await settle();
    const two = readOf('OK', [31, 32, 33]);
    two.latest_read!.first_last = {
      start: null,
      finish: {
        first: { ms: Date.UTC(2026, 9, 9, 8, 11, 30), code: null },
        last: { ms: Date.UTC(2026, 9, 9, 8, 12), code: 100 },
      },
    };
    answer('r1', 0, two);
    await settle();
    expect($('first-last-finish')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Första mål 10:11:30 Sista mål 10:12:00 (kod 100) (används)'
    );
    expect($('first-last-start')).toBeNull();
    readProps.reloadKey = 1;
    await settle();
    answer('r1', 1, readOf('OK', [31, 32, 33]));
    await settle();
    expect($('first-last')).toBeNull();
  });

  it('a lost card with a finish by hand still shows the finish, status and time', async () => {
    mountIt();
    await settle();
    answer('r1', 0, {
      ...base,
      status: 'OK',
      elapsed_time_ms: 725_000,
      start_ms: Date.UTC(2026, 9, 9, 8, 0),
      drawn_start_ms: Date.UTC(2026, 9, 9, 8, 0),
      start_source: 'drawn',
      manual_finish_ms: Date.UTC(2026, 9, 9, 8, 12, 5),
      manual_punches: [{ control_code: 32, reason: 'Stiftklämma' }],
      time_addition_min: 1,
      time_addition_reason: 'Tjuvstart',
    });
    await settle();
    expect($('edit-read-never')!.textContent).toBe('Inte avläst ännu');
    expect($('edit-read-readat')).toBeNull();
    expect($('edit-read-finish')!.textContent).toContain('för hand');
    expect($('edit-read-status')!.textContent).toContain('Godkänd');
    expect($('edit-read-status')!.textContent).toContain('12:05');
    expect($('edit-read-addition')!.textContent).toContain('Tjuvstart');
    expect($('edit-read-by-hand')!.textContent).toContain('Stiftklämma');
  });

  it('a parent that rebuilds the competitor after another runner reads does not refetch', async () => {
    mountIt();
    await settle();
    answer('r1', 0, readOf('OK', [31, 32, 33]));
    await settle();
    readProps.obj = { id: 'r1' };
    await settle();
    expect(corrections.get('r1')!.length).toBe(1);
    expect($('edit-read-loading')).toBeNull();
    expect($('edit-read-status')!.textContent).toContain('Godkänd');
  });
});
