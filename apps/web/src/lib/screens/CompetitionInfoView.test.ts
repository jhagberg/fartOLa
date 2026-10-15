// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the course-wide "Stryk kontroll" toggle in
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
    expect(sv['info.courses.voidControl']).toBe('Stryk kontroll {{code}}');
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
// competition's fields card and saves on change, alone (ADR-0016 rule 3).
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

  it('shows "Inte angiven" when unset and saves the chosen level on change; none sends null', async () => {
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
    const select = document.querySelector('[data-testid="info-level"]') as HTMLSelectElement;
    expect(select.selectedOptions[0]!.textContent).toBe('Inte angiven');
    expect(document.querySelector('[data-testid="info-save"]')).toBeNull();

    select.value = 'niva1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // Each change is its own field-only patch.
    expect(patches).toEqual([{ level: 'niva1' }, { level: null }]);
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
    name.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(patches).toEqual([{ name: 'Ny' }]);
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
    select.value = 'sprint';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(patches).toEqual([{ distance: 'sprint' }, { distance: null }]);
  });
});

// The whole page with a class, its kind and its fees: a fee save and the
// class-kind save that remounts the fees, and the max time refused after
// the first start (SOFT TR 4.21.2).
describe('fees remount and the locked max time', () => {
  let component: ReturnType<typeof mount> | null = null;
  let feeGets: number;
  let feePuts: unknown[];
  let holdPut: { release: () => void } | null;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  beforeEach(async () => {
    feeGets = 0;
    feePuts = [];
    holdPut = null;
    const competition = {
      id: 'c1',
      name: 'Avgiftstest',
      date: '2026-10-08',
      receipt_template: 'classic',
      auto_print: false,
      timing_format: 'seconds',
      level: null,
      distance: null,
      max_time_sec: 9000,
      race_started_at_ms: null,
      clock_offset_min: 120,
    };
    const h21 = {
      class_id: 'h21',
      name: 'H21',
      class_kind: 'senior',
      age_class: 21,
      class_kind_source: 'name',
      suggestion: { class_kind: 'senior', age_class: 21, source: 'name' },
    };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/max-time')) return json({ error: 'max_time_locked' }, 409);
      if (url.endsWith('/fees')) {
        if (init?.method === 'PUT') {
          feePuts.push(JSON.parse(String(init.body)));
          if (holdPut) await new Promise<void>((r) => (holdPut!.release = r));
          return json({ updated: 1 });
        }
        feeGets++;
        return json({
          date: '2026-10-08',
          card_fee: null,
          classes: [
            {
              class_id: 'h21',
              name: 'H21',
              class_kind: 'senior',
              entry_fee: 180,
              youth_entry_fee: null,
              late_fee_pct: null,
            },
          ],
        });
      }
      if (url.endsWith('/classes/kinds')) {
        if (init?.method === 'PUT') return json({ updated: 1 });
        return json({ eventor: 'not_linked', items: [h21] });
      }
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/voided-controls')) return json({ control_codes: [] });
      return json({
        competition,
        classes: [{ id: 'h21', name: 'H21', short_name: null }],
        courses: [],
        closing: { last_start_ms: null, closing_time_ms: null },
      });
    }) as unknown as typeof fetch;
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a class-kind save remounts the fees only after a fee save in flight has landed', async () => {
    expect(feeGets).toBe(1);
    holdPut = { release: () => {} };
    const fee = document.querySelector<HTMLInputElement>('input[aria-label^="Avgift för H21"]')!;
    fee.value = '200';
    fee.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const kind = document.querySelector<HTMLSelectElement>(
      '[data-class-id="h21"] [data-testid="class-kind-select"]'
    )!;
    kind.value = 'elit';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // The fee save is still in flight: the fees are not reloaded under it.
    expect(feeGets).toBe(1);
    const held = holdPut;
    holdPut = null;
    held.release();
    await settle();
    expect(feePuts).toHaveLength(1);
    expect(feeGets).toBe(2);
  });

  it('SOFT TR 4.21.2: a refused max time says so, shows the stored time and locks the field', async () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="info-max-time"]')!;
    expect(input.readOnly).toBe(false);
    input.value = '120:00';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    document.querySelector<HTMLButtonElement>('[data-testid="info-max-time-save"]')!.click();
    await settle();
    expect(document.querySelector('[data-testid="info-max-time-note"]')!.textContent!.trim()).toBe(
      'Maxtiden kan inte ändras efter första start (TR 4.21.2).'
    );
    expect(document.querySelector('[data-testid="info-max-time-lock"]')!.textContent!.trim()).toBe(
      'Låst sedan första start.'
    );
    expect(input.readOnly).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-testid="help-info-max-time-why"]')!.click();
    flushSync();
    expect(document.getElementById('info-max-time-why')!.textContent).toContain('SOFT TR 4.21.2');
    expect(input.value).toBe('150:00');
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="info-max-time-save"]')!.disabled
    ).toBe(true);
  });
});

