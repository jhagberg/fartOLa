<!--
  Authored for fartola. Not ported from upstream.

  What a card replacement did, with undo (ADR-0016 rule 2): "Bricka bytt för
  <namn>: <gammalt> → <nytt>" and "Ångra". Stays until the operator closes
  it, so the undo does not fade away. Undo gives the runner the old card
  back (POST /api/competitions/:id/card-binds/undo); the read made with the
  new card is an unknown card again.
-->
<script lang="ts">
  import { ApiError, undoCardRebind, type CardRebind } from '#lib/api/client.ts';
  import { t } from '#lib/i18n/index.ts';
  import Button from '#lib/ui/Button.svelte';

  interface Props {
    competitionId: string;
    rebind: CardRebind;
    /** After a successful undo (the parent refetches). */
    onUndone?: () => void;
    onClose: () => void;
  }

  let { competitionId, rebind, onUndone, onClose }: Props = $props();

  // State belongs to one replacement: the parent may show another one in
  // this component, which must start with its own undo.
  const key = $derived(`${rebind.card_event.node_id}:${rebind.card_event.local_seq}`);
  let undoneKey = $state<string | null>(null);
  let busyKey = $state<string | null>(null);
  let errorFor = $state<{ key: string; msg: string } | null>(null);
  const undone = $derived(undoneKey === key);
  const busy = $derived(busyKey === key);
  const error = $derived(errorFor?.key === key ? errorFor.msg : null);

  const oldCard = $derived(
    rebind.card_event.previous_card_number === null
      ? t('walk.entered.noCard')
      : String(rebind.card_event.previous_card_number)
  );

  async function undo(): Promise<void> {
    const k = key;
    const old = oldCard;
    busyKey = k;
    errorFor = null;
    try {
      await undoCardRebind(competitionId, rebind.card_event);
      undoneKey = k;
      onUndone?.();
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | undefined)?.error : null;
      if (code === 'already_undone') {
        undoneKey = k;
      } else {
        errorFor = {
          key: k,
          msg:
            code === 'card_changed_since'
              ? t('ro.rebind.err.changed')
              : code === 'card_taken'
                ? t('ro.rebind.err.taken', { card: old })
                : t('err.network'),
        };
      }
    } finally {
      if (busyKey === k) busyKey = null;
    }
  }
</script>

<section class="notice" role="status" data-testid="card-rebind-notice">
  <p class="msg">
    {#if undone}
      {t('ro.rebind.undone', { name: rebind.name, old: oldCard })}
    {:else}
      {t('ro.rebind.done', { name: rebind.name, old: oldCard, new: String(rebind.card_number) })}
    {/if}
  </p>
  {#if error}
    <p class="err" role="alert">{error}</p>
  {/if}
  <div class="actions">
    {#if !undone}
      <Button
        variant="secondary"
        type="button"
        onclick={() => void undo()}
        disabled={busy}
        data-testid="card-rebind-undo"
      >
        {t('ro.rebind.undo')}
      </Button>
    {/if}
    <Button variant="ghost" type="button" onclick={onClose} data-testid="card-rebind-close">
      {t('ro.rebind.close')}
    </Button>
  </div>
</section>

<style>
  .notice {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .msg {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--fg);
  }
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: 14px;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
