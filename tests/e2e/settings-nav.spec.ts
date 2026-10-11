// tests/e2e/settings-nav.spec.ts
// Authored for fartola. Not ported from upstream.
//
// PR 6 (design lab): the settings page is a normal menu item, deep
// links land on the right section, and a missing Eventor key is one
// click from the place that fixes it (ADR-0016 rule 4).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { seedCompetition, BASE } from './helpers/seed.ts';
import { pinActive } from './helpers/settings.ts';

test('Inställningar in the sidebar opens the settings page, marked active', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  const nav = page.locator('.sidebar').getByRole('button', { name: 'Inställningar' });
  await nav.click();
  // vite dev compiles the settings route on its first visit; under a
  // parallel run that can take longer than the default 5 s.
  await expect(page).toHaveURL(/\/installningar$/, { timeout: 20_000 });
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await expect(nav).toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('.sidebar').getByRole('button', { name: 'Tävlingar' })
  ).not.toHaveAttribute('aria-current', 'page');
});

test('/access does not mark Tävlingar active', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/access');
  await expect(
    page.locator('.sidebar').getByRole('button', { name: 'Tävlingar' })
  ).not.toHaveAttribute('aria-current', 'page');
});

test('/installningar#eventor scrolls to and focuses the Eventor heading', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto('/installningar#eventor');
  const heading = page.locator('#eventor h3');
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

test('a deep link to a lower section scrolls it into view', async ({ page, request }) => {
  const { competitionId } = await seedCompetition(request, { controls: 3 });
  await pinActive(page, competitionId);
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto('/installningar#hjalpkoder');
  const heading = page.locator('#hjalpkoder h3');
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

test('settings sections come in the agreed order, in two named groups', async ({
  page,
  request,
}) => {
  const { competitionId } = await seedCompetition(request, { controls: 3 });
  const listed = (await (await request.get(`${BASE}/api/competitions`)).json()) as {
    competitions: Array<{ id: string; name: string }>;
  };
  const name = listed.competitions.find((c) => c.id === competitionId)?.name ?? '';
  await pinActive(page, competitionId);
  await page.goto('/installningar');
  await expect(page.getByTestId('settings-view')).toBeVisible();
  const view = page.getByTestId('settings-view');
  await expect(view.getByRole('heading', { level: 2 })).toHaveText([
    `Den här tävlingen: ${name}`,
    'Alla tävlingar på den här datorn',
  ]);
  await expect(page.locator('#hjalpkoder')).toBeVisible();
  const ids = await page
    .locator('[data-testid="settings-view"] section[id]')
    .evaluateAll((els) => els.map((e) => e.id));
  expect(ids).toEqual(['liveresultat', 'radio', 'hjalpkoder', 'eventor', 'meos', 'utseende']);
});

test('without an active competition the competition group says so and links home', async ({
  page,
}) => {
  await page.route('**/api/sessions/active-competition', (r) =>
    r.fulfill({ json: { competition_id: null } })
  );
  await page.goto('/installningar');
  const group = page.locator('.group').first();
  await expect(group.getByText('Välj en tävling under Tävlingar först.')).toBeVisible();
  await expect(group.getByRole('link')).toHaveAttribute('href', '/');
  await expect(page.locator('#liveresultat')).toHaveCount(0);
  await expect(page.locator('#eventor')).toBeVisible();
});

test('Liveresultat says whether live results are on or off', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await pinActive(page, id);
  const url = `**/api/competitions/${id}/liveresultat/credentials`;
  await page.route(url, (r) => {
    const m = r.request().method();
    if (m === 'PATCH') return r.fulfill({ json: { liveresultat_id: '123', has_password: true } });
    if (m === 'DELETE') return r.fulfill({ json: { liveresultat_id: null, has_password: false } });
    return r.fulfill({ json: { liveresultat_id: null, has_password: false } });
  });
  await page.goto('/installningar');
  const sec = page.locator('#liveresultat');
  await sec.getByTestId('liveresultat-id').fill('123');
  await sec.getByTestId('liveresultat-password').fill('hemligt');
  await sec.getByTestId('liveresultat-save').click();
  await expect(sec.getByRole('status')).toHaveText('Liveresultat är påslaget.');
  await sec.getByTestId('liveresultat-clear').click();
  await expect(sec.getByRole('status')).toHaveText('Liveresultat är avstängt.');
});

test('a failed helper code shows an error in the card', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await pinActive(page, id);
  await page.route(`**/api/competitions/${id}/event-codes`, (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ status: 500, json: { error: 'x' } })
      : r.fulfill({ json: { codes: [] } })
  );
  await page.goto('/installningar');
  await page.getByTestId('helper-codes-generate').click();
  await expect(page.locator('#hjalpkoder').getByRole('alert')).toHaveText(
    'Kunde inte skapa en kod.'
  );
});

