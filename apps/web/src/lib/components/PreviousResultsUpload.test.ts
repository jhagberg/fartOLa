// Authored for fartola. Not ported from upstream.
//
// SOFT TR 7.4.1: a pursuit is drawn from the previous stage's ResultList.
// The mounted upload (jsdom, fake fetch) posts the file as multipart, says
// what it read, lists the runners it could not match, and explains a file
// the server refuses.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import PreviousResultsUpload from './PreviousResultsUpload.svelte';

describe('PreviousResultsUpload (mounted)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let answer: { status: number; body: unknown };
  let calls: Array<{ url: string; file: unknown }>;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  beforeEach(() => {
    calls = [];
    answer = {
      status: 201,
      body: {
        results: 3,
        matched: 2,
        unmatched: [{ competitor_id: 'r9', name: 'Cecilia', club: 'OK C', class_name: 'D21' }],
      },
    };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), file: (init?.body as FormData).get('file') });
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`);

  async function pickAndUpload(): Promise<File> {
    component = mount(PreviousResultsUpload, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
    expect(($('pursuit-results-upload') as HTMLButtonElement).disabled).toBe(true);
    const file = new File(['<ResultList/>'], 'dag1.xml', { type: 'application/xml' });
    const input = $('pursuit-results-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    ($('pursuit-results-upload') as HTMLButtonElement).click();
    await settle();
    return file;
  }

  it('posts the file and lists the runners not in it (they start in the restart block)', async () => {
    const file = await pickAndUpload();
    expect(calls).toEqual([{ url: '/api/competitions/c1/import/previous-results', file }]);
    expect($('pursuit-results-done')!.textContent).toContain(
      'Resultat i filen: 3. Matchade löpare: 2.'
    );
    expect($('pursuit-results-done')!.textContent).toContain('De startar i omstarten');
    expect($('pursuit-results-unmatched')!.textContent).toContain('D21: Cecilia, OK C');
  });

  it('a file that is not an IOF XML 3.0 ResultList is explained, not silently dropped', async () => {
    answer = { status: 400, body: { error: 'xsd_invalid', errors: [] } };
    await pickAndUpload();
    expect($('pursuit-results-error')!.textContent).toContain(
      'Filen är inte en giltig IOF XML 3.0-resultatlista.'
    );
    expect($('pursuit-results-done')).toBeNull();
  });
});