/** Text of the elements an input's aria-describedby points at. */
const describedBy = (el: Element | null): string =>
  (el?.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
    .trim();

describe('saves that overlap: max time and the date', () => {
  let component: ReturnType<typeof mount> | null = null;
  /** Every PATCH waits until the test answers it. */
  let held: Array<{
    url: string;
    body: Record<string, unknown>;
    answer: (status?: number) => void;
  }>;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };
  const $ = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;
  const change = async (id: string, value: string, event = 'change') => {
    const el = $<HTMLInputElement>(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (event === 'change') el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };

  beforeEach(async () => {
    held = [];
    const competition = {
      id: 'c1',
      name: 'Krocktest',
      date: '2026-10-08',
      receipt_template: 'classic',
      auto_print: false,
      timing_format: 'seconds',
      level: null,
      distance: null,
      max_time_sec: 9000,
      race_started_at_ms: null,
      clock_offset_min: 120,
    };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const status = await new Promise<number>((r) =>
          held.push({ url, body, answer: (s = 200) => r(s) })
        );
        if (status !== 200) return json({ error: 'x' }, status);
        return json({ ...competition, ...body });
      }
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/voided-controls')) return json({ control_codes: [] });
      if (url.endsWith('/classes/kinds')) return json({ eventor: 'not_linked', items: [] });
      if (url.endsWith('/fees')) return json({ date: '2026-10-08', card_fee: null, classes: [] });
      return json({
        competition,
        classes: [],
        courses: [],
        closing: { last_start_ms: null, closing_time_ms: null },
      });
    }) as unknown as typeof fetch;
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('Spara for the max time waits while a save is in flight: one request, the newest value', async () => {
    const save = $<HTMLButtonElement>('info-max-time-save');
    await change('info-max-time', '120:00', 'input');
    save.click();
    await settle();
    expect(save.disabled).toBe(true);
    await change('info-max-time', '100:00', 'input');
    save.click();
    save.click();
    await settle();
    const maxPatches = () => held.filter((h) => h.url.endsWith('/max-time'));
    expect(maxPatches()).toHaveLength(1);
    held[0]!.answer();
    await settle();
    expect($('info-max-time-note').textContent).toContain('Sparat');
    // The typed 100 was not sent: Spara is back for it.
    expect($<HTMLInputElement>('info-max-time').value).toBe('100:00');
    expect(save.disabled).toBe(false);
    save.click();
    await settle();
    expect(maxPatches().map((h) => h.body)).toEqual([
      { max_time_sec: 7200 },
      { max_time_sec: 6000 },
    ]);
  });

  it('the date field says how to write the date', () => {
    expect(describedBy($('info-date'))).toBe('Skriv datum i formatet 2026-05-20.');
  });

  it('a date typed wrong while a valid one saves is kept when that save fails', async () => {
    await change('info-date', '2026-10-09');
    expect(held).toHaveLength(1);
    await change('info-date', '2026-13-45');
    expect($('info-date-error')).not.toBeNull();
    held[0]!.answer(500);
    await settle();
    expect($<HTMLInputElement>('info-date').value).toBe('2026-13-45');
    expect($('info-date-error')).not.toBeNull();
    expect($('info-date-note').textContent).not.toContain('Sparat');
  });
});

describe('a failed load', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('says so in plain words, logs the raw error and retries', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const competition = {
      id: 'c1',
      name: 'Krocktest',
      date: '2026-10-08',
      receipt_template: 'classic',
      auto_print: false,
      timing_format: 'seconds',
      level: null,
      distance: null,
      max_time_sec: 9000,
      race_started_at_ms: null,
      clock_offset_min: 120,
    };
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/voided-controls')) return json({ control_codes: [] });
      if (url.endsWith('/classes/kinds')) return json({ eventor: 'not_linked', items: [] });
      if (url.endsWith('/fees')) return json({ date: '2026-10-08', card_fee: null, classes: [] });
      if (fail) {
        fail = false;
        return json({ error: 'boom' }, 500);
      }
      return json({
        competition,
        classes: [],
        courses: [],
        closing: { last_start_ms: null, closing_time_ms: null },
      });
    }) as unknown as typeof fetch;
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Kunde inte hämta tävlingen.');
    expect(alert.textContent).not.toMatch(/boom|500|HTTP/);
    expect(log).toHaveBeenCalled();
    alert.querySelector('button')!.click();
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
    expect(document.querySelector('[data-testid="competition-info"] [role="alert"]')).toBeNull();
    expect(document.querySelector('[data-testid="info-date"]')).not.toBeNull();
  });
});

