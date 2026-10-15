// Authored for fartola. Not ported from upstream.
//
// A course control chip strikes the control on a tap. What a tap does is
// said in visible text above the chips, not only in a hover title.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

describe('CompetitionInfoView course chips', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('says in text what a tap on a control does, and the chips point at it', async () => {
    const competition = {
      id: 'c1',
      name: 'Krocktest',
      date: '2026-10-08',
      receipt_template: 'classic',
      auto_print: false,
      timing_format: 'seconds',
      level: null,
      distance: null,
      max_time_sec: null,
      race_started_at_ms: null,
      clock_offset_min: 120,
    };
    const courses = [
      {
        id: 'k1',
        competition_id: 'c1',
        name: 'Bana 1',
        class_id: null,
        length_m: null,
        climb_m: null,
        controls: [{ order_idx: 0, control_code: 31 }],
      },
    ];
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/voided-controls')) return json({ control_codes: [] });
      if (url.endsWith('/classes/kinds')) return json({ eventor: 'not_linked', items: [] });
      if (url.endsWith('/fees')) return json({ date: '2026-10-08', card_fee: null, classes: [] });
      return json({
        competition,
        classes: [],
        courses,
        closing: { last_start_ms: null, closing_time_ms: null },
      });
    }) as unknown as typeof fetch;
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
    const chip = document.querySelector('[data-testid="info-ctrl-chip"]')!;
    const hint = document.getElementById(chip.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toContain('Tryck på en kontroll');
  });
});