test('MeOS: Sparat disappears when you edit the password', async ({ page }) => {
  await page.route('**/api/settings/meos', (r) =>
    r.fulfill({ json: { has_meos_password: true, meos_allow_without_password: false } })
  );
  await page.goto('/installningar');
  const card = page.locator('#meos');
  await card.getByTestId('meos-password-input').fill('abc');
  await card.getByTestId('meos-password-save').click();
  await expect(card.getByTestId('meos-settings-toast')).toHaveText(/^Sparat/);
  await card.getByTestId('meos-password-input').fill('abcd');
  await expect(card.getByTestId('meos-settings-toast')).toHaveCount(0);
});

test('MeOS: the checkbox alone saves without sending a password', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('**/api/settings/meos', (r) => {
    if (r.request().method() === 'PUT') {
      bodies.push(r.request().postDataJSON());
      return r.fulfill({ json: { has_meos_password: true, meos_allow_without_password: true } });
    }
    return r.fulfill({ json: { has_meos_password: true, meos_allow_without_password: false } });
  });
  await page.goto('/installningar');
  const card = page.locator('#meos');
  await card.getByLabel('Tillåt MeOS utan lösenord').check();
  expect(bodies).toEqual([]);
  await card.getByTestId('meos-password-save').click();
  await expect(card.getByTestId('meos-settings-toast')).toBeVisible();
  expect(bodies).toEqual([{ meos_allow_without_password: true }]);
  await card.getByRole('button', { name: 'Ta bort lösenord' }).click();
  await expect(async () => expect(bodies).toHaveLength(2)).toPass();
  expect(bodies[1]).toEqual({ meos_password: '' });
});

test('MeOS: Ta bort lösenord waits while the access change is unsaved', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('**/api/settings/meos', (r) => {
    if (r.request().method() === 'PUT') bodies.push(r.request().postDataJSON());
    return r.fulfill({ json: { has_meos_password: true, meos_allow_without_password: true } });
  });
  await page.goto('/installningar');
  const card = page.locator('#meos');
  const clear = card.getByRole('button', { name: 'Ta bort lösenord' });
  await expect(clear).toBeEnabled();
  await card.getByLabel('Tillåt MeOS utan lösenord').uncheck();
  await expect(clear).toBeDisabled();
  await expect(card).toContainText('Spara eller ångra ändringen först');
  await card.getByLabel('Tillåt MeOS utan lösenord').check();
  await expect(clear).toBeEnabled();
  expect(bodies).toEqual([]);
});

test('a deep link waits for the competition to load', async ({ page, request }) => {
  const { competitionId } = await seedCompetition(request, { controls: 3 });
  await page.route('**/api/sessions/active-competition', async (r) => {
    await new Promise((res) => setTimeout(res, 1000));
    await r.fulfill({ json: { competition_id: competitionId } });
  });
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto('/installningar#hjalpkoder');
  const heading = page.locator('#hjalpkoder h3');
  await expect(heading).toBeFocused({ timeout: 10_000 });
  await expect(heading).toBeInViewport();
});

test('Utseende toggles bright-sun and it survives a reload', async ({ page }) => {
  await page.goto('/installningar');
  const toggle = page.locator('#utseende').getByRole('checkbox');
  await toggle.check();
  await expect(page.locator('html')).toHaveClass(/contrast-high/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/contrast-high/);
  await page.locator('#utseende').getByRole('checkbox').uncheck();
  await expect(page.locator('html')).not.toHaveClass(/contrast-high/);
});

const KEY_LINK = '/installningar#eventor';

test('wizard: missing Eventor key links to the key field', async ({ page }) => {
  await page.route('**/api/eventor/events/**', (r) =>
    r.fulfill({ status: 400, json: { error: 'no_key' } })
  );
  await page.goto('/');
  await page.getByTestId('open-wizard').first().click();
  await page.getByTestId('wiz-evqs-input').fill('12345');
  await page.getByTestId('wiz-evqs-fetch').click();
  const err = page.getByTestId('wiz-evqs-error');
  await expect(err).toBeVisible();
  await expect(err.getByRole('link', { name: 'Lägg in Eventor-nyckeln' })).toHaveAttribute(
    'href',
    KEY_LINK
  );
});

test('import: missing Eventor key links to the key field', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.route('**/api/eventor/events?**', (r) =>
    r.fulfill({ status: 503, json: { error: 'no_key' } })
  );
  await page.goto(`/competition/${id}/import`);
  // The date fills in after the competition loads; a click before that
  // only shows a date error.
  await expect(page.getByTestId('import-date')).not.toHaveValue('');
  await page.getByTestId('import-search').click();
  const err = page.getByTestId('import-search-error');
  await expect(err).toBeVisible();
  await expect(err.getByRole('link', { name: 'Lägg in Eventor-nyckeln' })).toHaveAttribute(
    'href',
    KEY_LINK
  );
});

