// Authored for fartola. Not ported from upstream.
//
// SpeakerView's live wiring in jsdom with a fake fetch and WebSocket:
//   - a board response that overtakes an older one is not overwritten by it;
//   - leaving the page while the first load is pending opens no socket.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: SpeakerView } = await import('./SpeakerView.svelte');

const board = (name: string) => ({
  clock_offset_min: 120,
  classes: [{ class_id: 'k1', class_name: name, controls: [], runners: [] }],
  events: [],
});

class FakeWebSocket {
  static all: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWebSocket.all.push(this);
  }
  send(): void {}
  close(): void {}
  push(type: string): void {
    this.onmessage?.({ data: JSON.stringify({ type, payload: {} }) });
  }
}

/** Board responses resolve when the test says so, in any order. */
let pending: Array<(name: string) => void>;
let competitionGate: Promise<void>;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('SpeakerView live wiring', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    pending = [];
    competitionGate = Promise.resolve();
    FakeWebSocket.all = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/speaker')) {
        return new Promise<Response>((resolve) => {
          pending.push((name) => resolve(json(board(name))));
        });
      }
      await competitionGate;
      return json({ competition: { name: 'C', clock_offset_min: 120 }, classes: [], courses: [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  it('an older board response does not replace a newer one', async () => {
    component = mount(SpeakerView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    pending.shift()!('FIRST');
    await settle();
    await settle();
    const ws = FakeWebSocket.all[0]!;

    ws.push('results_update');
    await new Promise((r) => setTimeout(r, 350)); // the refetch debounce
    ws.push('radio_punch');
    await new Promise((r) => setTimeout(r, 350));
    expect(pending).toHaveLength(2);
    const [older, newer] = pending;
    newer!('NEWER');
    await settle();
    older!('OLDER');
    await settle();
    flushSync();
    expect(document.body.textContent).toContain('NEWER');
    expect(document.body.textContent).not.toContain('OLDER');
  });

  it('opens no socket when the view is gone before the first load ends', async () => {
    let open!: () => void;
    competitionGate = new Promise((r) => (open = r));
    component = mount(SpeakerView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    void unmount(component);
    component = null;
    open();
    await settle();
    pending.shift()?.('FIRST');
    await settle();
    await settle();
    expect(FakeWebSocket.all).toHaveLength(0);
  });
});
