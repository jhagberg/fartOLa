// Authored for fartola. Not ported from upstream.
//
// An accent swatch is a colour: its name is shown as text, not only in a
// hover title.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AppearanceSettings from './AppearanceSettings.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

describe('AppearanceSettings accent', () => {
  it('shows the name of the chosen accent as text next to the swatches', () => {
    instance = mount(AppearanceSettings, { target: document.body });
    flushSync();
    const chosen = document.querySelector<HTMLElement>('.swatches [aria-pressed="true"]')!;
    const name = chosen.getAttribute('aria-label')!;
    expect(document.querySelector('[data-testid="accent-name"]')?.textContent?.trim()).toBe(name);
  });
});
