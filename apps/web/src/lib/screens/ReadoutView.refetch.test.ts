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
/** The /readout answer the page loads with. */
let mountBody: unknown;

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
    goto.mockClear();
    mountBody = readoutBody('Första Löpare', 1);
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
        if (!mounted) return json(mountBody);
        const body = await new Promise<unknown>((r) => held.push(r));
        return body instanceof Response ? body : json(body);
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

  it('an unknown first card in a merged refetch still opens its walk-up', async () => {
    component = mount(ReadoutView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    mounted = true;
    const send = (type: string, payload: unknown): void =>
      sockets[0]!.onmessage!({ data: JSON.stringify({ type, payload }) });
    // An unknown card, then a known runner, before either refetch answers.
    send('card_read', { card_number: 1007 });
    send('card_read', { card_number: 1008 });
    await settle();
    expect(held).toHaveLength(2);
    const both = readoutBody('Känd Löpare', 8);
    both.history = [
      row('Känd Löpare', 8),
      {
        ...row('', 7),
        competitor_id: null,
        competitor_name: null,
        unmatched: true,
      } as unknown as ReturnType<typeof row>,
    ];
    held[0]!(both);
    held[1]!(both);
    await settle();
    await vi.waitFor(() =>
      expect(goto).toHaveBeenCalledWith('/competition/c1/readout?walkup=1007')
    );
  });

  it('a failed newest refetch keeps the older good answer and offers a retry', async () => {
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
    held[0]!(readoutBody('Ny Löpare', 2));
    await settle();
    held[1]!(new Response('{}', { status: 500 }));
    await settle();
    expect(document.body.textContent).toContain('Ny Löpare');
    const failed = (): HTMLElement | null =>
      document.querySelector('[data-testid="readout-refetch-failed"]');
    expect(failed()).not.toBeNull();

    failed()!.querySelector('button')!.click();
    await settle();
    expect(held).toHaveLength(3);
    held[2]!(readoutBody('Senaste Löpare', 3));
    await settle();
    expect(document.body.textContent).toContain('Senaste Löpare');
    expect(failed()).toBeNull();
  });

  it('the first load replays every stored event with one refetch', async () => {
    component = mount(ReadoutView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    mounted = true;
    const competitorFetches = (): number =>
      vi.mocked(fetch).mock.calls.filter(([u]) => String(u).endsWith('/c1/competitors')).length;
    const before = competitorFetches();
    // The server's hello replay: every stored read, and a binding.
    const replay = (payload: unknown, seq: number): void =>
      sockets[0]!.onmessage!({
        data: JSON.stringify({ type: 'replay', channel: 'readout:c1', payload, seq }),
      });
    for (let i = 1; i <= 5; i++) replay({ event_type: 'card_read', card_number: 1000 + i }, i);
    replay({ event_type: 'card_bound', card_number: 1003 }, 6);
    await settle();
    expect(held).toHaveLength(1);
    expect(competitorFetches() - before).toBe(1);
    held[0]!(readoutBody('Första Löpare', 1));
    await settle();
    expect(held).toHaveLength(1);
  });

  it('two replayed reads of an unknown card the page already has open no walk-up', async () => {
    const unknownRow = (seq: number) =>
      ({
        ...row('', seq),
        card_number: 1007,
        competitor_id: null,
        competitor_name: null,
        unmatched: true,
      }) as unknown as ReturnType<typeof row>;
    const loaded = readoutBody('Känd Löpare', 3);
    loaded.history = [row('Känd Löpare', 3), unknownRow(2), unknownRow(1)];
    mountBody = loaded;
    component = mount(ReadoutView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    mounted = true;
    const replay = (card: number, seq: number): void =>
      sockets[0]!.onmessage!({
        data: JSON.stringify({
          type: 'replay',
          channel: 'readout:c1',
          payload: { event_type: 'card_read', card_number: card },
          seq,
        }),
      });
    replay(1007, 1);
    replay(1007, 2);
    replay(1003, 3);
    await settle();
    expect(held).toHaveLength(1);
    held[0]!(loaded);
    await settle();
    // The walk-up opens 600 ms after an unknown read.
    await new Promise((r) => setTimeout(r, 700));
    expect(goto).not.toHaveBeenCalled();
  });
});
