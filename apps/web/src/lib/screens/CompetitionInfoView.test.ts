// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the course-wide "Makulera kontroll" toggle in
// CompetitionInfoView (02.1-14 Task 5). Pure-helper style like
// SettingsView.test.ts: i18n keys + the client calls the toggle makes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const KEYS = ['info.courses.voidControl', 'info.courses.unvoidControl'] as const;

describe('02.1-14 Task 5 — voided-control toggle', () => {
  it('sv + en have the toggle keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of KEYS) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(sv['info.courses.voidControl']).toBe('Makulera kontroll');
  });

  describe('client', () => {
    beforeEach(() => {
      global.fetch = vi.fn(
        async () => new Response(JSON.stringify({ control_codes: [32] }), { status: 200 })
      ) as unknown as typeof fetch;
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('listVoidedControls GETs /api/competitions/:id/voided-controls', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const { listVoidedControls } = await import('../api/client.ts');
      expect(await listVoidedControls('c 1')).toEqual({ control_codes: [32] });
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/competitions/c%201/voided-controls');
    });

    it('setControlVoided POSTs to void and DELETEs to unvoid', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const { setControlVoided } = await import('../api/client.ts');
      await setControlVoided('c1', 32, true);
      await setControlVoided('c1', 32, false);
      const calls = fetchMock.mock.calls.map((c) => [
        String(c[0]),
        (c[1] as RequestInit | undefined)?.method,
      ]);
      expect(calls).toEqual([
        ['/api/competitions/c1/voided-controls/32', 'POST'],
        ['/api/competitions/c1/voided-controls/32', 'DELETE'],
      ]);
    });
  });
});

// SOFT TR 4.21.1 / 4.21.2: the competition max time field (minutes) on the
// competition page, with the rule as its hint.
describe('competition max time (SOFT TR 4.21.1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SOFT TR 4.21.1: the max time is entered in whole minutes for the whole competition', async () => {
    const { maxTimeMinutesToSec } = await import('../api/client.ts');
    expect(maxTimeMinutesToSec('150')).toBe(9000);
    expect(maxTimeMinutesToSec(' 90 ')).toBe(5400);
    expect(maxTimeMinutesToSec('')).toBeNull();
    expect(maxTimeMinutesToSec('0')).toBeUndefined();
    expect(maxTimeMinutesToSec('1:30')).toBeUndefined();
    expect(maxTimeMinutesToSec('abc')).toBeUndefined();
  });

  it('setCompetitionMaxTime PATCHes /api/competitions/:id/max-time', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ max_time_sec: 9000 }), { status: 200 })
    ) as unknown as typeof fetch;
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { setCompetitionMaxTime } = await import('../api/client.ts');
    await setCompetitionMaxTime('c1', 9000);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/competitions/c1/max-time');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ max_time_sec: 9000 });
  });

  it('the hint carries the rule: same for all classes, 2 × or 4 × the winning time', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of ['info.maxTime.label', 'info.maxTime.hint', 'info.maxTime.locked']) {
      expect(sv[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
    expect(sv['info.maxTime.hint']).toContain('densamma för alla klasser');
    expect(sv['info.maxTime.hint']).toMatch(/2 ×.*4 ×/);
  });
});

// SOFT TR 3.3.1: the competition level (nivå 1–4 or träning) is set in the
// competition's fields card and saved with the other fields.
describe('competition level (SOFT TR 3.3.1)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let patches: unknown[];

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  beforeEach(() => {
    patches = [];
    const competition = {
      id: 'c1',
      name: 'Nivåtest',
      date: '2026-10-08',
      receipt_template: 'classic',
      auto_print: false,
      timing_format: 'seconds',
      level: null,
    };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push(body);
        return json({ ...competition, ...body });
      }
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/voided-controls')) return json({ control_codes: [] });
      if (url.endsWith('/classes/kinds')) return json({ eventor: 'not_linked', items: [] });
      return json({ competition, classes: [], courses: [] });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('sv + en name every level; the hint says level 4 and training are free', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const l of ['none', 'niva1', 'niva2', 'niva3', 'niva4', 'traning', 'label', 'hint']) {
      expect(sv[`info.level.${l}`], l).toBeTruthy();
      expect(en[`info.level.${l}`], l).toBeTruthy();
    }
    expect(sv['info.level.hint']).toContain('TR 3.3.1');
  });

  it('shows "Inte angiven" when unset and saves the chosen level; choosing none sends null', async () => {
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
    const select = document.querySelector('[data-testid="info-level"]') as HTMLSelectElement;
    expect(select.selectedOptions[0]!.textContent).toBe('Inte angiven');
    const save = document.querySelector('[data-testid="info-save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    select.value = 'niva1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(save.disabled).toBe(false);
    save.click();
    await settle();
    expect(patches).toHaveLength(1);
    expect((patches[0] as { level: unknown }).level).toBe('niva1');

    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    save.click();
    await settle();
    expect((patches[1] as { level: unknown }).level).toBeNull();
  });
});

