// tests/e2e/helpers/seed.ts
// Authored for fartola. Not ported from upstream.
//
// Seed a throwaway competition through the edge API (loopback = operator)
// and simulate card reads. Same calls as readout.spec.ts's setup().
// Synthetic data only: the IOF sample EntryList (Anna Andersson H21
// 7501853, Cia Carlsson D21 1428824) plus a generated course.

import { expect, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { longCourseXml } from './long-course.ts';

export const BASE = 'http://localhost:5174';
const ENTRYLIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../apps/edge/test/fixtures/iof30-entrylist-sample.xml'
);

async function importXml(
  request: APIRequestContext,
  id: string,
  name: string,
  buffer: Buffer
): Promise<void> {
  const res = await request.post(`${BASE}/api/competitions/${id}/import`, {
    multipart: { file: { name, mimeType: 'application/xml', buffer } },
  });
  expect(res.status(), `${name}: ${await res.text()}`).toBe(201);
}

export async function seedCompetition(
  request: APIRequestContext,
  opts: { controls: number }
): Promise<{ competitionId: string }> {
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Designlabb ${Date.now()}`, date: '2026-10-09' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await importXml(request, id, 'coursedata.xml', Buffer.from(longCourseXml(opts.controls)));
  await importXml(request, id, 'entrylist.xml', await readFile(ENTRYLIST));
  const active = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: id },
  });
  expect(active.status()).toBe(200);
  const start = await request.post(`${BASE}/api/competitions/${id}/start-race`);
  expect([200, 201]).toContain(start.status());
  return { competitionId: id };
}

const clock = (s: number) => ({ seconds_in_half_day: s, half_day: 0, weekday: null });

/** Punch `codes` in order, 2 min apart, starting 10:00:00 unless given. */
export async function simulateRead(
  request: APIRequestContext,
  competitionId: string,
  card: number,
  codes: number[],
  opts: { start?: number; finish?: number } = {}
): Promise<void> {
  const start = opts.start ?? 10 * 3600;
  const body: Record<string, unknown> = {
    competition_id: competitionId,
    card_number: card,
    card_type: 'SI10',
    punches: codes.map((c, i) => ({ control_code: c, time_ms: (start + 120 * (i + 1)) * 1000 })),
    start: clock(start),
    finish: clock(opts.finish ?? start + 120 * (codes.length + 1)),
  };
  const res = await request.post(`${BASE}/api/__dev/simulate-read`, { data: body });
  expect(res.status(), `simulate-read: ${await res.text()}`).toBe(201);
}

export async function voidControl(
  request: APIRequestContext,
  competitionId: string,
  code: number
): Promise<void> {
  const res = await request.post(
    `${BASE}/api/competitions/${competitionId}/voided-controls/${code}`
  );
  expect([200, 201, 204], await res.text()).toContain(res.status());
}
