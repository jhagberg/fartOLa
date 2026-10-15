// Authored for fartola. Not ported from upstream.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { ApiError } from './client.ts';
import { userMessage } from './userMessage.ts';

describe('userMessage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a server answer is "Något gick fel", the raw error goes to the console', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = new ApiError(500, 'SQLITE_BUSY', { error: 'SQLITE_BUSY' }, '');
    expect(userMessage(e)).toBe('Något gick fel');
    expect(log).toHaveBeenCalledWith(e);
  });

  it('no answer at all is a network error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(userMessage(new TypeError('Failed to fetch'))).toBe('Nätverksfel — försök igen');
    expect(log).toHaveBeenCalledOnce();
  });
});