test('publish: missing Eventor key links to the key field', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.route('**/eventor/push-results', (r) =>
    r.fulfill({ status: 400, json: { error: 'no_key' } })
  );
  await page.goto(`/competition/${id}/eventor-publish`);
  await page.getByTestId('eventor-publish-results').getByRole('button').first().click();
  const err = page.getByTestId('eventor-results-err');
  await expect(err).toBeVisible();
  await expect(err.getByRole('link', { name: 'Lägg in Eventor-nyckeln' })).toHaveAttribute(
    'href',
    KEY_LINK
  );
});

test('Eventor section shows that the key is missing', async ({ page }) => {
  await page.route('**/api/eventor/status', (r) =>
    r.fulfill({
      json: { state: 'no_key', ageDays: null, competitorCount: 0, fartola_dev: false },
    })
  );
  await page.goto('/installningar');
  await expect(page.locator('#eventor').getByTestId('eventor-status-label')).toHaveText(
    'Eventor: nyckel saknas'
  );
});

test('Eventor section shows the cache age and a refresh button in dev', async ({ page }) => {
  await page.route('**/api/eventor/status', (r) =>
    r.fulfill({ json: { state: 'ready', ageDays: 3, competitorCount: 10, fartola_dev: true } })
  );
  await page.goto('/installningar');
  await expect(page.locator('#eventor').getByTestId('eventor-status-label')).toHaveText(
    'Eventor: cache OK (3 dagar gammal)'
  );
  await expect(page.getByTestId('eventor-refresh-btn')).toBeVisible();
});

test('saving the Eventor key updates the status line at once', async ({ page }) => {
  let saved = false;
  await page.route('**/api/eventor/status', (r) =>
    r.fulfill({
      json: saved
        ? { state: 'ready', ageDays: 0, competitorCount: 10, fartola_dev: false }
        : { state: 'no_key', ageDays: null, competitorCount: 0, fartola_dev: false },
    })
  );
  await page.route('**/api/settings/integrations', (r) => {
    if (r.request().method() === 'PUT') {
      saved = true;
      return r.fulfill({ json: { ok: true, key: 'EVENTOR_API_KEY', set: true, source: 'config' } });
    }
    return r.fulfill({
      json: {
        integrations: [{ key: 'EVENTOR_API_KEY', set: saved, source: saved ? 'config' : 'none' }],
      },
    });
  });
  await page.goto('/installningar#eventor');
  const label = page.locator('#eventor').getByTestId('eventor-status-label');
  await expect(label).toHaveText('Eventor: nyckel saknas');
  const row = page.locator('#eventor [data-integration-key="EVENTOR_API_KEY"]');
  await row.getByTestId('settings-row-input').fill('test-key-123');
  await row.getByTestId('settings-row-save').click();
  await expect(label).toHaveText('Eventor: cache OK (0 dagar gammal)');
});

// Switching competition through the sidebar picker (activeCompetition.set)
// while the settings page is open. The picker also navigates to the new
// competition's readout; that route is held back so the settings page stays
// mounted, as it does for the moment a slow load takes to land.
async function twoCompetitions(
  page: Page,
  request: APIRequestContext
): Promise<{ a: string; b: string; nameB: string }> {
  const { competitionId: a } = await seedCompetition(request, { controls: 3 });
  const { competitionId: b } = await seedCompetition(request, { controls: 3 });
  const listed = (await (await request.get(`${BASE}/api/competitions`)).json()) as {
    competitions: Array<{ id: string; name: string }>;
  };
  const nameB = listed.competitions.find((c) => c.id === b)?.name ?? '';
  await request.post(`${BASE}/api/sessions/active-competition`, { data: { competition_id: a } });
  await page.route('**/src/routes/competition/**', () => {
    /* never answered: the readout does not open */
  });
  return { a, b, nameB };
}

async function switchTo(page: Page, name: string): Promise<void> {
  await page.getByTestId('active-comp-pill').click();
  await page.getByTestId('active-comp-panel').getByRole('option', { name }).click();
  await expect(page.getByTestId('active-comp-pill')).toContainText(name);
}

