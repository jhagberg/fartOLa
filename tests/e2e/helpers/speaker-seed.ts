// tests/e2e/helpers/speaker-seed.ts
// Authored for fartola. Not ported from upstream.
//
// Synthetic competition for the speaker view: six classes, each with a
// course through radio controls 50 and 60, long made-up names and club
// names (the truncation check), start times on the competition clock, radio
// punches and a few read-outs. Plain fetch so a script can seed a local
// server too. No real data.

export const SPEAKER_CLASSES = ['H21', 'D21', 'H35', 'D35', 'H50 Kort', 'D16'];
const CLASSES = SPEAKER_CLASSES;
const PER_CLASS = 6;
const GIVEN = ['Anna-Karin', 'Bo', 'Christoffer', 'Dagmar', 'Eskil', 'Fredrika'];
const FAMILY = ['Andersson-Wikström', 'Berg', 'Carlsson Lindqvist', 'Dahl', 'Eriksson', 'Fors'];
const CLUBS = ['Stora Tuna Orienteringsklubb', 'OK Test', 'Skogsluffarnas Idrottsförening'];

export const SPEAKER_RADIO = [50, 60];

const card = (ci: number, ri: number): number => 8_100_000 + ci * 100 + ri;
const xmlEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function courseXml(): string {
  const codes = [31, 50, 32, 60, 33];
  const ctrl = (c: number) => `<Control><Id>${c}</Id></Control>`;
  const cc = (c: number | string, type?: string) =>
    `<CourseControl${type ? ` type="${type}"` : ''}><Control>${c}</Control></CourseControl>`;
  const courses = CLASSES.map(
    (_, i) =>
      `<Course><Name>Bana ${i + 1}</Name><Length>${4000 + i * 300}</Length>` +
      `${cc('S1', 'Start')}${codes.map((c) => cc(c)).join('')}${cc('F1', 'Finish')}</Course>`
  ).join('');
  const assign = CLASSES.map(
    (n, i) =>
      `<ClassCourseAssignment><ClassName>${n}</ClassName><CourseName>Bana ${i + 1}</CourseName></ClassCourseAssignment>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"
  createTime="2026-10-04T08:00:00Z" creator="fartola-test">
  <Event><Name>Speaker</Name>${CLASSES.map((n) => `<Class><Name>${n}</Name></Class>`).join('')}</Event>
  <RaceCourseData>${codes.map(ctrl).join('')}${courses}${assign}</RaceCourseData>
</CourseData>`;
}

function entryXml(): string {
  const entries = CLASSES.flatMap((cls, ci) =>
    Array.from({ length: PER_CLASS }, (_, ri) => {
      const given = GIVEN[(ri + ci) % GIVEN.length]!;
      const family = FAMILY[ri % FAMILY.length]!;
      return `<PersonEntry><Person><Name><Family>${xmlEsc(family)}</Family><Given>${xmlEsc(given)}</Given></Name></Person>
<Organisation><Name>${xmlEsc(CLUBS[(ri + ci) % CLUBS.length]!)}</Name></Organisation>
<ControlCard punchingSystem="SI">${card(ci, ri)}</ControlCard><Class><Name>${xmlEsc(cls)}</Name></Class></PersonEntry>`;
    })
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"
  createTime="2026-10-04T08:00:00Z" creator="fartola-test"><Event><Name>Speaker</Name></Event>${entries}</EntryList>`;
}

async function call(base: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const upload = (name: string, xml: string): RequestInit => {
  const form = new FormData();
  form.append('file', new Blob([xml], { type: 'application/xml' }), name);
  return { method: 'POST', body: form };
};

/**
 * Seeds a competition whose runners started `startedMinAgo` minutes ago,
 * one a minute per class. In every class runner 0 has finished, runners 1–2
 * are past both radio controls, runner 3 past the first, runner 4 is MP
 * and runner 5 starts in the future. Card
 * numbers: 8_100_000 + class index * 100 + runner index.
 */
export async function seedSpeaker(
  base: string,
  nowMs = Date.now(),
  startedMinAgo = 40
): Promise<{ competitionId: string; card: typeof card; firstStartMs: number }> {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const { id } = (await call(
    base,
    '/api/competitions',
    json('POST', { name: `Speaker ${nowMs}`, date })
  )) as { id: string };
  await call(base, `/api/competitions/${id}/import`, upload('coursedata.xml', courseXml()));
  await call(base, `/api/competitions/${id}/import`, upload('entrylist.xml', entryXml()));
  await call(
    base,
    `/api/competitions/${id}/radio/settings`,
    json('PATCH', { radio_controls: SPEAKER_RADIO })
  );

  // Reads before the race has started are identity scans, not results.
  await call(base, `/api/competitions/${id}/start-race`, { method: 'POST' });
  const { competition } = (await call(base, `/api/competitions/${id}`)) as {
    competition: { clock_offset_min: number };
  };
  const offsetMin = competition.clock_offset_min;
  const first = Math.floor((nowMs - startedMinAgo * 60_000) / 60_000) * 60_000;
  const { competitors: list } = (await call(base, `/api/competitions/${id}/competitors`)) as {
    competitors: Array<{ id: string; card_number: number | null }>;
  };
  const byCard = new Map(list.map((c) => [c.card_number, c.id]));
  for (let ci = 0; ci < CLASSES.length; ci++) {
    for (let ri = 0; ri < PER_CLASS; ri++) {
      const startMs = ri === 5 ? nowMs + 30 * 60_000 : first + ri * 60_000;
      await call(
        base,
        `/api/competitions/${id}/competitors/${byCard.get(card(ci, ri))}/start-time`,
        json('PATCH', { start_time_ms: startMs })
      );
      // Runners 0–3 pass 50, runners 0–2 pass 60; a little apart so places differ.
      const passes = ri <= 2 ? SPEAKER_RADIO : ri === 3 ? [50] : [];
      for (const [k, code] of passes.entries()) {
        await call(
          base,
          '/api/__dev/simulate-radio',
          json('POST', {
            competition_id: id,
            card_number: card(ci, ri),
            control_code: code,
            time_ms: startMs + (10 + k * 10 + ci + ri * 1.5) * 60_000,
          })
        );
      }
      // Runner 0 has finished and is read out; runner 4 read out with 50
      // and 60 missing (MP).
      if (ri === 0 || ri === 4) {
        const at = (ms: number) => {
          const sec = Math.floor((ms / 1000 + offsetMin * 60) % 86_400);
          return {
            seconds_in_half_day: sec % 43_200,
            half_day: sec >= 43_200 ? 1 : 0,
            weekday: null,
          };
        };
        const finishMs = startMs + (30 + ci) * 60_000;
        const codes = ri === 0 ? [31, 50, 32, 60, 33] : [31, 32, 33];
        await call(
          base,
          '/api/__dev/simulate-read',
          json('POST', {
            competition_id: id,
            card_number: card(ci, ri),
            card_type: 'SI10',
            punches: codes.map((c, k) => ({
              control_code: c,
              time_ms: at(startMs + (k + 1) * 5 * 60_000).seconds_in_half_day * 1000,
            })),
            start: at(startMs),
            finish: at(finishMs),
          })
        );
      }
    }
  }
  return { competitionId: id, card, firstStartMs: first };
}
