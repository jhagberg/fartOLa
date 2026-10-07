<!--
  Authored for fartola. Not ported from upstream.

  PunchCode — the code cell of a controls list on a receipt or in the splits
  table: "M" for the finish, "<s>32</s> struken" for a voided control,
  "47 (extra)" / "34 (fel ordn.)" for a punch off the course, else the code.
  The label is text so the status never relies on colour alone.
-->
<script lang="ts">
  import { punchLabel } from './punchLabels.ts';
  import type { ReceiptPunch } from './types.ts';

  let { p, finishText = 'M' }: { p: ReceiptPunch; finishText?: string } = $props();
  const label = $derived(punchLabel(p));
</script>

{#if p.finish}{finishText}{:else if p.kind === 'struck'}<s>{p.code}</s> {label}{:else if label}{p.code}
  ({label}){:else}{p.code}{/if}
