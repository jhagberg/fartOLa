// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, resolvePrinterConfig } from './fartola.ts';

describe('resolvePrinterConfig', () => {
  test('defaults to the Star CUPS queue', () => {
    assert.deepEqual(resolvePrinterConfig({}), {
      kind: 'cups',
      queueName: 'TSP143--STR_T-001-',
    });
  });

  test('supports stdout sink for dev and CI', () => {
    assert.deepEqual(resolvePrinterConfig({ FARTOLA_PRINTER: 'stdout' }), { kind: 'stdout' });
  });

  test('supports direct raw sink for compatible ESC/POS devices', () => {
    assert.deepEqual(
      resolvePrinterConfig({ FARTOLA_PRINTER: 'direct', FARTOLA_PRINTER_TYPE: 'epson' }),
      { kind: 'direct', printerType: 'epson' }
    );
  });

  test('supports overriding the CUPS queue name', () => {
    assert.deepEqual(
      resolvePrinterConfig({ FARTOLA_PRINTER: 'cups', FARTOLA_CUPS_QUEUE: 'Star' }),
      {
        kind: 'cups',
        queueName: 'Star',
      }
    );
  });
});

describe('parseArgs', () => {
  // CI 2026-05-19 regression: `pnpm --filter X dev -- --port=3001` forwarded
  // the bare `--` separator into the script's argv on the runner's pnpm 9,
  // which made parseArgs throw "Unknown argument: --" before the bridge ever
  // bound a port → playwright webServer timed out.
  test('treats POSIX `--` end-of-options as a no-op', () => {
    const opts = parseArgs(['--', '--port=3001']);
    assert.equal(opts.port, 3001);
  });

  test('still rejects truly unknown flags', () => {
    assert.throws(() => parseArgs(['--bogus']), /Unknown argument: --bogus/);
  });

  // -----------------------------------------------------------------------
  // Plan 04 (D-02) — multi-serial --serial flag with path:position syntax
  // -----------------------------------------------------------------------

  test('--serial with position produces serialPaths entry with correct position', () => {
    const opts = parseArgs(['--serial', '/dev/ttyUSB0:left']);
    assert.equal(opts.serialPaths.length, 1);
    assert.equal(opts.serialPaths[0]!.path, '/dev/ttyUSB0');
    assert.equal(opts.serialPaths[0]!.position, 'left');
  });

  test('--serial without position produces position=null', () => {
    const opts = parseArgs(['--serial', '/dev/ttyUSB0']);
    assert.equal(opts.serialPaths.length, 1);
    assert.equal(opts.serialPaths[0]!.path, '/dev/ttyUSB0');
    assert.equal(opts.serialPaths[0]!.position, null);
  });

  test('multiple --serial flags produce multiple serialPaths entries', () => {
    const opts = parseArgs(['--serial', '/dev/ttyUSB0:left', '--serial', '/dev/ttyUSB1:right']);
    assert.equal(opts.serialPaths.length, 2);
    assert.equal(opts.serialPaths[0]!.path, '/dev/ttyUSB0');
    assert.equal(opts.serialPaths[0]!.position, 'left');
    assert.equal(opts.serialPaths[1]!.path, '/dev/ttyUSB1');
    assert.equal(opts.serialPaths[1]!.position, 'right');
  });

  test('--serial-path backward compat: maps to serialPaths with position=null', () => {
    const opts = parseArgs(['--serial-path', '/dev/ttyUSB0']);
    assert.equal(opts.serialPaths.length, 1);
    assert.equal(opts.serialPaths[0]!.path, '/dev/ttyUSB0');
    assert.equal(opts.serialPaths[0]!.position, null);
  });

  test('default serialPaths when no serial flag is given', () => {
    const opts = parseArgs([]);
    assert.equal(opts.serialPaths.length, 1);
    assert.equal(opts.serialPaths[0]!.path, '/dev/ttyUSB0');
    assert.equal(opts.serialPaths[0]!.position, null);
  });

  test('duplicate serial path exits with fatal error (T-02.1-08b)', () => {
    // parseArgs calls process.exit(1) on duplicate paths — mock it.
    const exitCalls: number[] = [];
    const stderrCalls: string[] = [];
    const origExit = process.exit.bind(process);
    const origWrite = process.stderr.write.bind(process.stderr);
    process.exit = ((code: number) => {
      exitCalls.push(code);
    }) as typeof process.exit;
    process.stderr.write = ((msg: string) => {
      stderrCalls.push(msg);
      return true;
    }) as typeof process.stderr.write;
    try {
      parseArgs(['--serial', '/dev/ttyUSB0:left', '--serial', '/dev/ttyUSB0:right']);
    } finally {
      process.exit = origExit;
      process.stderr.write = origWrite;
    }
    assert.ok(exitCalls.includes(1), 'process.exit(1) should have been called');
    assert.ok(
      stderrCalls.some((m) => m.includes('duplicate serial path')),
      `stderr should mention duplicate path, got: ${JSON.stringify(stderrCalls)}`
    );
  });
});
