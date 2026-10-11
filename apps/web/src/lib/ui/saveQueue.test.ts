// Authored for fartola. Not ported from upstream.
//
// The per-card / per-row save queue (ADR-0016 rule 3): one request in
// flight, later edits coalesce into the next one, `saved` moves only on
// success. Requests are held promises the test settles by hand.

import { describe, it, expect } from 'vitest';
import { createSaveQueue } from './saveQueue.ts';

type Row = { a: number; b: number };

function held() {
  const calls: Array<{
    change: Partial<Row>;
    saved: Row;
    ok: () => void;
    fail: (e: Error) => void;
  }> = [];
  const send = (change: Partial<Row>, saved: Row) =>
    new Promise<void>((resolve, reject) =>
      calls.push({ change, saved, ok: resolve, fail: reject })
    );
  return { calls, send };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createSaveQueue', () => {
  it('sends one request at a time; edits made meanwhile go out together next', async () => {
    const { calls, send } = held();
    const q = createSaveQueue<Row>({ a: 1, b: 1 }, send);
    const first = q.save({ a: 2 });
    const second = q.save({ b: 3 });
    const third = q.save({ a: 4 });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.change).toEqual({ a: 2 });

    calls[0]!.ok();
    await first;
    await flush();
    expect(calls).toHaveLength(2);
    // Both waiting edits, the same field at its latest value, on the new saved row.
    expect(calls[1]!.change).toEqual({ b: 3, a: 4 });
    expect(calls[1]!.saved).toEqual({ a: 2, b: 1 });

    calls[1]!.ok();
    await Promise.all([second, third]);
    expect(q.saved).toEqual({ a: 4, b: 3 });
  });

  it('a failure rejects that batch and keeps the last saved values; the queue goes on', async () => {
    const { calls, send } = held();
    const q = createSaveQueue<Row>({ a: 1, b: 1 }, send);
    const first = q.save({ a: 2 });
    const second = q.save({ b: 5 });
    await flush();
    calls[0]!.fail(new Error('500'));
    await expect(first).rejects.toThrow('500');
    expect(q.saved).toEqual({ a: 1, b: 1 });

    await flush();
    expect(calls[1]!.change).toEqual({ b: 5 });
    expect(calls[1]!.saved).toEqual({ a: 1, b: 1 });
    calls[1]!.ok();
    await second;
    expect(q.saved).toEqual({ a: 1, b: 5 });
  });

  it('an edit after the queue went idle starts a new request at once', async () => {
    const { calls, send } = held();
    const q = createSaveQueue<Row>({ a: 1, b: 1 }, send);
    const first = q.save({ a: 2 });
    await flush();
    calls[0]!.ok();
    await first;
    await flush();
    void q.save({ b: 2 });
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.change).toEqual({ b: 2 });
  });
});
