// Authored for fartola. Not ported from upstream.
//
// "Ny tävling" asks for the level (ADR-0018): the from-wizard request carries it,
// so the edge can store it before the courses import.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

const { default: NewCompetitionWizard } = await import('./NewCompetitionWizard.svelte');

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};
const byId = <T extends HTMLElement>(id: string): T =>
  document.querySelector<T>(`[data-testid="${id}"]`)!;
const type = (id: string, value: string): void => {
  const el = byId<HTMLInputElement>(id);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('wizard level (ADR-0018)', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const create = async (level: string | null): Promise<Record<string, unknown>> => {
    const bodies: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/competitions/from-wizard') {
        bodies.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ competition_id: 'c1', kind: 'CourseData' }), {
          status: 201,
        });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    component = mount(NewCompetitionWizard, { target: document.body });
    await settle();
    type('wiz-name', 'Test');
    type('wiz-date', '2026-05-19');
    if (level !== null) {
      const select = byId<HTMLSelectElement>('wiz-level');
      select.value = level;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await settle();
    byId<HTMLButtonElement>('wiz-next').click();
    await settle();
    const xml =
      '<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"></CourseData>';
    await vi.waitFor(() => expect(byId('drop-zone-input')).not.toBeNull());
    const input = byId<HTMLInputElement>('drop-zone-input');
    Object.defineProperty(input, 'files', {
      value: [new File([xml], 'course.xml', { type: 'text/xml' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await vi.waitFor(() => expect(byId<HTMLButtonElement>('wiz-start').disabled).toBe(false));
    byId<HTMLButtonElement>('wiz-start').click();
    await settle();
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    return bodies[0]!;
  };

  it('sends the chosen level', async () => {
    expect((await create('niva2')).level).toBe('niva2');
  });

  it('sends null when no level is chosen', async () => {
    expect((await create(null)).level).toBeNull();
  });
});
