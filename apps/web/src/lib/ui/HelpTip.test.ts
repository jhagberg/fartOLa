// Authored for fartola. Not ported from upstream.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import HelpTip from './HelpTip.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

const open = () => {
  instance = mount(HelpTip, {
    target: document.body,
    props: { id: 'tip', text: 'Därför.', tr: 'TR 4.21.2' },
  });
  flushSync();
  return document.querySelector('button')!;
};

describe('HelpTip', () => {
  it('is a button named "Varför?" that controls a closed explanation', () => {
    const btn = open();
    expect(btn.getAttribute('aria-label')).toBe('Varför?');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(btn.getAttribute('aria-controls')!)!.hidden).toBe(true);
  });

  it('opens on click with the rule number, closes on a second click and on Escape', () => {
    const btn = open();
    const body = document.getElementById('tip')!;
    btn.click();
    flushSync();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(body.textContent).toContain('SOFT TR 4.21.2');
    expect(body.textContent).toContain('Därför.');
    btn.click();
    flushSync();
    expect(body.hidden).toBe(true);
    btn.click();
    flushSync();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});
