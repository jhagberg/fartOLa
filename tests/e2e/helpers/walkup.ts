// tests/e2e/helpers/walkup.ts
// Authored for fartola. Not ported from upstream.
//
// States of the walk-up modal (Direktanmälan) that show its conditional
// parts. Each reloads the readout with ?walkup=<card>, so routes set
// here are in place before the modal mounts.
import { expect, type Page } from '@playwright/test';

const CARD = 7_500_123;

const candidate = (person_id: number, family_name: string, given_name: string) => ({
  person_id,
  family_name,
  given_name,
  club_id: null,
  club_name: 'Provklubben',
  birth_year: 1990,
});

/** An Eventor hit with another candidate for the same card. */
export async function mockAlternatives(page: Page): Promise<void> {
  await page.route(/\/api\/eventor\/lookup\?.*si_card/, (r) =>
    r.fulfill({
      json: {
        hit: true,
        ...candidate(1, 'Provsson', 'Pia'),
        alternatives: 1,
        allCandidates: [candidate(1, 'Provsson', 'Pia'), candidate(2, 'Provsson', 'Per')],
      },
    })
  );
}

/** Open the modal for CARD on the form step. */
export async function openWalkup(page: Page, id: string, card = CARD): Promise<void> {
  await page.goto(`/competition/${id}/readout?walkup=${card}`);
  await expect(page.getByTestId('walkup-modal')).toBeVisible();
  await page.getByTestId('walkup-not-entered').click();
  await expect(page.getByTestId('walkup-name')).toBeVisible();
}

async function fillValid(page: Page): Promise<void> {
  // The name search's own dropdown is another screen's element: a failed
  // search never opens it.
  await page.route(/\/api\/eventor\/lookup\?.*\bq=/, (r) =>
    r.fulfill({ status: 500, json: { error: 'down' } })
  );
  await page.getByTestId('walkup-name').fill('Provlöpare Två');
  await page.getByTestId('walkup-class').selectOption({ index: 1 });
  await page.getByTestId('walkup-consent').check();
}

/** Description, consent rows, info note, alternatives chip and picker, field error and discard question. */
export async function prepareWalkupAlternatives(page: Page, id: string): Promise<void> {
  await mockAlternatives(page);
  await openWalkup(page, id);
  await expect(page.getByTestId('walkup-name')).toHaveValue('Provsson, Pia');
  await expect(page.getByTestId('walkup-eventor-fill')).toBeVisible();
  await page.getByTestId('walkup-alternatives-chip').click();
  await expect(page.getByTestId('walkup-alternatives-picker')).toBeVisible();
  await expect(page.locator('.alt-name').first()).toBeVisible();
  await expect(page.locator('.alt-club').first()).toBeVisible();
  // No class yet: the error. Then a ticked box makes the form dirty, so a
  // tap on the scrim asks before it discards.
  await page.getByTestId('walkup-save').click();
  await expect(page.getByTestId('walkup-error')).toBeVisible();
  await page.getByTestId('walkup-consent').check();
  await page.getByTestId('walkup-overlay').click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId('walkup-discard-confirm')).toBeVisible();
}

/** The card is already used: the banner. */
export async function prepareWalkupCardTaken(page: Page, id: string): Promise<void> {
  await page.route('**/api/competitors', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({
          status: 409,
          json: { error: 'card_taken', existing_competitor_id: crypto.randomUUID() },
        })
      : r.continue()
  );
  await openWalkup(page, id);
  await fillValid(page);
  await page.getByTestId('walkup-save').click();
  await expect(page.getByTestId('walkup-card-taken')).toBeVisible();
}

/** The save never reached the server: the network banner. */
export async function prepareWalkupNetworkError(page: Page, id: string): Promise<void> {
  await page.route('**/api/competitors', (r) =>
    r.request().method() === 'POST' ? r.abort() : r.continue()
  );
  await openWalkup(page, id);
  await fillValid(page);
  await page.getByTestId('walkup-save').click();
  await expect(page.getByTestId('walkup-network-error')).toBeVisible();
}
