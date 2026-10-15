// Authored for fartola. Not ported from upstream.
//
// What a failed request says on screen: plain words, never the server's own
// text. The raw error goes to the console for whoever is debugging.
import { t } from '#lib/i18n/index.ts';
import { ApiError } from './client.ts';

export function userMessage(e: unknown): string {
  console.error(e);
  // An answer from the server vs. no answer at all.
  return e instanceof ApiError ? t('common.unknownError') : t('err.network');
}
