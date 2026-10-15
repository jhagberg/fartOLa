// Authored for fartola. Not ported from upstream.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import Field from './Field.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

const input = (attrs = '') =>
  createRawSnippet(() => ({ render: () => `<input id="f" ${attrs} />` }));

function description(el: HTMLElement): string {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ');
}

describe('Field hint', () => {
  it('is the accessible description of the input', () => {
    instance = mount(Field, {
      target: document.body,
      props: { label: 'Maxtid', htmlFor: 'f', hint: 'Minuter eller mm:ss', children: input() },
    });
    flushSync();
    expect(description(document.getElementById('f')!)).toBe('Minuter eller mm:ss');
  });

  it('keeps an error id the caller already set, and survives it changing', async () => {
    const err = document.createElement('p');
    err.id = 'err';
    err.textContent = 'Fel';
    document.body.append(err);
    instance = mount(Field, {
      target: document.body,
      props: {
        label: 'Maxtid',
        htmlFor: 'f',
        hint: 'Minuter eller mm:ss',
        children: input('aria-describedby="err"'),
      },
    });
    flushSync();
    const el = document.getElementById('f')!;
    expect(description(el)).toBe('Fel Minuter eller mm:ss');
    el.setAttribute('aria-describedby', 'err');
    await Promise.resolve();
    expect(description(el)).toBe('Fel Minuter eller mm:ss');
  });

  it('adds nothing without a hint', () => {
    instance = mount(Field, {
      target: document.body,
      props: { label: 'Namn', htmlFor: 'f', children: input() },
    });
    flushSync();
    expect(document.getElementById('f')!.hasAttribute('aria-describedby')).toBe(false);
  });
});