// The Tävlingsinfo batch: the max time as mm:ss like Lottning, its lock read
// from the edge, one writer of `competition`, and the fee rows keeping their
// notes over a class-kind save.
describe('Tävlingsinfo: max time and fees', () => {
  let component: ReturnType<typeof mount> | null = null;
  let server: Record<string, unknown>;
  let lockedByEdge: boolean;
  let failFeePut: boolean;
  let feeGets: number;
  /** Replies to PATCH /competitions/:id wait here (stale snapshot at request time). */
  let heldDetails: Array<{ release: () => void }>;
  let maxPatches: Array<Record<string, unknown>>;
  /** The fees as the server holds them; a GET answers the state at request time. */
  let fees: { entry_fee: number; late_fee_pct: number | null };
  let holdFeeGets: boolean;
  let heldFeeGets: Array<() => void>;
  let feePuts: Array<Record<string, unknown>>;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };
  const $ = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;
  const type = async (id: string, value: string) => {
    const el = $<HTMLInputElement>(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const text = (id: string) => $(id).textContent!.trim();

  const mountView = async () => {
    const { default: CompetitionInfoView } = await import('./CompetitionInfoView.svelte');
    component = mount(CompetitionInfoView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
  };

  beforeEach(() => {
    lockedByEdge = false;
    failFeePut = false;
    feeGets = 0;
    heldDetails = [];
    maxPatches = [];
    fees = { entry_fee: 180, late_fee_pct: null };
    holdFeeGets = false;
    heldFeeGets = [];
    feePuts = [];
    server = {
      id: 'c1',
      name: 'Batch',
      date: '2026-10-08',
      receipt_template: 'classic',
      auto_print: false,
      timing_format: 'seconds',
      level: null,
      distance: null,
      max_time_sec: 9000,
      race_started_at_ms: null,
      clock_offset_min: 120,
    };
    const h21 = {
      class_id: 'h21',
      name: 'H21',
      class_kind: 'senior',
      age_class: 21,
      class_kind_source: 'name',
      suggestion: { class_kind: 'senior', age_class: 21, source: 'name' },
    };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (url.endsWith('/max-time')) {
          maxPatches.push(body);
          server = { ...server, ...body };
          return json(server);
        }
        const snapshot = { ...server, ...body };
        server = snapshot;
        await new Promise<void>((r) => heldDetails.push({ release: r }));
        return json(snapshot);
      }
      if (url.endsWith('/fees')) {
        if (init?.method === 'PUT') {
          if (failFeePut) return json({ error: 'x' }, 500);
          const body = JSON.parse(String(init.body)) as {
            classes?: Array<{ entry_fee: number; late_fee_pct: number | null }>;
          };
          feePuts.push(body);
          const row = body.classes?.[0];
          if (row) fees = { entry_fee: row.entry_fee, late_fee_pct: row.late_fee_pct };
          return json({});
        }
        feeGets++;
        const now = { ...fees };
        if (holdFeeGets) await new Promise<void>((r) => heldFeeGets.push(r));
        return json({
          date: '2026-10-08',
          card_fee: null,
          classes: [
            {
              class_id: 'h21',
              name: 'H21',
              class_kind: 'senior',
              entry_fee: now.entry_fee,
              youth_entry_fee: null,
              late_fee_pct: now.late_fee_pct,
            },
          ],
        });
      }
      if (url.endsWith('/classes/kinds')) {
        if (init?.method === 'PUT') return json({ updated: 1 });
        return json({ eventor: 'not_linked', items: [h21] });
      }
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/voided-controls')) return json({ control_codes: [] });
      return json({
        competition: server,
        classes: [{ id: 'h21', name: 'H21', short_name: null }],
        courses: [],
        closing: { last_start_ms: null, closing_time_ms: null },
        max_time_locked: lockedByEdge,
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('SOFT TR 4.21.2: the field is locked when the edge says so (after a race reset, no start time passed here)', async () => {
    lockedByEdge = true;
    await mountView();
    expect($<HTMLInputElement>('info-max-time').readOnly).toBe(true);
    expect(text('info-max-time-lock')).toBe('Låst sedan första start.');
  });

  it('the max time is typed as minutes or mm:ss, as on Lottning: a stored value round-trips and a bad one is refused', async () => {
    await mountView();
    const save = $<HTMLButtonElement>('info-max-time-save');
    expect($<HTMLInputElement>('info-max-time').value).toBe('150:00');
    // Unchanged: nothing to save, whatever way it is written.
    expect(save.disabled).toBe(true);
    await type('info-max-time', '2:30:00');
    expect(save.disabled).toBe(true);
    await type('info-max-time', '90:60');
    save.click();
    await settle();
    expect(maxPatches).toEqual([]);
    expect(document.body.textContent).toContain('Ogiltig maxtid');
    expect(text('info-max-time-format')).toBe('Minuter eller mm:ss, till exempel 150 eller 150:00');
    await type('info-max-time', '90');
    save.click();
    await settle();
    expect(maxPatches).toEqual([{ max_time_sec: 5400 }]);
    expect($<HTMLInputElement>('info-max-time').value).toBe('90:00');
    expect(save.disabled).toBe(true);
  });

  it('a details reply that lands after a max-time save does not bring the old max time back', async () => {
    await mountView();
    const name = $<HTMLInputElement>('info-name');
    name.value = 'Nytt namn';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await type('info-max-time', '100:00');
    $<HTMLButtonElement>('info-max-time-save').click();
    await settle();
    expect(maxPatches).toEqual([{ max_time_sec: 6000 }]);
    // The details reply was made before the max time changed.
    heldDetails[0]!.release();
    await settle();
    expect($<HTMLInputElement>('info-max-time').value).toBe('100:00');
    expect($<HTMLButtonElement>('info-max-time-save').disabled).toBe(true);
  });

  it('typing again clears the max time "Sparat" note', async () => {
    await mountView();
    await type('info-max-time', '100:00');
    $<HTMLButtonElement>('info-max-time-save').click();
    await settle();
    expect(text('info-max-time-note')).toContain('Sparat');
    await type('info-max-time', '100:0');
    expect(text('info-max-time-note')).not.toContain('Sparat');
  });

  it("a class-kind save keeps the fee rows' failed-save note and reloads the fees", async () => {
    await mountView();
    failFeePut = true;
    const fee = document.querySelector<HTMLInputElement>('input[aria-label^="Avgift för H21"]')!;
    fee.value = '200';
    fee.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(text('fees-row-note')).toBe('Det gick inte att spara avgiften.');
    expect(feeGets).toBe(1);
    const kind = document.querySelector<HTMLSelectElement>(
      '[data-class-id="h21"] [data-testid="class-kind-select"]'
    )!;
    kind.value = 'elit';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(feeGets).toBe(2);
    expect(text('fees-row-note')).toBe('Det gick inte att spara avgiften.');
  });

  it('a cleared max time is not brought back by a details reply made before it', async () => {
    await mountView();
    const name = $<HTMLInputElement>('info-name');
    name.value = 'Nytt namn';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await type('info-max-time', '');
    $<HTMLButtonElement>('info-max-time-save').click();
    await settle();
    expect(maxPatches).toEqual([{ max_time_sec: null }]);
    heldDetails[0]!.release();
    await settle();
    await type('info-max-time', '150:00');
    expect($<HTMLButtonElement>('info-max-time-save').disabled).toBe(false);
  });

  it('an older fee reload that lands last does not wipe a fee saved after the newer one', async () => {
    await mountView();
    holdFeeGets = true;
    const kind = document.querySelector<HTMLSelectElement>(
      '[data-class-id="h21"] [data-testid="class-kind-select"]'
    )!;
    kind.value = 'elit';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    kind.value = 'junior';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(heldFeeGets).toHaveLength(2);
    // The newer read lands first; a fee is saved; then the older read lands.
    heldFeeGets[1]!();
    await settle();
    holdFeeGets = false;
    const entry = document.querySelector<HTMLInputElement>('input[aria-label^="Avgift för H21"]')!;
    entry.value = '200';
    entry.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    heldFeeGets[0]!();
    await settle();
    const late = document.querySelector<HTMLInputElement>('input[aria-label^="Tillägg för H21"]')!;
    late.value = '60';
    late.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(feePuts.at(-1)).toMatchObject({ classes: [{ entry_fee: 200, late_fee_pct: 60 }] });
  });
});