test('a late Liveresultat and helper-code load for the old competition is ignored', async ({
  page,
  request,
}) => {
  const { a, b, nameB } = await twoCompetitions(page, request);
  let releaseA!: () => void;
  const gateA = new Promise<void>((r) => (releaseA = r));
  let liveDone!: () => void;
  let codesDone!: () => void;
  const liveSent = new Promise<void>((r) => (liveDone = r));
  const codesSent = new Promise<void>((r) => (codesDone = r));
  await page.route(`**/api/competitions/${a}/liveresultat/credentials`, async (r) => {
    await gateA;
    await r.fulfill({ json: { liveresultat_id: '111', has_password: true } });
    liveDone();
  });
  await page.route(`**/api/competitions/${a}/event-codes`, async (r) => {
    await gateA;
    await r.fulfill({
      json: {
        codes: [
          {
            id: 'a1',
            masked_code: 'aaa****11',
            expires_at_ms: Date.now() + 86_400_000,
            revoked_at_ms: null,
          },
        ],
      },
    });
    codesDone();
  });
  await page.route(`**/api/competitions/${b}/liveresultat/credentials`, (r) =>
    r.fulfill({ json: { liveresultat_id: '222', has_password: false } })
  );
  await page.route(`**/api/competitions/${b}/event-codes`, (r) =>
    r.fulfill({
      json: {
        codes: [
          {
            id: 'b1',
            masked_code: 'bbb****22',
            expires_at_ms: Date.now() + 86_400_000,
            revoked_at_ms: null,
          },
          {
            id: 'b2',
            masked_code: 'bbb****33',
            expires_at_ms: Date.now() + 86_400_000,
            revoked_at_ms: null,
          },
        ],
      },
    })
  );
  await page.goto('/installningar');
  await expect(page.getByTestId('settings-view')).toBeVisible({ timeout: 20_000 });
  await switchTo(page, nameB);
  const live = page.locator('#liveresultat');
  await expect(live.getByTestId('liveresultat-id')).toHaveValue('222');
  await expect(page.locator('#hjalpkoder').getByTestId('helper-code-row')).toHaveCount(2);

  releaseA();
  await Promise.all([liveSent, codesSent]);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  await expect(live.getByTestId('liveresultat-id')).toHaveValue('222');
  await expect(page.locator('#hjalpkoder').getByTestId('helper-code-row')).toHaveCount(2);
  await expect(page.locator('#hjalpkoder')).toContainText('bbb****22');
});

test('a Liveresultat draft typed in one competition is not saved into the next', async ({
  page,
  request,
}) => {
  const { a, b, nameB } = await twoCompetitions(page, request);
  const patches: Array<{ url: string; body: unknown }> = [];
  await page.route(`**/api/competitions/${a}/liveresultat/credentials`, (r) => {
    if (r.request().method() === 'PATCH') {
      patches.push({ url: r.request().url(), body: r.request().postDataJSON() });
      return r.fulfill({ json: { liveresultat_id: '555', has_password: true } });
    }
    return r.fulfill({ json: { liveresultat_id: null, has_password: false } });
  });
  // B's own load is held, so the form shows what the switch left in it.
  let releaseB!: () => void;
  const gateB = new Promise<void>((r) => (releaseB = r));
  await page.route(`**/api/competitions/${b}/liveresultat/credentials`, async (r) => {
    if (r.request().method() === 'PATCH') {
      patches.push({ url: r.request().url(), body: r.request().postDataJSON() });
      return r.fulfill({ json: { liveresultat_id: '555', has_password: true } });
    }
    await gateB;
    return r.fulfill({ json: { liveresultat_id: null, has_password: false } });
  });
  await page.goto('/installningar');
  const live = page.locator('#liveresultat');
  await expect(live.getByTestId('liveresultat-id')).toBeVisible({ timeout: 20_000 });
  await live.getByTestId('liveresultat-id').fill('111');
  await live.getByTestId('liveresultat-password').fill('gammalt');
  await live.getByTestId('liveresultat-save').click();
  await expect(live.getByTestId('liveresultat-result')).toBeVisible();
  await live.getByTestId('liveresultat-id').fill('999');
  await live.getByTestId('liveresultat-password').fill('halvskrivet');
  patches.length = 0;

  await switchTo(page, nameB);
  await expect(live.getByTestId('liveresultat-id')).toHaveValue('');
  await expect(live.getByTestId('liveresultat-password')).toHaveValue('');
  releaseB();
  await live.getByTestId('liveresultat-id').fill('222');
  await live.getByTestId('liveresultat-password').fill('nytt');
  await live.getByTestId('liveresultat-save').click();
  await expect(live.getByTestId('liveresultat-result')).toBeVisible();
  expect(patches).toHaveLength(1);
  expect(patches[0]?.url).toContain(`/api/competitions/${b}/liveresultat/credentials`);
  expect(patches[0]?.body).toEqual({ liveresultat_id: '222', liveresultat_pwd: 'nytt' });
});
