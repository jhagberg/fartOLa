// apps/web/src/lib/layout/AppShell.test.ts
// Authored for fartola. Not ported from upstream.
//
// In drawer mode (≤1024 px) the closed drawer is inert, so Tab cannot
// land in an off-screen sidebar; opening it lifts inert.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AppShell from './AppShell.svelte';

function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const slot = () => document.body.querySelector('.sidebar-slot')!;

describe('AppShell drawer', () => {
  it('closed drawer is inert at tablet width, open drawer is not', () => {
    mockMatchMedia(true);
    instance = mount(AppShell, { target: document.body, props: {} });
    flushSync();
    // Svelte sets the inert property; jsdom does not reflect it to an attribute.
    expect((slot() as HTMLElement).inert).toBe(true);
    document.body.querySelector<HTMLButtonElement>('[data-testid="topbar-menu"]')!.click();
    flushSync();
    expect((slot() as HTMLElement).inert).toBe(false);
  });

  it('sidebar is never inert on a wide screen', () => {
    mockMatchMedia(false);
    instance = mount(AppShell, { target: document.body, props: {} });
    flushSync();
    expect((slot() as HTMLElement).inert).toBe(false);
  });
});
