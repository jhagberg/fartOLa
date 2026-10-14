---
created: 2026-10-14T13:00:00+02:00
title: Three flaky e2e tests that can turn CI red
area: testing
files:
  - tests/e2e/settings-nav.spec.ts
  - tests/e2e/helpers/walkup.ts
  - tests/e2e/a11y.spec.ts
  - tests/e2e/layout.spec.ts
---

Seen by the design-lab session, 2026-10-12 to 2026-10-13. None of them
has a known product bug behind it yet; find out which it is before
changing the wait.

1. `settings-nav.spec.ts:333` "a late Liveresultat and helper-code load
   for the old competition is ignored": fails about 1 run in 6, also
   alone. The only one that fails on an idle machine, so look at the
   test's ordering first (does it wait for the old load to start before
   switching?), then at the screen.
2. `a11y.spec.ts` "walkup card taken": `openWalkup` in
   `helpers/walkup.ts` waits the default 5 s for the dialog. On a busy
   machine the first visit needs up to 20 s (see the first-visit waits
   in the other specs). Passed 3/3 alone.
3. `layout.spec.ts:60` "choosing a competition in the drawer closes it
   on the new page": fails with two workers. Probably shared state
   between workers (the active competition), not timing.

Done when each passes 20 runs in a row with `--repeat-each=20`, the
third also with two workers.

Machine note, not a test bug: on this workstation
`dns.lookup('localhost', {family: 6})` takes 10 s because `/etc/hosts`
lacks `::1 localhost`, and every Playwright API call times out. Rule
that out before calling a test flaky locally; CI is not affected.
