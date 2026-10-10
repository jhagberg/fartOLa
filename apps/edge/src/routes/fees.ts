// Authored for fartola. Not ported from upstream.
//
// Class fees and the card rental fee (SOFT TR 4.12.4, TR 4.12.6). fartOLa
// charges them only to runners it registers itself (walk-up and late
// entries) and to card rentals; pre-entries pay what Eventor decided.
//
// Routes:
//   GET  /api/competitions/:id/fees              — card fee + every class's fees
//   PUT  /api/competitions/:id/fees              — set them (all or nothing)
//   POST /api/competitions/:id/fees/from-eventor — copy the linked event's
//        class fees from Eventor (eventor/entryFees.ts), matched by name

import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { classes, competitions } from '../db/schema.ts';
import { resolveSecret } from '../config/secrets.ts';
import { fetchEventorClassFees } from '../eventor/entryFees.ts';
import { issuesToErrors } from './_zod-errors.ts';

const Kronor = z.number().int().nonnegative().nullable();

const FeesInput = z
  .object({
    card_fee: Kronor.optional(),
    classes: z
      .array(
        z
          .object({
            class_id: z.string().min(1),
            entry_fee: Kronor,
            youth_entry_fee: Kronor,
            late_fee_pct: z.number().int().min(0).max(100).nullable(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

export default async function registerFees(app: FastifyInstance): Promise<void> {
  const competition = (id: string) =>
    app.fartolaDb.db
      .select({ cardFee: competitions.cardFee, eventorEventId: competitions.eventorEventId })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();

  app.get<{ Params: { id: string } }>('/api/competitions/:id/fees', async (req, reply) => {
    const comp = competition(req.params.id);
    if (!comp) return reply.code(404).send({ error: 'competition not found' });
    const rows = app.fartolaDb.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, req.params.id))
      .orderBy(asc(classes.name))
      .all();
    return {
      card_fee: comp.cardFee,
      classes: rows.map((r) => ({
        class_id: r.id,
        name: r.name,
        class_kind: r.classKind,
        entry_fee: r.entryFee,
        youth_entry_fee: r.youthEntryFee,
        late_fee_pct: r.lateFeePct,
      })),
    };
  });

  app.put<{ Params: { id: string } }>('/api/competitions/:id/fees', async (req, reply) => {
    const parsed = FeesInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
    if (!competition(req.params.id))
      return reply.code(404).send({ error: 'competition not found' });
    const items = parsed.data.classes ?? [];
    const ids = items.map((i) => i.class_id);
    const known = new Set(
      ids.length === 0
        ? []
        : app.fartolaDb.db
            .select({ id: classes.id })
            .from(classes)
            .where(and(eq(classes.competitionId, req.params.id), inArray(classes.id, ids)))
            .all()
            .map((r) => r.id)
    );
    const unknown = ids.find((id) => !known.has(id));
    if (unknown !== undefined)
      return reply.code(400).send({ error: 'class_not_in_competition', class_id: unknown });
    app.fartolaDb.sqlite.transaction(() => {
      if (parsed.data.card_fee !== undefined)
        app.fartolaDb.db
          .update(competitions)
          .set({ cardFee: parsed.data.card_fee })
          .where(eq(competitions.id, req.params.id))
          .run();
      for (const i of items)
        app.fartolaDb.db
          .update(classes)
          .set({
            entryFee: i.entry_fee,
            youthEntryFee: i.youth_entry_fee,
            lateFeePct: i.late_fee_pct,
          })
          .where(eq(classes.id, i.class_id))
          .run();
    })();
    return { updated: items.length };
  });

  app.post<{ Params: { id: string } }>(
    '/api/competitions/:id/fees/from-eventor',
    async (req, reply) => {
      const comp = competition(req.params.id);
      if (!comp) return reply.code(404).send({ error: 'competition not found' });
      if (comp.eventorEventId === null)
        return reply.code(409).send({ error: 'eventor_unavailable', eventor: 'not_linked' });
      const apiKey = resolveSecret(app.fartolaDb, 'EVENTOR_API_KEY');
      if (!apiKey) return reply.code(409).send({ error: 'eventor_unavailable', eventor: 'no_key' });
      let fees;
      try {
        fees = await fetchEventorClassFees({ apiKey, eventId: comp.eventorEventId });
      } catch (e) {
        app.log.warn({ err: (e as Error).message }, 'eventor entry fees fetch failed');
        return reply.code(409).send({ error: 'eventor_unavailable', eventor: 'failed' });
      }
      const rows = app.fartolaDb.db
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(eq(classes.competitionId, req.params.id))
        .all();
      let updated = 0;
      app.fartolaDb.sqlite.transaction(() => {
        for (const r of rows) {
          const f = fees.get(r.name);
          if (f === undefined) continue;
          app.fartolaDb.db
            .update(classes)
            .set({
              entryFee: f.entryFee,
              youthEntryFee: f.youthEntryFee,
              lateFeePct: f.lateFeePct,
            })
            .where(eq(classes.id, r.id))
            .run();
          updated++;
        }
      })();
      return { updated };
    }
  );
}
