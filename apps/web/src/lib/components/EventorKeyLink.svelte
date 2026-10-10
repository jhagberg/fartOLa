<!--
  Authored for fartola. Not ported from upstream.

  Link shown next to a "no Eventor key" message: one step to the field
  where the key is entered (ADR-0016 rule 4).
-->
<script lang="ts">
  import { t } from '../i18n/index.ts';
</script>

<a class="key-link" href="/installningar#eventor" data-testid="eventor-key-link">
  {t('eventor.keyLink')}
</a>

<style>
  .key-link {
    display: inline-flex;
    align-items: center;
    min-height: var(--hit);
    color: var(--accent-strong);
    font-size: var(--fs-label);
    font-weight: 500;
    text-decoration: underline;
  }
</style>
