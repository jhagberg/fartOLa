// Authored for fartola. Not ported from upstream.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LoadError from './LoadError.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

describe('LoadError', () => {
  it('says what failed and retries on click', () => {
    const onretry = vi.fn();
    instance = mount(LoadError, {
      target: document.body,
      props: { message: 'Kunde inte hämta klasser.', onretry },
    });
    const box = document.querySelector('[role="alert"]')!;
    expect(box.textContent).toContain('Kunde inte hämta klasser.');
    const btn = box.querySelector('button')!;
    expect(btn.textContent?.trim()).toBe('Försök igen');
    btn.click();
    flushSync();
    expect(onretry).toHaveBeenCalledOnce();
  });
});
