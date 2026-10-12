// Authored for fartola. Not ported from upstream.
//
// The world a walk runs in (scripts/walk.ts): one real server on an
// in-memory database, driven with app.inject(), with a fake SI station on the
// real bridge. Two synthetic competitions, built through the normal routes.
//
// Deterministic: the routes stamp Date.now() and draw ids and start orders
// from node:crypto, with no way to inject either, so both are replaced for
// the whole process while a world is open (installFakes). Two things stay on
// the real clock: timers (the projection's debounce is flushed after every
// step) and `new Date()` in the IOF export's createTime.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SiMainStation } from '@fartola/sportident';
import type { FastifyInstance } from 'fastify';

import { openDatabase, type DbHandle } from '../src/db/index.ts';
import { ensureNodeId } from '../src/db/node-id.ts';
import { loadCompetitionInputs } from '../src/projection/loader.ts';
import { reduce } from '../src/projection/reduce.ts';
import type { CompetitionState } from '../src/projection/types.ts';
import { buildServer } from '../src/server.ts';
import { attachBridge } from '../src/si/bridge.ts';

/** mulberry32: small seeded generator, enough for picking steps. */
export function rng(seed: number): { next: () => number; int: (n: number) => number } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n) };
}

/** The process-wide fakes. `ids` is a stream and a counter: the walk uses
 * stream 0 and every copy of the world its own, so an id made in a copy can
 * neither collide with nor shift the ids of the walk. */
export const fake = { now: 0, ints: rng(0), ids: { stream: 0, n: 0 } };
let streams = 0;

const real = { now: Date.now, randomUUID: crypto.randomUUID, randomInt: crypto.randomInt };
const hex = (n: number, len: number): string => n.toString(16).padStart(len, '0');

export function installFakes(): void {
  Date.now = () => fake.now;
  crypto.randomUUID = () =>
    `${hex(fake.ids.stream, 8)}-0000-4000-8000-${hex(++fake.ids.n, 12)}` as ReturnType<
      typeof real.randomUUID
    >;
  crypto.randomInt = ((a: number, b?: unknown) =>
    typeof b === 'number' ? a + fake.ints.int(b - a) : fake.ints.int(a)) as typeof real.randomInt;
  syncBuiltinESMExports();
}

export function removeFakes(): void {
  Date.now = real.now;
  crypto.randomUUID = real.randomUUID;
  crypto.randomInt = real.randomInt;
  syncBuiltinESMExports();
}

export interface Sent {
  method: string;
  url: string;
  body?: unknown;
  /** A file upload (multipart) or a raw XML body. */
  xml?: string;
  raw?: boolean;
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export interface World {
  seed: number;
  app: FastifyInstance;
  handle: DbHandle;
  nodeId: string;
  /** Fake SI station on the real bridge; null in a copy. */
  station: EventEmitter | null;
  /** Competition ids: [0] the main one, [1] a small second one. */
  comps: string[];
  /** What the operator has seen and may confirm later: the stale
   * confirmations of the walk. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notes: Record<string, any>;
  /** The requests of the current step. */
  trace: Sent[];
  /** Stale confirmations the server acted on in the current step. */
  stale: string[];
  /** Every read sent, and the competition it should be stored on. */
  reads: Array<{ card: number; competitionId: string | null }>;
  dir: string;
  file?: string;
}

/** One step of a walk: plain data (see walkOps.ts). */
export interface Step {
  op: string;
  k?: string;
  a: number;
  b: number;
  c: number;
  dt: number;
  rnd: number;
}

/** The way back from a step: undo it on a copy of the world. */
export type WayBack = (copy: World) => Promise<unknown>;

async function server(handle: DbHandle, nodeId: string): Promise<FastifyInstance> {
  process.env['FARTOLA_DEV'] = '1';
  return buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    projectionDebounceMs: 0,
    printerSink: { isPrinterConnected: async () => true, print: async () => {} },
  });
}

/** The competition card reads go to, as the bin's bridge reads it: from the
 * config row (app.activeCompetitionId lives on the sessions plugin's own
 * instance and is not visible from outside it). */
