// Authored for fartola. Not ported from upstream.
// Save state for a field that saves on change. A newer run (or reset)
// supersedes older ones, so a slow failure never overwrites a newer success.
import { t } from '#lib/i18n/index.ts';

export type SaveStateName = 'idle' | 'saving' | 'saved' | 'error';

export function createSaveState() {
  let state = $state<SaveStateName>('idle');
  let error = $state('');
  let details = $state('');
  let generation = 0;

  async function run(promise: Promise<unknown>, opts?: { error?: string }): Promise<void> {
    const mine = ++generation;
    state = 'saving';
    error = '';
    details = '';
    try {
      await promise;
      if (mine === generation) state = 'saved';
    } catch (e) {
      if (mine !== generation) return;
      details = e instanceof Error ? e.message : String(e);
      console.error('save failed:', e);
      error = opts?.error ?? t('common.unknownError');
      state = 'error';
    }
  }

  function reset() {
    generation++;
    state = 'idle';
    error = '';
    details = '';
  }

  return {
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    get details() {
      return details;
    },
    run,
    reset,
  };
}
