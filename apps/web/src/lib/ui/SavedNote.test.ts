// Authored for fartola. Not ported from upstream.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SavedNote from './SavedNote.svelte';
import { createSaveState } from './saveState.svelte.ts';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function render(props: { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string }) {
  instance = mount(SavedNote, { target: document.body, props });
  flushSync();
}

describe('SavedNote', () => {
  it('renders nothing visible when idle', () => {
    render({ state: 'idle' });
    expect(document.body.textContent?.trim()).toBe('');
  });
  it('says Sparar… as a status while saving', () => {
    render({ state: 'saving' });
    const el = document.querySelector('[role="status"]')!;
    expect(el.textContent).toContain('Sparar…');
  });
  it('says Sparat with an icon as a status, then fades after 3 s', () => {
    vi.useFakeTimers();
    render({ state: 'saved' });
    const el = document.querySelector('[role="status"]')!;
    expect(el.textContent).toContain('Sparat');
    expect(el.querySelector('svg')).not.toBeNull();
    vi.advanceTimersByTime(3100);
    flushSync();
    expect(document.body.textContent).not.toContain('Sparat');
  });
  it('shows the error as an alert with an icon and keeps it', () => {
    vi.useFakeTimers();
    render({ state: 'error', error: 'Kunde inte spara.' });
    vi.advanceTimersByTime(10000);
    flushSync();
    const el = document.querySelector('[role="alert"]')!;
    expect(el.textContent).toContain('Kunde inte spara.');
    expect(el.querySelector('svg')).not.toBeNull();
  });
});

describe('createSaveState', () => {
  it('goes saving to saved', async () => {
    const s = createSaveState();
    expect(s.state).toBe('idle');
    const p = s.run(Promise.resolve());
    expect(s.state).toBe('saving');
    await p;
    expect(s.state).toBe('saved');
  });
  it('goes to error with the message on rejection, never saved', async () => {
    const s = createSaveState();
    await s.run(Promise.reject(new Error('boom')));
    expect(s.state).toBe('error');
    expect(s.error).toBe('boom');
  });
  it('lets a newer success win over an older slow failure', async () => {
    const s = createSaveState();
    let rejectA!: (e: Error) => void;
    const a = s.run(new Promise<void>((_, rej) => (rejectA = rej)));
    await s.run(Promise.resolve());
    expect(s.state).toBe('saved');
    rejectA(new Error('late'));
    await a;
    expect(s.state).toBe('saved');
    expect(s.error).toBe('');
  });
  it('reset returns to idle and ignores an in-flight run', async () => {
    const s = createSaveState();
    let resolveA!: () => void;
    const a = s.run(new Promise<void>((res) => (resolveA = res)));
    s.reset();
    expect(s.state).toBe('idle');
    resolveA();
    await a;
    expect(s.state).toBe('idle');
  });
});
