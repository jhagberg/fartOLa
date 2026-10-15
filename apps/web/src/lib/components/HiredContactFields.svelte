<!--
  Authored for fartola. Not ported from upstream.

  The four contact fields of a hire card (name, phone, e-mail, note), shared
  by the walk-up form and the edit row on Hyrbrickor. Phone and e-mail get a
  light format check when the field is left, and on every key after that;
  an emptied field has nothing to check. `submitted` shows the errors of
  fields the volunteer never visited, so a Save press is not silent.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import { emailValid, phoneValid } from '@fartola/shared-types';
  import Field from '#lib/ui/Field.svelte';
  import Input from '#lib/ui/Input.svelte';

  interface Props {
    name: string;
    phone: string;
    email: string;
    note: string;
    /** Prefix for ids and data-testids: `${prefix}-name`, `-phone-error` … */
    prefix: string;
    submitted?: boolean;
  }

  let {
    name = $bindable(),
    phone = $bindable(),
    email = $bindable(),
    note = $bindable(),
    prefix,
    submitted = false,
  }: Props = $props();

  let phoneTouched = $state(false);
  let emailTouched = $state(false);

  const phoneError = $derived(
    (phoneTouched || submitted) && phone.trim() !== '' && !phoneValid(phone)
      ? t('walk.err.hyrbrickaPhone')
      : null
  );
  const emailError = $derived(
    (emailTouched || submitted) && email.trim() !== '' && !emailValid(email)
      ? t('walk.err.hyrbrickaEmail')
      : null
  );
</script>

<Field label={t('walk.hyrbricka.name')} htmlFor="{prefix}-name">
  <Input id="{prefix}-name" data-testid="{prefix}-name" bind:value={name} />
</Field>
<Field label={t('walk.hyrbricka.phone')} htmlFor="{prefix}-phone">
  <Input
    id="{prefix}-phone"
    data-testid="{prefix}-phone"
    type="tel"
    bind:value={phone}
    onblur={() => (phoneTouched = true)}
    aria-invalid={phoneError ? 'true' : undefined}
    aria-describedby={phoneError ? `${prefix}-phone-error` : undefined}
  />
  {#if phoneError}
    <p class="err" role="alert" id="{prefix}-phone-error" data-testid="{prefix}-phone-error">
      {phoneError}
    </p>
  {/if}
</Field>
<Field label={t('walk.hyrbricka.email')} htmlFor="{prefix}-email">
  <Input
    id="{prefix}-email"
    data-testid="{prefix}-email"
    type="email"
    bind:value={email}
    onblur={() => (emailTouched = true)}
    aria-invalid={emailError ? 'true' : undefined}
    aria-describedby={emailError ? `${prefix}-email-error` : undefined}
  />
  {#if emailError}
    <p class="err" role="alert" id="{prefix}-email-error" data-testid="{prefix}-email-error">
      {emailError}
    </p>
  {/if}
</Field>
<Field label={t('walk.hyrbricka.note')} htmlFor="{prefix}-note">
  <Input id="{prefix}-note" data-testid="{prefix}-note" bind:value={note} />
</Field>

<style>
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: var(--fs-label);
  }
</style>
