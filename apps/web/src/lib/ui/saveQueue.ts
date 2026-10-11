// Authored for fartola. Not ported from upstream.
// One save at a time for a card or a row that saves on change (ADR-0016
// rule 3). Edits made while a save is in flight wait and go out together
// in the next one, so a quick second edit is never lost or sent on stale
// values. `saved` holds what the server last confirmed; it moves only on
// success, so a caller rolls a failed field back to it.

export interface SaveQueue<T extends object> {
  /** The values the server last confirmed. */
  readonly saved: T;
  /** Queue a change. Resolves when it is saved; rejects if that save fails. */
  save(change: Partial<T>): Promise<void>;
}

/** `send` gets the changed fields and the last saved values; it must reject
 * on failure. */
export function createSaveQueue<T extends object>(
  initial: T,
  send: (change: Partial<T>, saved: T) => Promise<unknown>
): SaveQueue<T> {
  let saved = { ...initial };
  let waiting: Partial<T> = {};
  let waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  let inFlight = false;

  async function flush(): Promise<void> {
    inFlight = true;
    while (waiters.length > 0) {
      const change = waiting;
      const batch = waiters;
      waiting = {};
      waiters = [];
      try {
        await send(change, saved);
        saved = { ...saved, ...change };
        for (const w of batch) w.resolve();
      } catch (e) {
        for (const w of batch) w.reject(e);
      }
    }
    inFlight = false;
  }

  return {
    get saved() {
      return saved;
    },
    save(change) {
      waiting = { ...waiting, ...change };
      const done = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
      if (!inFlight) void flush();
      return done;
    },
  };
}