export function activeCompetition(w: Pick<World, 'handle'>): string | null {
  const row = w.handle.sqlite
    .prepare(`SELECT value FROM config WHERE key = 'active_competition_id'`)
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/** The projection computed anew from the database, past the server's cache. */
export function fresh(w: Pick<World, 'handle'>, competitionId: string): CompetitionState {
  return reduce(loadCompetitionInputs(w.handle, competitionId)!);
}

/** Let the debounced projection recompute (setTimeout 0) run. */
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export async function send(
  w: World,
  method: string,
  url: string,
  body?: unknown,
  file?: { xml: string; raw?: boolean }
): Promise<Sent> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let opts: any = { method, url };
  if (file?.raw) {
    opts = { ...opts, payload: file.xml, headers: { 'content-type': 'text/xml' } };
  } else if (file) {
    const form = new FormData();
    form.set('file', new File([file.xml], 'fil.xml', { type: 'application/xml' }));
    const req = new Request('http://x/', { method: 'POST', body: form });
    opts = {
      ...opts,
      payload: Buffer.from(await req.arrayBuffer()),
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
    };
  } else if (body !== undefined) {
    opts.payload = body;
  }
  const res = await w.app.inject(opts);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = res.body;
  }
  const sent: Sent = {
    method,
    url,
    ...(body !== undefined ? { body } : {}),
    ...(file ? { xml: file.xml, ...(file.raw ? { raw: true } : {}) } : {}),
    status: res.statusCode,
    json,
  };
  w.trace.push(sent);
  return sent;
}

/** Send a recorded request again, as it was. */
export const resend = (w: World, s: Sent): Promise<Sent> =>
  send(
    w,
    s.method,
    s.url,
    s.body,
    s.xml === undefined ? undefined : { xml: s.xml, ...(s.raw ? { raw: true } : {}) }
  );

// ---------------------------------------------------------------------------
// Synthetic competition data. Every name, club and card number is invented.
// ---------------------------------------------------------------------------

export const DAY = '2026-10-10';
/** 10:00 on the competition clock (UTC+2 on that date). */
export const FIRST_START_MS = Date.UTC(2026, 9, 10, 8, 0, 0);
/** The walk begins at 11:30 on the competition clock. */
const WALK_START_MS = Date.UTC(2026, 9, 10, 9, 30, 0);

const GIVEN = ['Alva', 'Bo', 'Cia', 'Dag', 'Ebba', 'Finn', 'Gun', 'Hugo', 'Ines', 'Jon', 'Kaj'];
const FAMILY = ['Almfors', 'Bergfalk', 'Cederhus', 'Dalmyr', 'Ekfors', 'Furudal', 'Granlid'];
const CLUBS = ['OK Granen', 'Tallens IF', 'Skogsmullarna OK'];
const CLASSES = ['H21', 'D21', 'U10', 'Öppen'];

export interface Entry {
  given: string;
  family: string;
  club: string;
  cls: string;
  card: number | null;
}

/** The entries of the main competition: 8 to 13 runners, the last one
 * without a card. */
export function entries(seed: number): Entry[] {
  const r = rng(seed);
  const n = 8 + r.int(6);
  return Array.from({ length: n }, (_, i) => ({
    given: GIVEN[i % GIVEN.length]!,
    family: FAMILY[(i + Math.floor(i / GIVEN.length)) % FAMILY.length]!,
    club: CLUBS[r.int(CLUBS.length)]!,
    cls: CLASSES[i % CLASSES.length]!,
    card: i === n - 1 ? null : 8100001 + i,
  }));
}

const XMLNS = 'xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"';
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const person = (e: Entry): string =>
  `<Person><Name><Family>${e.family}</Family><Given>${e.given}</Given></Name></Person>` +
  `<Organisation><Name>${e.club}</Name></Organisation>`;

/** Two courses, four classes. `changed` drops control 35 from the long
 * course: the same file after the course setter changed his mind. */
