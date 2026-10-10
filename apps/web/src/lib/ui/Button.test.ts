// Authored for fartola. Not ported from upstream.
//
// Audit RG-3: a primary that cannot act yet stays disabled and says
// what is missing, next to it, linked for screen readers.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, createRawSnippet } from 'svelte';
import Button from './Button.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

const label = createRawSnippet(() => ({ render: () => '<span>Lägg till</span>' }));

describe('Button disabledHint', () => {
  it('shows the hint and links it when disabled', () => {
    instance = mount(Button, {
      target: document.body,
      props: { disabled: true, disabledHint: 'Skriv ett bricknummer', children: label },
    });
    const btn = document.querySelector('button')!;
    const hint = document.querySelector('.btn-hint')!;
    expect(hint.textContent).toBe('Skriv ett bricknummer');
    expect(btn.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('shows no hint when enabled', () => {
    instance = mount(Button, {
      target: document.body,
      props: { disabled: false, disabledHint: 'Skriv ett bricknummer', children: label },
    });
    expect(document.querySelector('.btn-hint')).toBeNull();
    expect(document.querySelector('button')!.hasAttribute('aria-describedby')).toBe(false);
  });
});
