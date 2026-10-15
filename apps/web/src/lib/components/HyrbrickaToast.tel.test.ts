// Authored for fartola. Not ported from upstream.
//
// The phone number is a tel: link only on a touch screen; on a laptop a
// tel: link would hand the number to Zoom or Teams.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

import HyrbrickaToast from './HyrbrickaToast.svelte';

function stubPointer(coarse: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(pointer: coarse)' && coarse,
  })) as unknown as typeof window.matchMedia;
}

describe('HyrbrickaToast — phone number', () => {
  let component: ReturnType<typeof mount> | null = null;
  const show = (): HTMLElement => {
    component = mount(HyrbrickaToast, {
      target: document.body,
      props: {
        cardNumber: 7501853,
        contactName: 'Anna Andersson',
        contactPhone: '0701234567',
        contactEmail: null,
        note: null,
        onReturn: vi.fn(),
        onDismiss: vi.fn(),
      },
    });
    flushSync();
    return document.querySelector<HTMLElement>('[data-testid="hyrbricka-contact-phone"]')!;
  };

  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  it('is a tel: link on a touch screen', () => {
    stubPointer(true);
    const el = show();
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('tel:0701234567');
  });

  it('is plain text with a mouse', () => {
    stubPointer(false);
    const el = show();
    expect(el.tagName).not.toBe('A');
    expect(el.textContent).toBe('0701234567');
  });
});
