// apps/web/src/lib/layout/AppShell.test.ts
// Authored for fartola. Not ported from upstream.
//
// In drawer mode (≤1024 px) the closed drawer is inert, so Tab cannot
// land in an off-screen sidebar; opening it lifts inert.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AppShell from './AppShell.svelte';

let fireChange: (matches: boolean) => void = () => {};

function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: (_type: string, listener: (e: { matches: boolean }) => void) => {
      fireChange = (m) => listener({ matches: m });
    },
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

  it('closes the drawer when the window widens past the breakpoint', () => {
    mockMatchMedia(true);
    instance = mount(AppShell, { target: document.body, props: {} });
    flushSync();
    document.body.querySelector<HTMLButtonElement>('[data-testid="topbar-menu"]')!.click();
    flushSync();
    expect(document.body.querySelector('.app')!.classList.contains('drawer-open')).toBe(true);
    fireChange(false);
    flushSync();
    expect(document.body.querySelector('.app')!.classList.contains('drawer-open')).toBe(false);
    const main = document.body.querySelector('main') as HTMLElement;
    expect(main.inert).toBeFalsy();
    expect(main.hasAttribute('inert')).toBe(false);
  });
});
