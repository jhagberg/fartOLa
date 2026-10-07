<!--
  Authored for fartola. Not ported from upstream.

  /installningar route — SvelteKit wrapper that mounts SettingsView
  under the App shell. The component is the surface; this file is
  the 3-line entry point so SvelteKit's file-system router picks it
  up (Plan 02-07 Task 3).

  Locked by:
  - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 3
-->
<script lang="ts">
  import SettingsView from '#lib/screens/SettingsView.svelte';
</script>

<SettingsView />
