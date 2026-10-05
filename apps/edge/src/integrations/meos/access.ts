// Authored for fartola. Not ported from upstream.
//
// Access to the MeOS integration — GET /mip (every entry) and POST /mop
// (adds runners). D-MOP-4 / D-MIP-1 ("no auth, closed club LAN") were
// revised on 2026-10-05: anyone on the LAN could read all entries and
// inject competitors. Now:
//
//   - password set:          MeOS's `pwd` must match (constant-time), from
//                            every machine → else 401.
//   - no password (default): only this machine (loopback, or this host's
//                            own interface addresses — the server.ts
//                            operator check) → else 403.
//   - no password + the operator's explicit "allow without password":
//                            open, as before (server.ts warns at startup).
//
// MeOS sends `pwd` as an HTTP header (onlineinput.cpp:529,
// onlineresults.cpp:511 — the `key` list is request headers); the query
// parameter is accepted for test harnesses. On a 401/403 MeOS shows its own
// "HTTP Error 401/403" text (download.cpp), so the body is for humans/curl.
//
// Runs as the routes' onRequest hook, before a /mop body is read.

import crypto from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { resolveMeosAccess } from '../../config/secrets.ts';

function sha256(s: string): Buffer {
  return crypto.createHash('sha256').update(s, 'utf8').digest();
}

function sentPassword(req: FastifyRequest): string | undefined {
  const query = (req.query as Record<string, unknown> | undefined)?.['pwd'];
  if (typeof query === 'string') return query;
  const header = req.headers['pwd'];
  return typeof header === 'string' ? header : undefined;
}

/** onRequest hook for /mip and /mop. */
export function meosAccessHook(
  app: FastifyInstance
): (req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  return async (req, reply) => {
    const { password, allowWithoutPassword } = resolveMeosAccess(app.fartolaDb);
    if (password !== undefined) {
      const sent = sentPassword(req);
      if (sent !== undefined && crypto.timingSafeEqual(sha256(sent), sha256(password))) {
        return undefined;
      }
      void reply.code(401).header('Content-Type', 'text/plain; charset=utf-8');
      return reply.send('MeOS-koppling: fel eller saknat lösenord (pwd).\n');
    }
    if (allowWithoutPassword || app.fartolaIsOperatorMachine(req.socket.remoteAddress)) {
      return undefined;
    }
    void reply.code(403).header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(
      'MeOS-koppling: inget lösenord satt. Ange ett lösenord i fartOLa ' +
        '(Inställningar → MeOS-koppling) och samma i MeOS, eller tillåt ' +
        'uttryckligen MeOS utan lösenord.\n'
    );
  };
}
