// Authored for fartola. Not ported from upstream.
//
// Reactive props for CardRebindNotice.test.ts ($state needs a .svelte.ts file).
import type { CardRebind } from '#lib/api/client.ts';

export const noticeProps = $state<{ rebind: CardRebind }>({
  rebind: {
    competitor_id: 'eva',
    name: 'Eva Ek',
    card_number: 2222222,
    card_event: { node_id: 'n', local_seq: 7, previous_card_number: 1111111 },
  },
});
