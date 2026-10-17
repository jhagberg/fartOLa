// tests/e2e/helpers/search-options.ts
// Authored for fartola. Not ported from upstream.
//
// Floor states for texts that no other state renders: the open option lists
// of the runner and club searches (add sheet) and the medium punch grid of a
// long course. Each asserts the element it covers is visible.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { openRunners, seedRunners } from './runners.ts';
import { longCourseCodes } from './long-course.ts';
import { seedCompetition, simulateRead } from './seed.ts';

async function openAddSheet(page: Page, request: APIRequestContext): Promise<void> {
  const { id } = await seedRunners(request);
  await openRunners(page, id);
  await page.getByTestId('runners-add-btn').click();
  await expect(page.getByTestId('add-runner-search')).toBeVisible();
}

/** The runner search with an open list: club line and card chip. */
export async function prepareRunnerSearchOptions(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await page.route(/\/api\/eventor\/lookup\?.*\bq=/, (r) =>
    r.fulfill({
      json: {
        suggestions: [
          {
            person_id: 1,
            family_name: 'Provsson',
            given_name: 'Pia',
            club_name: 'Provklubben',
            si_card: 7_500_123,
          },
        ],
      },
    })
  );
  await openAddSheet(page, request);
  await page.getByTestId('add-runner-search').fill('Prov');
  const opt = page.getByTestId('smart-search-opt').first();
  await expect(opt.locator('.opt-sub')).toBeVisible();
  await expect(opt.locator('.opt-card')).toBeVisible();
}

/** The club search with an open list: the short name line. */
export async function prepareClubSearchOptions(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await page.route(/\/api\/eventor\/clubs\?/, (r) =>
    r.fulfill({
      json: {
        suggestions: [{ club_id: 1, name: 'Provklubben', short_name: 'PK', media_name: null }],
      },
    })
  );
  await openAddSheet(page, request);
  await page.getByTestId('add-runner-club').fill('Prov');
  await expect(page.getByTestId('smart-club-opt').first().locator('.opt-sub')).toBeVisible();
}

/** The club search that finds nothing: its empty message. */
export async function prepareClubSearchEmpty(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await page.route(/\/api\/eventor\/clubs\?/, (r) => r.fulfill({ json: { suggestions: [] } }));
  await openAddSheet(page, request);
  await page.getByTestId('add-runner-club').fill('Zzzz');
  await expect(page.getByTestId('smart-club-popover').locator('.empty')).toBeVisible();
}

/** A 22-control course read with one control missing: the medium grid and its "Saknas" label. */
export async function prepareReadoutLongCourse(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const { competitionId: id } = await seedCompetition(request, { controls: 22 });
  await simulateRead(
    request,
    id,
    7_501_853,
    longCourseCodes(22).filter((c) => c !== 40)
  );
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('punch-grid')).toHaveAttribute('data-size', 'medium', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('punch-grid').locator('.label').first()).toBeVisible();
}
