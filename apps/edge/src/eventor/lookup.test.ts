// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the Eventor read-only lookup module
// (Plan 02-02 task 1). Validates four behaviors:
//
//   - lookupBySiCard returns a hit shape with the JOIN-resolved club_name
//     for the seeded SI card.
//   - lookupBySiCard returns the miss shape for an unseeded SI card.
//   - lookupByNamePrefix returns up to N suggestions ordered by family_name
//     prefix match, with club_name resolved via LEFT JOIN.
//   - lookupByNamePrefix returns [] for an empty prefix (caller is expected
//     to gate on minLength 2).
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-02-PLAN.md task 1
// - .planning/phases/02-4-klubbs-mvp/02-01-SUMMARY.md (re-uses the same
//   competitors-sample.xml fixture seeded via ingestEventorCache).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, type DbHandle } from '../db/index.ts';
import { eventorCompetitors } from '../db/schema.ts';
import { ingestEventorCache } from './cache.ts';
import {
  lookupBySiCard,
  lookupByNamePrefix,
  searchCompetitorsByName,
  searchClubsByName,
  type EventorLookupHit,
  type EventorLookupMany,
} from './lookup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_DIR = path.join(__dirname, '__fixtures__');
const COMPETITORS_XML = path.join(FIX_DIR, 'competitors-sample.xml');
const CLUBS_XML = path.join(FIX_DIR, 'clubs-sample.xml');

function withSeededDb(fn: (handle: DbHandle) => void | Promise<void>): Promise<void> {
  const handle = openDatabase(':memory:');
  return (async () => {
    await ingestEventorCache(handle, COMPETITORS_XML, CLUBS_XML, 1_700_000_000_000);
    try {
      await fn(handle);
    } finally {
      handle.close();
    }
  })();
}

describe('eventor lookup module', () => {
  test('lookupBySiCard returns hit shape with JOIN-resolved club_name', async () => {
    await withSeededDb((handle) => {
      const res = lookupBySiCard(handle, 8535005, null);
      assert.equal(res.hit, true);
      const hit = res as EventorLookupHit;
      assert.equal(hit.person_id, 1001);
      assert.equal(hit.family_name, 'Hagberg');
      assert.equal(hit.given_name, 'Jonas');
      assert.equal(hit.club_id, 637);
      assert.equal(hit.club_name, 'Stora Tuna OK');
    });
  });

  test('lookupBySiCard returns miss shape for unseeded card', async () => {
    await withSeededDb((handle) => {
      const res = lookupBySiCard(handle, 99999999, null);
      assert.equal(res.hit, false);
    });
  });

  test('lookupBySiCard returns hit with alternatives:1 when duplicate si_card resolved by recency', async () => {
    // Schema tolerates duplicate si_card values (family-shared, replacement,
    // rental pool — schema.ts §eventor_competitors). Plan 02.1-10 adds
    // context-aware disambiguation: recency rule picks the winner when no
    // competition context is supplied, and the WalkupModal shows +N andra chip.
    await withSeededDb((handle) => {
      // Anna gets an older modifyDateMs than Jonas (2024-12-12 fixture) so
      // Jonas wins the recency rule.
      handle.db
        .insert(eventorCompetitors)
        .values({
          personId: 9_999_999,
          familyName: 'Hagberg',
          givenName: 'Anna',
          clubId: 637,
          siCard: 8535005,
          emitCard: null,
          modifyDateMs: 1_700_000_000_000, // 2023-11-15 — older than Jonas
        })
        .run();

      const res = lookupBySiCard(handle, 8535005, null);
      // Jonas (2024-12-12) has a higher modifyDateMs → wins recency rule.
      assert.equal(res.hit, true);
      const hit = res as EventorLookupHit;
      assert.equal(hit.given_name, 'Jonas', 'Jonas wins recency over Anna');
      assert.equal(hit.alternatives, 1, 'one alternative exists (Anna)');
      assert.equal(hit.club_name, 'Stora Tuna OK');
    });
  });

  test("lookupBySiCard returns 'many' shape for exact recency-tie duplicates", async () => {
    // When two candidates share the same modifyDateMs (exact tie), the
    // recency rule cannot pick a winner → return 'many' to force operator pick.
    await withSeededDb((handle) => {
      // Jonas fixture has modifyDateMs from "2024-12-12T09:46:45Z" — use
      // the same value for Anna to create a tie.
      const jonasMsRow = handle.sqlite
        .prepare<
          [],
          { v: number }
        >(`SELECT modify_date_ms AS v FROM eventor_competitors WHERE person_id = 1001`)
        .get();
      const jonasMs = jonasMsRow?.v ?? 0;
      handle.db
        .insert(eventorCompetitors)
        .values({
          personId: 9_999_999,
          familyName: 'Hagberg',
          givenName: 'Anna',
          clubId: 637,
          siCard: 8535005,
          emitCard: null,
          modifyDateMs: jonasMs, // exact tie → 'many'
        })
        .run();

      const res = lookupBySiCard(handle, 8535005, null);
      assert.equal(res.hit, 'many');
      const many = res as EventorLookupMany;
      assert.equal(many.candidates.length, 2);
      // Family-name asc, given-name asc — deterministic ordering.
      assert.equal(many.candidates[0]!.given_name, 'Anna');
      assert.equal(many.candidates[1]!.given_name, 'Jonas');
      assert.equal(many.candidates[0]!.club_name, 'Stora Tuna OK');
      assert.equal(many.candidates[1]!.club_name, 'Stora Tuna OK');
    });
  });

  test('lookupByNamePrefix returns Östberg row with resolved club_name', async () => {
    await withSeededDb((handle) => {
      const rows = lookupByNamePrefix(handle, 'Östb', 20);
      const ostberg = rows.find((r) => r.family_name === 'Östberg');
      assert.ok(ostberg, 'expected Östberg row in suggestions');
      assert.equal(ostberg.given_name, 'Pär');
      assert.equal(ostberg.club_name, 'Stora Tuna OK');
      assert.equal(ostberg.si_card, null);
    });
  });

  test('lookupByNamePrefix returns [] for empty prefix', async () => {
    await withSeededDb((handle) => {
      const rows = lookupByNamePrefix(handle, '', 20);
      assert.deepEqual(rows, []);
    });
  });
});

