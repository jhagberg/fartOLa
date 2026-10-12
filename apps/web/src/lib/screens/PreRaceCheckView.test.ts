// Authored for fartola. Not ported from upstream.
//
// Kontroll: overlapping loads (the newest answer wins) and the "Fri start"
// shortcut for a class without start times.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/competition/c1/kontroll') },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

const { default: PreRaceCheckView } = await import('./PreRaceCheckView.svelte');

const runner = (id: string, cls: string, offer = true) => ({
  competitor_id: id,
  name: `Löpare ${id}`,
  club: null,
  class_id: cls,
  class_name: cls.toUpperCase(),
  card_number: 1,
  free_start_offer: offer,
});
const check = (over: Record<string, unknown> = {}) => ({
  no_card: [],
  no_start_time: [],
  start_choice_conflicts: [],
  no_club: [],
  no_name: [],
  card_too_small: [],
  splits_missing: [],
  classes_without_course: [],
  start_clashes: [],
  first_control_clashes: [],
  ...over,
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

let checkHeld: Array<(r: Response) => void>;
let patches: Array<{ url: string; body: unknown; answer: (r: Response) => void }>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('PreRaceCheckView', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    checkHeld = [];
    patches = [];
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/pre-race-check')) return new Promise<Response>((r) => checkHeld.push(r));
      if (init?.method === 'PATCH')
        return new Promise<Response>((answer) =>
          patches.push({ url, body: JSON.parse(String(init.body)), answer })
        );
      if (url.endsWith('/competitors')) return json({ competitors: [] });
      if (url.endsWith('/classes')) return json({ classes: [] });
      return json({ open: [], returned: [] });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const mountView = async (): Promise<void> => {
    component = mount(PreRaceCheckView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
  };

  it('an older load answering last does not replace the newer rows', async () => {
    await mountView();
    // The mount load is #1; the rerun button shows once it has answered.
    await vi.waitFor(() => expect(checkHeld).toHaveLength(1));
    checkHeld[0]!(json(check({ no_start_time: [runner('a', 'old')] })));
    await settle();
    document.querySelector<HTMLButtonElement>('[data-testid="prerace-rerun"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-testid="prerace-rerun"]')!.click();
    await settle();
    expect(checkHeld).toHaveLength(3);
    // Newest (#3) answers first, the older (#2) lands last.
    checkHeld[2]!(json(check({ no_start_time: [runner('n1', 'new'), runner('n2', 'new')] })));
    await settle();
    checkHeld[1]!(json(check({ no_start_time: [runner('o', 'older')] })));
    await settle();
    expect(document.body.textContent).toContain('NEW');
    expect(document.body.textContent).not.toContain('OLDER');
  });

  it('an older load failing last does not replace the newer rows with an error', async () => {
    await mountView();
    checkHeld[0]!(json(check()));
    await settle();
    const rerun = (): void =>
      document.querySelector<HTMLButtonElement>('[data-testid="prerace-rerun"]')!.click();
    rerun();
    rerun();
    await settle();
    checkHeld[2]!(json(check({ no_start_time: [runner('n', 'new')] })));
    await settle();
    checkHeld[1]!(json({ error: 'x' }, 500));
    await settle();
    expect(document.body.textContent).toContain('NEW');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  const loaded = async (body: unknown): Promise<void> => {
    await mountView();
    checkHeld[0]!(json(body));
    await settle();
  };
  const freeButtons = (): HTMLButtonElement[] => [
    ...document.querySelectorAll<HTMLButtonElement>('[data-testid="prerace-free-start"]'),
  ];

  it('Fri start shows only where the row says free_start_offer', async () => {
    await loaded(check({ no_start_time: [runner('a', 'yes', true), runner('b', 'no', false)] }));
    expect(freeButtons()).toHaveLength(1);
    expect(freeButtons()[0]!.getAttribute('aria-label')).toBe('Fri start: YES');
    expect(document.body.textContent).toContain(
      'Fri start: tiden räknas från startstämplingen och klassen behöver ingen startlista.'
    );
    expect(document.body.textContent).toContain('Lotta klassen');
  });

  it('Fri start sends only_if_offered, reloads and says the class has free start', async () => {
    await loaded(check({ no_start_time: [runner('a', 'h21')] }));
    freeButtons()[0]!.click();
    await settle();
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain('/classes/h21');
    expect(patches[0]!.body).toEqual({ start_method: 'free_start', only_if_offered: true });
    expect(freeButtons()[0]!.disabled).toBe(true);
    patches[0]!.answer(json({ ok: true }));
    await settle();
    expect(checkHeld).toHaveLength(2);
    checkHeld[1]!(json(check()));
    await settle();
    const status = document.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('H21 har nu fri start.');
    expect(status.querySelector('a')!.getAttribute('href')).toBe(
      '/competition/c1/lottning?klass=h21'
    );
    expect(status.querySelector('a')!.textContent).toBe('Ändra i Lottning');
    expect(document.querySelectorAll('[data-testid="prerace-class-link"]')).toHaveLength(0);
  });

  it('a save for one class does not block another class button', async () => {
    await loaded(check({ no_start_time: [runner('a', 'h21'), runner('b', 'd21')] }));
    freeButtons()[0]!.click();
    await settle();
    const [first, second] = freeButtons();
    expect(first!.disabled).toBe(true);
    expect(second!.disabled).toBe(false);
  });

  it('409 class_has_results says so on that row and reloads the check', async () => {
    await loaded(check({ no_start_time: [runner('a', 'h21')] }));
    freeButtons()[0]!.click();
    await settle();
    patches[0]!.answer(json({ error: 'class_has_results' }, 409));
    await settle();
    expect(document.body.textContent).toContain(
      'Klassen har redan avläsningar eller resultat. Ändra i Lottning.'
    );
    expect(checkHeld).toHaveLength(2);
    expect(document.querySelector('[role="status"]')!.textContent?.trim()).toBe('');
  });

  it('a 500 shows a plain error on the row, no raw text, and the button works again', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await loaded(check({ no_start_time: [runner('a', 'h21')] }));
    freeButtons()[0]!.click();
    await settle();
    patches[0]!.answer(json({ error: 'boom_internal' }, 500));
    await settle();
    const row = document.querySelector('[data-testid="prerace-class-link"]')!;
    expect(row.textContent).toContain('Något gick fel');
    expect(row.textContent).not.toContain('boom_internal');
    expect(freeButtons()[0]!.disabled).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it('a save finishing after the page is left writes nothing', async () => {
    await loaded(check({ no_start_time: [runner('a', 'h21')] }));
    freeButtons()[0]!.click();
    await settle();
    void unmount(component!);
    component = null;
    patches[0]!.answer(json({ ok: true }));
    await settle();
    expect(checkHeld).toHaveLength(1);
    expect(document.body.textContent).not.toContain('har nu fri start');
  });

  it('start_choice_conflicts show as their own section with the rule text', async () => {
    await loaded(
      check({
        start_choice_conflicts: [
          {
            class_id: 'h16',
            class_name: 'H16',
            runners: 3,
            reason: 'free_start_forbidden',
            free_start_offer: false,
          },
          {
            class_id: 'd21',
            class_name: 'D21',
            runners: 2,
            reason: 'free_start_required',
            free_start_offer: true,
          },
        ],
      })
    );
    const sec = document.querySelector('[data-testid="prerace-section-startChoice"]')!;
    expect(sec.textContent).toContain(
      'H16: fri start är inte tillåten i åldersklass på nivå 1–3 (TR 7.4.2). Välj Lottad starttid.'
    );
    expect(sec.textContent).toContain(
      'D21: öppen klass ska ha fri starttid på nivå 1–3 (TR 7.4.3). Välj Fri start.'
    );
    expect(sec.querySelectorAll('a')).toHaveLength(2);
    expect(sec.querySelectorAll('[data-testid="prerace-free-start"]')).toHaveLength(1);
  });
});
