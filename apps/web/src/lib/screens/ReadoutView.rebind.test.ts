// Authored for fartola. Not ported from upstream.
//
// Component test of ReadoutView after an entered runner's card is replaced
// from the unknown-card overlay: the read is now that runner's first
// read-out, so the first-read prompts run as for any card read:
//   - consent confirmation for an imported runner (pending_first_read);
//   - the hyrbricka prompt when the bind marked the card hired.
// The real component is mounted in jsdom with a routed fake fetch; the URL
// carries ?walkup=<card> through a stubbed $app/state.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/competition/c1/readout?walkup=2222222') },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

const { default: ReadoutView } = await import('./ReadoutView.svelte');

const EVA = '00000000-0000-4000-8000-0000000000e1';
const NEW = 2222222;

let rebound: boolean;
let hired: boolean;
let postSeq: number;

function row(attached: boolean) {
  return {
    event_time_ms: 1_778_749_200_000,
    local_seq: 5,
    card_number: NEW,
    card_type: 'SI10',
    competitor_id: attached ? EVA : null,
    competitor_name: attached ? 'Eva Ek' : null,
    status: attached ? 'OK' : 'PEND',
    unmatched: !attached,
    punches: [],
    finish_seconds_in_half_day: null,
    finish_half_day: null,
    start_seconds_in_half_day: null,
    start_half_day: null,
    card_holder_hint: null,
    hired_card_open:
      attached && hired
        ? { contact_name: 'Eva Ek', contact_phone: '0701234567', contact_email: null, note: null }
        : null,
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
    class_place: null,
    class_behind_leader_ms: null,
    class_finished_count: 0,
    class_starters_count: 1,
  };
}

function installFetch(): void {
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/radio/status')) return json({ settings: { enabled: false } });
    if (url.endsWith('/readout'))
      return json({
        competition_id: 'c1',
        active: true,
        current_read: row(rebound),
        history: [row(rebound)],
        pending_unknown_cards: rebound ? [] : [NEW],
        voided_codes: [],
        clock_offset_min: 120,
      });
    if (url.endsWith('/c1/competitors'))
      return json({
        competitors: [
          {
            id: EVA,
            competition_id: 'c1',
            name: 'Eva Ek',
            club: null,
            class_id: 'cls',
            card_number: rebound ? NEW : 1111111,
            consent_at_ms: null,
            consent_status: 'pending_first_read',
            scrubbed_at_ms: null,
            start_time_ms: null,
          },
        ],
      });
    if (url.includes('/entries'))
      return json({
        card_number: NEW,
        clock_offset_min: 120,
        runners: [
          {
            competitor_id: EVA,
            name: 'Eva Ek',
            club: null,
            class_id: 'cls',
            class_name: 'H21',
            card_number: 1111111,
            start_time_ms: null,
            missing: 0,
            extra: 0,
            start_diff_ms: null,
            suggested: true,
          },
        ],
      });
    if (url.endsWith('/card-binds/undo')) {
      rebound = false;
      return json({ competitor_id: EVA, card_number: 1111111, local_seq: 99 });
    }
    if (url === '/api/competitors' && init?.method === 'POST') {
      rebound = true;
      postSeq += 1;
      return json({
        id: EVA,
        name: 'Eva Ek',
        card_number: NEW,
        card_event: { node_id: 'n', local_seq: postSeq, previous_card_number: 1111111 },
      });
    }
    if (url.endsWith('/api/competitions/c1'))
      return json({
        competition: {
          id: 'c1',
          name: 'C',
          date: '2026-05-14',
          receipt_template: 'classic',
          auto_print: false,
        },
        classes: [{ id: 'cls', name: 'H21' }],
        courses: [],
      });
    return json({ hit: false, suggestions: [] });
  }) as unknown as typeof fetch;
}

class FakeWebSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
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

const q = (testid: string): HTMLElement | null =>
  document.querySelector(`[data-testid="${testid}"]`);

describe('ReadoutView — first-read prompts after a card replacement', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    rebound = false;
    hired = false;
    postSeq = 0;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    installFetch();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const replaceCard = async (): Promise<void> => {
    component = mount(ReadoutView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    q('entered-suggestion')!.click();
    await settle();
    q('entered-save')!.click();
    await settle();
  };

  it('asks for consent for an imported runner whose first read-out it now is', async () => {
    await replaceCard();
    expect(q('card-rebind-notice')).not.toBeNull();
    expect(q('consent-confirmation-toast')?.textContent).toContain('Eva Ek');
  });

  it('shows the hyrbricka prompt when the bind marked the card hired', async () => {
    hired = true;
    await replaceCard();
    expect(q('hyrbricka-toast')).not.toBeNull();
  });

  it('keeps each replacement with its own undo until closed', async () => {
    await replaceCard();
    // A second replacement from the same overlay (another card in a queue).
    q('entered-save')!.click();
    await settle();
    const notices = () =>
      Array.from(document.querySelectorAll('[data-testid="card-rebind-notice"]'));
    expect(notices()).toHaveLength(2);
    expect(document.querySelectorAll('[data-testid="card-rebind-undo"]')).toHaveLength(2);

    (notices()[1]!.querySelector('[data-testid="card-rebind-close"]') as HTMLElement).click();
    await settle();
    expect(notices()).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="card-rebind-undo"]')).toHaveLength(1);
  });

  it('undoing a wrong pick withdraws the prompts that pick raised', async () => {
    hired = true;
    await replaceCard();
    expect(q('consent-confirmation-toast')).not.toBeNull();
    expect(q('hyrbricka-toast')).not.toBeNull();

    q('card-rebind-undo')!.click();
    await settle();
    expect(q('card-rebind-notice')?.textContent).toContain('Bytet ångrat');
    // Confirming consent now would write it to the wrongly chosen runner.
    expect(q('consent-confirmation-toast')).toBeNull();
    expect(q('hyrbricka-toast')).toBeNull();
  });
});