// SOFT TR 4.16.3 / TR 4.22.1: the closing time (last start + max time) is
// shown with the max time, on the competition clock, for the PM. SOFT TA
// till TR 7.4.4: the distance is set with the other fields.
describe('closing time and distance (SOFT TR 4.16.3, TA till TR 7.4.4)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let patches: Array<Record<string, unknown>>;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  const mountWith = async (closing: unknown): Promise<void> => {
    patches = [];
    const competition = {
      id: 'c1',
      name: 'Stängning',
      date: '2026-10-08',
      receipt_template: 'classic',
      auto_print: false,
      timing_format: 'seconds',
      level: null,
      distance: null,
      max_time_sec: 9000,
      clock_offset_min: 120,
    };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push(body);
        return json({ ...competition, ...body });
      }
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/voided-controls')) return json({ control_codes: [] });
      if (url.endsWith('/classes/kinds')) return json({ eventor: 'not_linked', items: [] });
      return json({ competition, classes: [], courses: [], closing });
    }) as unknown as typeof fetch;
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
  };

  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('SOFT TR 4.16.3/4.22.1: shows the last start and when the finish closes on the competition clock, with the PM rule', async () => {
    // 11:30 and 14:00 on the clock (UTC+2).
    await mountWith({
      last_start_ms: Date.UTC(2026, 9, 8, 9, 30),
      closing_time_ms: Date.UTC(2026, 9, 8, 12, 0),
    });
    const box = document.querySelector('[data-testid="info-closing"]')!;
    expect(box.textContent).toContain('Sista start');
    expect(box.textContent).toContain('11:30');
    expect(document.querySelector('[data-testid="info-closing-time"]')!.textContent!.trim()).toBe(
      '14:00'
    );
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    expect(sv['info.closing.hint']).toContain('PM');
  });

  it('saving the fields fetches the closing time again (a new date can move the clock, ADR-0017)', async () => {
    const closing = {
      last_start_ms: Date.UTC(2026, 9, 8, 9, 30),
      closing_time_ms: Date.UTC(2026, 9, 8, 12, 0),
    };
    await mountWith(closing);
    // The server shifted the starts; the next GET has the new closing time.
    closing.closing_time_ms = Date.UTC(2026, 9, 8, 12, 30);
    const name = document.querySelector('[data-testid="info-name"]') as HTMLInputElement;
    name.value = 'Ny';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (document.querySelector('[data-testid="info-save"]') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('[data-testid="info-closing-time"]')!.textContent!.trim()).toBe(
      '14:30'
    );
  });

  it('shows "Inte känt" when there is no closing time yet', async () => {
    await mountWith({ last_start_ms: null, closing_time_ms: null });
    expect(document.querySelector('[data-testid="info-closing-time"]')!.textContent!.trim()).toBe(
      'Inte känt'
    );
  });

  it('SOFT TA till TR 7.4.4: saves the chosen distance; none sends null', async () => {
    await mountWith({ last_start_ms: null, closing_time_ms: null });
    const select = document.querySelector('[data-testid="info-distance"]') as HTMLSelectElement;
    expect(select.selectedOptions[0]!.textContent).toBe('Inte angiven');
    const save = document.querySelector('[data-testid="info-save"]') as HTMLButtonElement;
    select.value = 'sprint';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    save.click();
    await settle();
    expect(patches[0]!.distance).toBe('sprint');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    save.click();
    await settle();
    expect(patches[1]!.distance).toBeNull();
  });
});