describe('eventor lookup FTS5 — searchCompetitorsByName', () => {
  test('matches given name as a leading prefix (Jonas → Hagberg, Jonas)', async () => {
    await withSeededDb((handle) => {
      const rows = searchCompetitorsByName(handle, 'jonas', 20);
      const hit = rows.find((r) => r.family_name === 'Hagberg');
      assert.ok(hit, 'expected Hagberg row matching given_name prefix');
      assert.equal(hit.given_name, 'Jonas');
    });
  });

  test('matches across given AND family in either word order (jonas hag, hag jonas)', async () => {
    await withSeededDb((handle) => {
      const a = searchCompetitorsByName(handle, 'jonas hag', 20);
      const b = searchCompetitorsByName(handle, 'hag jonas', 20);
      assert.ok(a.find((r) => r.family_name === 'Hagberg' && r.given_name === 'Jonas'));
      assert.ok(b.find((r) => r.family_name === 'Hagberg' && r.given_name === 'Jonas'));
    });
  });

  test('folds diacritics (ostberg → Östberg, par → Pär)', async () => {
    await withSeededDb((handle) => {
      const a = searchCompetitorsByName(handle, 'ostberg', 20);
      assert.ok(a.find((r) => r.family_name === 'Östberg'));
      const b = searchCompetitorsByName(handle, 'par', 20);
      assert.ok(b.find((r) => r.given_name === 'Pär'));
    });
  });

  test('returns [] for whitespace-only / sanitised-empty query', async () => {
    await withSeededDb((handle) => {
      assert.deepEqual(searchCompetitorsByName(handle, '', 20), []);
      assert.deepEqual(searchCompetitorsByName(handle, '   ', 20), []);
      assert.deepEqual(searchCompetitorsByName(handle, '* ( )', 20), []);
    });
  });

  test('limit clamps the result count', async () => {
    await withSeededDb((handle) => {
      // All 3 fixture competitors share club_name 'Stora Tuna OK' — the
      // FTS5 club_name column matches every row for the 'stora' token.
      // limit=2 must clamp the 3-match set down to 2.
      const rows = searchCompetitorsByName(handle, 'stora', 2);
      assert.equal(rows.length, 2);
    });
  });

  test('club_id filter narrows the result set to that federation club', async () => {
    await withSeededDb((handle) => {
      // 'stora' matches both Hagberg (club 637) and Östberg (club 637)
      // via their club_name column. Larsson (no club) does not match.
      const all = searchCompetitorsByName(handle, 'stora', 20);
      assert.equal(all.length, 2);

      const inSTK = searchCompetitorsByName(handle, 'stora', 20, 637);
      assert.equal(inSTK.length, 2);
      assert.ok(inSTK.every((r) => r.club_name === 'Stora Tuna OK'));

      const inOther = searchCompetitorsByName(handle, 'stora', 20, 999_999);
      assert.equal(inOther.length, 0);
    });
  });

  test('splits on commas/semicolons so "Hagberg, Jonas" matches the same row as "Hagberg Jonas"', async () => {
    await withSeededDb((handle) => {
      const a = searchCompetitorsByName(handle, 'Hagberg, Jonas', 20);
      const b = searchCompetitorsByName(handle, 'Hagberg Jonas', 20);
      assert.deepEqual(
        a.map((r) => r.person_id),
        b.map((r) => r.person_id)
      );
      assert.ok(a.find((r) => r.family_name === 'Hagberg' && r.given_name === 'Jonas'));
    });
  });
});

describe('eventor lookup FTS5 — searchClubsByName', () => {
  test('matches by short_name (STK → Stora Tuna OK)', async () => {
    await withSeededDb((handle) => {
      const rows = searchClubsByName(handle, 'stk', 10);
      assert.ok(rows.find((r) => r.name === 'Stora Tuna OK'));
    });
  });

  test('matches by full name token (tuna → Stora Tuna OK)', async () => {
    await withSeededDb((handle) => {
      const rows = searchClubsByName(handle, 'tuna', 10);
      assert.ok(rows.find((r) => r.name === 'Stora Tuna OK'));
    });
  });

  test('matches across both word splits (stora tuna AND tuna stora)', async () => {
    await withSeededDb((handle) => {
      const a = searchClubsByName(handle, 'stora tuna', 10);
      const b = searchClubsByName(handle, 'tuna stora', 10);
      assert.ok(a.find((r) => r.name === 'Stora Tuna OK'));
      assert.ok(b.find((r) => r.name === 'Stora Tuna OK'));
    });
  });

  test('returns [] for empty / sanitised-empty query', async () => {
    await withSeededDb((handle) => {
      assert.deepEqual(searchClubsByName(handle, '', 10), []);
      assert.deepEqual(searchClubsByName(handle, '   ', 10), []);
    });
  });
});
