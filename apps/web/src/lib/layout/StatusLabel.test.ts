// apps/web/src/lib/layout/StatusLabel.test.ts
// Authored for fartola. Not ported from upstream.
//
// The "searching for reader" label is text on a light surface, so it must
// use the readable amber (--mp-fg), not the fill amber (--mp, ~2.3:1).

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';
import TopBar from './TopBar.svelte';
import StationCard from './StationCard.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

describe('connecting label colour', () => {
  it('TopBar uses --mp-fg', () => {
    instance = mount(TopBar, { target: document.body, props: { wsStatus: 'connecting' } });
    const el = document.body.querySelector<HTMLElement>('.ws-label')!;
    expect(el.style.color).toBe('var(--mp-fg)');
  });

  it('StationCard uses --mp-fg', () => {
    instance = mount(StationCard, { target: document.body, props: { status: 'connecting' } });
    const el = document.body.querySelector<HTMLElement>('.status-label')!;
    expect(el.style.color).toBe('var(--mp-fg)');
  });
});