export function courseDataXml(changed = false): string {
  const long = changed ? [31, 32, 33, 34] : [31, 32, 33, 34, 35];
  const short = [41, 42, 43];
  const course = (name: string, codes: number[]): string =>
    `<Course><Name>${name}</Name><CourseControl type="Start"><Control>S1</Control></CourseControl>` +
    codes.map((c) => `<CourseControl><Control>${c}</Control></CourseControl>`).join('') +
    `<CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>`;
  const assign = (cls: string, name: string): string =>
    `<ClassCourseAssignment><ClassName>${cls}</ClassName><CourseName>${name}</CourseName></ClassCourseAssignment>`;
  return (
    `${HEAD}<CourseData ${XMLNS}><Event><Name>Höstträffen</Name>` +
    CLASSES.map((c) => `<Class><Name>${c}</Name></Class>`).join('') +
    `</Event><RaceCourseData>` +
    [31, 32, 33, 34, 35, 41, 42, 43].map((c) => `<Control><Id>${c}</Id></Control>`).join('') +
    course('Lång', long) +
    course('Kort', short) +
    assign('H21', 'Lång') +
    assign('D21', 'Lång') +
    assign('U10', 'Kort') +
    assign('Öppen', 'Kort') +
    `</RaceCourseData></CourseData>`
  );
}

/** `more` adds two late entries, one of them without a card. */
export function entryListXml(list: Entry[], more = false): string {
  const all = more
    ? [
        ...list,
        { given: 'Lo', family: 'Hedmyr', club: CLUBS[0]!, cls: 'H21', card: 8100090 },
        { given: 'My', family: 'Hedmyr', club: CLUBS[0]!, cls: 'D21', card: null },
      ]
    : list;
  return (
    `${HEAD}<EntryList ${XMLNS}><Event><Name>Höstträffen</Name></Event>` +
    all
      .map(
        (e) =>
          `<PersonEntry>${person(e)}` +
          (e.card === null ? '' : `<ControlCard punchingSystem="SI">${e.card}</ControlCard>`) +
          `<Class><Name>${e.cls}</Name></Class></PersonEntry>`
      )
      .join('') +
    `</EntryList>`
  );
}

/** Start times for H21 and D21, two minutes apart. `shiftMin` moves them
 * all; `newCards` gives every other runner a new card number, which the
 * import takes over for a runner it knows by name and club. */
export function startListXml(list: Entry[], shiftMin = 0, newCards = false): string {
  const cls = (name: string): string =>
    `<ClassStart><Class><Name>${name}</Name></Class>` +
    list
      .filter((e) => e.cls === name)
      .map((e, i) => {
        const at = new Date(FIRST_START_MS + (shiftMin + i * 2) * 60_000).toISOString();
        const card = e.card === null ? null : newCards && i % 2 === 0 ? e.card + 500 : e.card;
        return (
          `<PersonStart>${person(e)}<Start><BibNumber>${name === 'H21' ? 100 + i : 200 + i}</BibNumber>` +
          `<StartTime>${at}</StartTime>` +
          (card === null ? '' : `<ControlCard punchingSystem="SI">${card}</ControlCard>`) +
          `</Start></PersonStart>`
        );
      })
      .join('') +
    `</ClassStart>`;
  return (
    `${HEAD}<StartList ${XMLNS}><Event><Name>Höstträffen</Name><StartTime><Date>${DAY}</Date></StartTime></Event>` +
    cls('H21') +
    cls('D21') +
    `</StartList>`
  );
}

// ---------------------------------------------------------------------------

function must(s: Sent): Sent {
  if (s.status >= 300) {
    throw new Error(`setup: ${s.method} ${s.url}: ${s.status} ${JSON.stringify(s.json)}`);
  }
  return s;
}

