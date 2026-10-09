<!--
  Authored for fartola. Not ported from upstream.

  The recent card replacements, newest first, each with its own Ångra and
  Stäng (ADR-0016 rule 2: recent changes stay in a list they can be undone
  from). Keyed by the replacement event, so one notice never takes over
  another's state. The parent owns the list.
-->
<script lang="ts">
  import type { CardRebind } from '#lib/api/client.ts';
  import CardRebindNotice from '#lib/components/CardRebindNotice.svelte';

  interface Props {
    competitionId: string;
    rebinds: CardRebind[];
    onUndone?: ((r: CardRebind) => void) | undefined;
    onClose: (r: CardRebind) => void;
  }

  let { competitionId, rebinds, onUndone, onClose }: Props = $props();
</script>

{#each rebinds as r (`${r.card_event.node_id}:${r.card_event.local_seq}`)}
  <CardRebindNotice
    {competitionId}
    rebind={r}
    onUndone={() => onUndone?.(r)}
    onClose={() => onClose(r)}
  />
{/each}
