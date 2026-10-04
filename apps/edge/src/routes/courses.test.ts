// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the courses REST CRUD. Covers:
//
//   - POST course with embedded controls (auto-created in the same tx);
//     GET returns the controls in order_idx ASC.
//   - POST course against a non-existent competition_id returns 404.
//   - GET listing returns courses ordered by name ASC; controls per course
//     ordered by order_idx ASC.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-04-PLAN.md task 1

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import type { FastifyInstance } from 'fastify';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });
  return { app, handle };
}

async function newCompetition(app: FastifyInstance, name = 'Comp'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/competitions',
    payload: { name, date: '2026-05-22' },
  });
  return (res.json() as { id: string }).id;
}

describe('courses REST CRUD', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await boot();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.handle.close();
  });

  test('test 1: POST course with controls; GET returns it with controls in order_idx ASC', async () => {
    const compId = await newCompetition(ctx.app);
    const postRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/courses`,
      payload: {
        name: 'Blå',
        controls: [
          { control_code: 31, order_idx: 0 },
          { control_code: 32, order_idx: 1 },
        ],
      },
    });
    assert.equal(postRes.statusCode, 201);
    const created = postRes.json() as {
      id: string;
      name: string;
      controls: { control_code: number; order_idx: number }[];
    };
    assert.equal(created.name, 'Blå');
    assert.equal(created.controls.length, 2);

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${compId}/courses`,
    });
    assert.equal(getRes.statusCode, 200);
    const list = (
      getRes.json() as {
        courses: { id: string; controls: { control_code: number; order_idx: number }[] }[];
      }
    ).courses;
    assert.equal(list.length, 1);
    const course = list[0];
    assert.ok(course);
    assert.equal(course.controls.length, 2);
    assert.equal(course.controls[0]?.control_code, 31);
    assert.equal(course.controls[0]?.order_idx, 0);
    assert.equal(course.controls[1]?.control_code, 32);
    assert.equal(course.controls[1]?.order_idx, 1);
  });

  test('test 2: POST course with non-existent competition_id returns 404', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/competitions/00000000-0000-0000-0000-000000000000/courses',
      payload: {
        name: 'Phantom',
        controls: [{ control_code: 31, order_idx: 0 }],
      },
    });
    assert.equal(res.statusCode, 404);
  });

  test('test 3: GET courses returns courses sorted by name ASC; controls per course sorted by order_idx', async () => {
    const compId = await newCompetition(ctx.app);
    // Insert in non-alpha order; expect GET to sort ASC.
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/courses`,
      payload: {
        name: 'Röd',
        controls: [
          { control_code: 50, order_idx: 1 },
          { control_code: 40, order_idx: 0 },
        ],
      },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/courses`,
      payload: {
        name: 'Blå',
        controls: [{ control_code: 31, order_idx: 0 }],
      },
    });

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${compId}/courses`,
    });
    const list = (
      getRes.json() as {
        courses: { name: string; controls: { control_code: number; order_idx: number }[] }[];
      }
    ).courses;
    assert.equal(list.length, 2);
    // Blå < Röd in JS string compare.
    assert.equal(list[0]?.name, 'Blå');
    assert.equal(list[1]?.name, 'Röd');
    // Röd's controls sorted by order_idx: 40 (order 0) before 50 (order 1).
    const röd = list[1];
    assert.ok(röd);
    assert.equal(röd.controls[0]?.control_code, 40);
    assert.equal(röd.controls[1]?.control_code, 50);
  });

  test('test 4: POST course with empty body returns 400', async () => {
    const compId = await newCompetition(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/courses`,
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });

  test('test 6 (WR-003): POST course with class_id from a DIFFERENT competition → 422', async () => {
    const compA = await newCompetition(ctx.app, 'A');
    const compB = await newCompetition(ctx.app, 'B');
    // Create a class under competition B.
    const classBRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compB}/classes`,
      payload: { name: 'H21' },
    });
    assert.equal(classBRes.statusCode, 201);
    const classB = (classBRes.json() as { id: string }).id;

    // Attempt to create a course under competition A referencing B's class.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compA}/courses`,
      payload: {
        name: 'Cross',
        class_id: classB,
        controls: [{ control_code: 31, order_idx: 0 }],
      },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as { errors: { path: string; code: string; message: string }[] };
    assert.ok(Array.isArray(body.errors));
    assert.equal(body.errors[0]?.path, 'class_id');
    assert.equal(body.errors[0]?.code, 'cross_competition');

    // GET competition A's courses should be empty — the cross-comp insert
    // must not have happened.
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${compA}/courses`,
    });
    const list = (listRes.json() as { courses: unknown[] }).courses;
    assert.equal(list.length, 0);
  });

  test('test 7 (02.1-14 Task 4): POST course with class_id points the class at the course', async () => {
    const compId = await newCompetition(ctx.app);
    const classRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/classes`,
      payload: { name: 'H21' },
    });
    const classId = (classRes.json() as { id: string }).id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/courses`,
      payload: {
        name: 'Bana 1',
        class_id: classId,
        controls: [{ control_code: 31, order_idx: 0 }],
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    const courseId = (res.json() as { id: string }).id;
    const row = ctx.handle.sqlite
      .prepare<[string], { course_id: string | null }>('SELECT course_id FROM classes WHERE id = ?')
      .get(classId);
    assert.equal(row?.course_id, courseId);
  });

  test('test 5: classes nested route — POST then GET roundtrip', async () => {
    const compId = await newCompetition(ctx.app);
    const postRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/classes`,
      payload: { name: 'H21', short_name: 'H21E' },
    });
    assert.equal(postRes.statusCode, 201);
    const created = postRes.json() as { id: string; name: string; short_name: string | null };
    assert.equal(created.name, 'H21');
    assert.equal(created.short_name, 'H21E');

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/competitions/${compId}/classes`,
    });
    const list = (listRes.json() as { classes: { id: string }[] }).classes;
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, created.id);
  });
});
