// Authored for fartola. Not ported from upstream.
//
// ReadoutView refetches /readout on live events. Two refetches can overlap;
// an older answer that lands last must not replace the newer history.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/competition/c1/readout') },
}));
const { goto } = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => ({ goto }));

const { default: ReadoutView } = await import('./ReadoutView.svelte');

function row(name: string, seq: number) {
  return {
    event_time_ms: 1_778_749_200_000 + seq,
    local_seq: seq,
    card_number: 1000 + seq,
    card_type: 'SI10',
    competitor_id: `id-${seq}`,
    competitor_name: name,
    status: 'OK',
    unmatched: false,
    punches: [],
    finish_seconds_in_half_day: null,
    finish_half_day: null,
    start_seconds_in_half_day: null,
    start_half_day: null,
    card_holder_hint: null,
    hired_card_open: null,
    missing_codes: [],
    extra_codes: [],
    out_of_order_codes: [],
    expected_codes: [],
    manual_status: null,
    start_time_ms: null,
    elapsed_time_ms: null,
    missing_start: false,
    suggested_start_ms: null,
    suggested_start_offset_ms: null,
    finish_ms: null,
    late_start_ms: null,
    early_start_ms: null,
    manual_finish_ms: null,
    manual_finish_reason: null,
    manual_punches: [],
    time_addition_min: 0,
    time_addition_reason: null,
    class_place: null,
    class_behind_leader_ms: null,
    class_finished_count: 0,
    class_starters_count: 1,
  };
}

const readoutBody = (name: string, seq: number) => ({
  competition_id: 'c1',
  active: true,
  current_read: row(name, seq),
  history: [row(name, seq)],
  pending_unknown_cards: [],
  voided_codes: [],
  clock_offset_min: 120,
});

/** The /readout requests after mount, each waiting for the test. */
let held: Array<(body: unknown) => void>;
let sockets: FakeWebSocket[];

class FakeWebSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose = null;
  onerror = null;
  constructor() {
    sockets.push(this);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

describe('ReadoutView — overlapping readout refetches', () => {
  let component: ReturnType<typeof mount> | null = null;
  let mounted: boolean;

  beforeEach(() => {
    held = [];
    sockets = [];
    mounted = false;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/radio/status')) return json({ settings: { enabled: false } });
      if (url.endsWith('/readout')) {
        if (!mounted) return json(readoutBody('Första Löpare', 1));
        const body = await new Promise<unknown>((r) => held.push(r));
        return json(body);
      }
      if (url.endsWith('/c1/competitors')) return json({ competitors: [] });
      if (url.endsWith('/api/competitions/c1'))
        return json({
          competition: {
            id: 'c1',
            name: 'C',
            date: '2026-05-14',
            receipt_template: 'classic',
            auto_print: false,
          },
          classes: [],
          courses: [],
        });
      return json({ hit: false, suggestions: [] });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('an older answer that lands after a newer one does not replace the history', async () => {
    component = mount(ReadoutView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    mounted = true;
    const live = (): void =>
      sockets[0]!.onmessage!({
        data: JSON.stringify({ type: 'results_update', payload: {} }),
      });
    live();
    live();
    await settle();
    expect(held).toHaveLength(2);
    // The newer request answers first, then the older one lands last.
    held[1]!(readoutBody('Ny Löpare', 3));
    await settle();
    held[0]!(readoutBody('Gammal Löpare', 2));
    await settle();
    expect(document.body.textContent).toContain('Ny Löpare');
    expect(document.body.textContent).not.toContain('Gammal Löpare');
  });

  it('a card read waits for the newest refetch before it looks at the history', async () => {
    component = mount(ReadoutView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    mounted = true;
    const send = (type: string, payload: unknown): void =>
      sockets[0]!.onmessage!({ data: JSON.stringify({ type, payload }) });
    // The card read's own refetch (#1) is overtaken by a live update's (#2).
    send('card_read', { card_number: 1007 });
    await settle();
    send('results_update', {});
    await settle();
    expect(held).toHaveLength(2);
    const unknown = { ...readoutBody('Okänd', 7), current_read: null };
    unknown.history = [
      {
        ...row('', 7),
        competitor_id: null,
        competitor_name: null,
        unmatched: true,
        card_number: 1007,
      } as unknown as ReturnType<typeof row>,
    ];
    // The overtaken one answers first; the card read must still wait for #2.
    held[0]!(readoutBody('Första Löpare', 1));
    await settle();
    held[1]!(unknown);
    await settle();
    // The unknown card was seen in the newest history: the walk-up opens.
    await vi.waitFor(() =>
      expect(goto).toHaveBeenCalledWith('/competition/c1/readout?walkup=1007')
    );
  });
});