/** A fresh server with the two competitions of `seed`, the main one active. */
export async function openWorld(seed: number): Promise<World> {
  installFakes();
  fake.now = WALK_START_MS - 3_600_000;
  fake.ints = rng(seed);
  fake.ids = { stream: 0, n: 0 };
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await server(handle, nodeId);
  const station = new EventEmitter();
  attachBridge(station as unknown as SiMainStation, {
    handle,
    nodeId,
    getActiveCompetitionId: () => activeCompetition({ handle }),
    broadcast: (channel, envelope) => app.wsBroadcast(channel, envelope as never),
    projectionStore: app.projectionStore,
  });
  const w: World = {
    seed,
    app,
    handle,
    nodeId,
    station,
    comps: [],
    notes: {},
    trace: [],
    stale: [],
    reads: [],
    dir: mkdtempSync(path.join(tmpdir(), 'fartola-walk-')),
  };

  const list = entries(seed);
  const a = must(await send(w, 'POST', '/api/competitions', { name: 'Höstträffen', date: DAY }))
    .json.id as string;
  const base = `/api/competitions/${a}`;
  must(await send(w, 'POST', `${base}/import`, undefined, { xml: courseDataXml() }));
  must(await send(w, 'POST', `${base}/import`, undefined, { xml: entryListXml(list) }));
  must(await send(w, 'POST', `${base}/import/startlist`, undefined, { xml: startListXml(list) }));
  const classes = must(await send(w, 'GET', `${base}/classes`)).json.classes as Array<{
    id: string;
    name: string;
  }>;
  const classId = (name: string): string => classes.find((c) => c.name === name)!.id;
  must(await send(w, 'PATCH', `${base}/classes/${classId('U10')}`, { no_timing: true }));
  must(
    await send(w, 'PATCH', `${base}/classes/${classId('Öppen')}`, { start_method: 'start_punch' })
  );

  // The second competition: an evening training, one of its runners with
  // the same card as a runner in the main one.
  const b = must(await send(w, 'POST', '/api/competitions', { name: 'Kvällsträning', date: DAY }))
    .json.id as string;
  const cls = must(
    await send(w, 'POST', `/api/competitions/${b}/classes`, { name: 'Öppen', class_kind: 'oppen' })
  ).json.id as string;
  must(
    await send(w, 'POST', `/api/competitions/${b}/courses`, {
      name: 'Kvällsbana',
      class_id: cls,
      controls: [51, 52, 53].map((control_code, order_idx) => ({ control_code, order_idx })),
    })
  );
  for (const [name, card] of [
    ['Nea Granlid', 8100001],
    ['Olle Dalmyr', 8100071],
  ] as const) {
    must(
      await send(w, 'POST', '/api/competitors', {
        competition_id: b,
        name,
        club: CLUBS[1],
        class_id: cls,
        card_number: card,
        consent: true,
      })
    );
  }
  w.comps = [a, b];
  must(await send(w, 'POST', '/api/sessions/active-competition', { competition_id: a }));
  // Open the result lists once, as an operator's browser has: from here on
  // the server holds a cached projection that must follow every write.
  for (const id of w.comps) must(await send(w, 'GET', `/api/competitions/${id}/results`));
  await flush();
  fake.now = WALK_START_MS;
  w.trace = [];
  return w;
}

/** A second server on a copy of the database: what a restart would load.
 * The copy is a file, so it goes through openDatabase like a real start. */
export async function copyWorld(w: World): Promise<World> {
  const stream = ++streams;
  const file = path.join(w.dir, `copy-${stream}.db`);
  writeFileSync(file, w.handle.sqlite.serialize());
  const handle = openDatabase(file);
  return {
    ...w,
    app: await server(handle, w.nodeId),
    handle,
    station: null,
    notes: structuredClone(w.notes),
    trace: [],
    stale: [],
    reads: [...w.reads],
    file,
  };
}

/** Run `fn` with the copy's own id stream and the step's random numbers. */
export async function inCopy<T>(rnd: number, fn: () => Promise<T>): Promise<T> {
  const saved = { ints: fake.ints, ids: fake.ids };
  fake.ints = rng(rnd);
  fake.ids = { stream: ++streams, n: 0 };
  try {
    return await fn();
  } finally {
    fake.ints = saved.ints;
    fake.ids = saved.ids;
  }
}

export async function closeWorld(w: World): Promise<void> {
  await w.app.close();
  w.handle.close();
  if (w.file !== undefined) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(w.file + suffix, { force: true });
  } else {
    rmSync(w.dir, { recursive: true, force: true });
    removeFakes();
  }
}
