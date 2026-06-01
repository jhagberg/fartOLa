#!/usr/bin/env -S node --import tsx
// Authored for fartola. Not ported from upstream.
//
// Standalone hardware probe for the coupled BSF8 check-unit backup read.
// Opens the serial port DIRECTLY and hex-dumps every byte sent (TX) and
// received (RX) so we can see the exact wire conversation with the coupled
// station — none of the HTTP / pino / web layers in the way.
//
// Usage (from packages/sportident/):
//   node --import tsx scripts/probe-coupled-backup.ts [--serial /dev/ttyUSB0] [--raw|--info|--direct]
//
//   --serial <path>   serial device (default /dev/ttyUSB0)
//   --info            identify the coupled station: read its config block and
//                     print code number, MODE (Start/Finish/Control/Check/...),
//                     and serial number. Use this to confirm WHICH unit you
//                     placed (Start vs Mål vs control 136/110).
//   --raw             skip the high-level readCoupledBackupMemory(); instead
//                     send SET_MS(0x53) → GET_SYS_VAL → (GET_BACKUP) → SET_MS(0x4D)
//                     ONE AT A TIME with a long timeout, dumping every reply byte
//                     INCLUDING bare NAK/ACK that the multiplexer normally drops.
//                     This is the diagnostic mode — use it first.
//   --direct          run readBackupMemory() (direct, no coupling) for comparison.
//   --timeout <ms>    per-command timeout in raw/info mode (default 3000).
//
// Reminder: SI stations sleep. If you get all-NAK, dip a card into the station
// to wake it, then run again immediately.
//
// Nothing here writes to the DB or competition — it's read-only against the
// station. Ctrl-C to abort; the port is closed on exit.

import { SerialTransport } from '../src/transport/SerialTransport.ts';
import { SiMainStation } from '../src/SiStation/SiMainStation.ts';
import { readCoupledBackupMemory, readBackupMemory } from '../src/SiStation/readBackup.ts';
import { proto, render } from '../src/index.ts';
import type { SiMessage } from '../src/siProtocol.ts';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(name);
}
function opt(name: string, def: string): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : def;
}

const serialPath = opt('--serial', '/dev/ttyUSB0');
const rawMode = flag('--raw');
const directMode = flag('--direct');
const infoMode = flag('--info');
const rawTimeoutMs = Number(opt('--timeout', '3000'));

/** Station mode byte (config offset 0x71) → human name. From BaseSiStation
 * StationMode + common SI mode codes. Unknown values shown as hex. */
function modeName(modeByte: number): string {
  const names: { [k: number]: string } = {
    0x02: 'Control',
    0x03: 'Start',
    0x04: 'Finish (Mål)',
    0x05: 'Readout',
    0x06: 'Clear',
    0x07: 'Check',
    0x12: 'Workstation',
  };
  return names[modeByte] ?? `unknown (0x${hex(modeByte)})`;
}

const hex = (b: number): string => b.toString(16).padStart(2, '0');
const dump = (bytes: number[]): string => bytes.map(hex).join(' ');

function now(): string {
  // No Date.now() banned here — this is a plain script, not a workflow.
  const d = new Date();
  return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// byte-logging transport wrapper
// ---------------------------------------------------------------------------

/** Wraps a real SerialTransport, mirroring the ISerialTransport surface but
 * logging every TX (send) and RX (data) as hex. */
class LoggingTransport {
  constructor(private inner: SerialTransport) {
    this.inner.on('data', (bytes: number[]) => {
      console.log(`${now()}  RX <- ${dump(bytes)}`);
    });
    this.inner.on('error', (err: Error) => {
      console.log(`${now()}  ERR   ${err.message}`);
    });
    this.inner.on('close', () => {
      console.log(`${now()}  -- port closed --`);
    });
  }
  open(): Promise<void> {
    return this.inner.open();
  }
  send(bytes: number[]): Promise<void> {
    console.log(`${now()}  TX -> ${dump(bytes)}`);
    return this.inner.send(bytes);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
  on(event: 'data' | 'error' | 'close', listener: (...a: never[]) => void): this {
    // Re-expose for SiMainStation which subscribes to 'data'/'close'.
    this.inner.on(event as 'data', listener as (b: number[]) => void);
    return this;
  }
  off(event: 'data' | 'error' | 'close', listener: (...a: never[]) => void): this {
    this.inner.off(event as 'data', listener as (b: number[]) => void);
    return this;
  }
}

// ---------------------------------------------------------------------------
// raw probe — send each command alone, dump everything
// ---------------------------------------------------------------------------

/** Send one rendered command with WAKEUP prefix, then wait `waitMs` collecting
 * ALL bytes that arrive (so we see NAK / ACK / partial frames the higher layer
 * would hide). Resolves with the collected bytes. */
async function rawSend(
  transport: LoggingTransport,
  label: string,
  message: SiMessage,
  waitMs: number
): Promise<number[]> {
  console.log(`\n=== ${label} ===`);
  const wire = [proto.WAKEUP, ...render(message)];
  const collected: number[] = [];
  const onData = (bytes: number[]): void => {
    for (const b of bytes) collected.push(b);
  };
  transport.on('data', onData);
  await transport.send(wire);
  await new Promise((r) => setTimeout(r, waitMs));
  transport.off('data', onData); // avoid the MaxListeners leak across many sends
  if (collected.length === 0) {
    console.log(`${now()}  (no reply in ${waitMs}ms)`);
  }
  return collected;
}

/** rawSend with §2.5 retry: re-issue until the reply is a real frame (echoes
 * `expectCmd`) rather than a bare NAK (0x15). Returns the last reply. */
async function rawSendRetry(
  transport: LoggingTransport,
  label: string,
  message: { command: number; parameters: number[] },
  expectCmd: number,
  attempts = 6
): Promise<number[]> {
  let reply: number[] = [];
  for (let i = 1; i <= attempts; i++) {
    reply = await rawSend(transport, `${label} (attempt ${i}/${attempts})`, message, rawTimeoutMs);
    if (reply.includes(expectCmd) && reply.length > 4) {
      console.log(`${now()}  >> answered on attempt ${i}`);
      return reply;
    }
    // bare NAK / no reply → wait a growing delay and retry (§2.5).
    await new Promise((r) => setTimeout(r, 30 * i));
  }
  console.log(
    `${now()}  >> gave up after ${attempts} attempts (last: ${dump(reply) || 'nothing'})`
  );
  return reply;
}

/** Pull the STX..ETX frame's PARAM bytes out of a raw reply.
 * Frame layout (extended): 02 CMD LEN <LEN bytes> CRC1 CRC0 03.
 * Returns just the <LEN bytes> payload (which for GET_SYS_VAL starts with
 * CN1 CN0 then the requested data). Returns [] if no clean frame. */
function extractParams(raw: number[], cmd: number): number[] {
  const stx = raw.indexOf(proto.STX);
  if (stx < 0 || raw[stx + 1] !== cmd) return [];
  const len = raw[stx + 2];
  if (len === undefined) return [];
  const start = stx + 3;
  return raw.slice(start, start + len);
}

async function runRaw(transport: LoggingTransport): Promise<void> {
  console.log(`\n### RAW coupling probe — spec-correct backup read (pcprog §3.1) ###`);
  console.log(`### Watch for: bare 0x15 (NAK) = coupling not synced yet;`);
  console.log(`###            a full 02 83 .. 03 frame = the coupled station answered. ###`);

  // 1. Switch master to transparent/slave mode (forward to coupled station).
  await rawSendRetry(
    transport,
    'SET_MS 0x53 (transparent/slave — forward to coupled station)',
    { command: proto.cmd.SET_MS, parameters: [proto.P_MS_REMOTE] },
    proto.cmd.SET_MS
  );

  // 2. Read the BACKUP MEMORY POINTER — spec §3.1: GET_SYS_VAL address 0x1C,
  //    length 0x07. (The OLD code wrongly sent [00,00,80] which the firmware
  //    read as numBytes=0 → empty reply. THIS is the fix under test.)
  const ptrReply = await rawSendRetry(
    transport,
    'GET_SYS_VAL backup pointer [addr=0x1C, len=0x07]',
    { command: proto.cmd.GET_SYS_VAL, parameters: [0x1c, 0x07] },
    proto.cmd.GET_SYS_VAL
  );
  // Decode: params = [CN1, CN0, 0x1C(echo addr), EP3, EP2, xx, xx, xx, EP1, EP0]?
  // Spec wording: "the 4 byte backup memory address pointer is part of the data
  // string: EP3, EP2, xx, xx, xx, EP1, EP0". Dump the payload so we can map it
  // exactly against the spec rather than guessing the offsets.
  const ptrParams = extractParams(ptrReply, proto.cmd.GET_SYS_VAL);
  console.log(`\n   pointer-frame payload bytes: [${ptrParams.map(hex).join(' ')}]`);
  console.log(`   (spec §3.1: after CN1 CN0, the 7 data bytes are EP3 EP2 xx xx xx EP1 EP0)`);
  if (ptrParams.length >= 9) {
    // payload = CN1 CN0 ADDR(0x1C) D0 D1 D2 D3 D4 D5 D6  → the 7 data bytes are payload[3..9]
    const d = ptrParams.slice(3);
    const ep3 = d[0] ?? 0,
      ep2 = d[1] ?? 0,
      ep1 = d[5] ?? 0,
      ep0 = d[6] ?? 0;
    const pointer = ((ep3 << 24) | (ep2 << 16) | (ep1 << 8) | ep0) >>> 0;
    console.log(`   decoded data bytes: [${d.map(hex).join(' ')}]`);
    console.log(`   => backup pointer ≈ 0x${pointer.toString(16)} (${pointer} bytes used)`);
  }

  // 3. Read the FIRST backup block — GET_BACKUP address 0x000100 (lowest backup
  //    address per spec table), length 0x80. Punch records are 8 bytes each.
  await rawSendRetry(
    transport,
    'GET_BACKUP first block [addr=0x000100, len=0x80]',
    { command: proto.cmd.GET_BACKUP, parameters: [0x00, 0x01, 0x00, 0x80] },
    proto.cmd.GET_BACKUP
  );

  // 4. Restore direct mode.
  await rawSendRetry(
    transport,
    'SET_MS 0x4D (restore direct/master)',
    { command: proto.cmd.SET_MS, parameters: [proto.P_MS_DIRECT] },
    proto.cmd.SET_MS
  );
  console.log(`\n### RAW probe done. ###`);
}

// ---------------------------------------------------------------------------
// info probe — identify a coupled station (code, mode, serial)
// ---------------------------------------------------------------------------

async function runInfo(transport: LoggingTransport): Promise<void> {
  console.log(`\n### INFO probe — read the coupled station's config block ###`);
  console.log(`### Tells you WHICH unit and WHAT mode (Start/Finish/Control/Check). ###`);

  await rawSendRetry(
    transport,
    'SET_MS 0x53 (transparent — forward to coupled station)',
    { command: proto.cmd.SET_MS, parameters: [proto.P_MS_REMOTE] },
    proto.cmd.SET_MS
  );

  // Read the full 128-byte config block: GET_SYS_VAL address 0x00, length 0x80.
  const reply = await rawSendRetry(
    transport,
    'GET_SYS_VAL config block [addr=0x00, len=0x80]',
    { command: proto.cmd.GET_SYS_VAL, parameters: [0x00, 0x80] },
    proto.cmd.GET_SYS_VAL
  );

  // Frame: 02 83 LEN CN1 CN0 ADDR <128 config bytes> CRC CRC 03.
  // The config blob starts after [STX cmd LEN CN1 CN0 ADDR] = skip 6 from STX.
  const stx = reply.indexOf(proto.STX);
  if (stx >= 0 && reply[stx + 1] === proto.cmd.GET_SYS_VAL) {
    const cn = (reply[stx + 3]! << 8) | reply[stx + 4]!;
    const cfg = reply.slice(stx + 6); // 128-byte config blob (+ crc/etx tail)
    // Verified offsets (BaseSiStation.STATION_CONFIG_OFFSETS):
    //   0x00..0x03 serial number (big-endian), 0x71 mode, 0x72 code-low.
    const serial =
      ((cfg[0] ?? 0) << 24) | ((cfg[1] ?? 0) << 16) | ((cfg[2] ?? 0) << 8) | (cfg[3] ?? 0);
    const mode = cfg[0x71] ?? 0;
    const codeLow = cfg[0x72] ?? 0;
    console.log(`\n=== STATION INFO ===`);
    console.log(`  code number  : ${cn}  (also config byte 0x72 = ${codeLow})`);
    console.log(`  mode         : ${modeName(mode)}  (byte 0x71 = 0x${hex(mode)})`);
    console.log(`  serial number: ${serial >>> 0}`);
    console.log(
      `\n  full config block (for mapping firmware/series later):\n  ${cfg
        .slice(0, 128)
        .map(hex)
        .join(' ')}`
    );
  } else {
    console.log(`\n  (no clean config frame — station may be asleep; dip a card and retry)`);
  }

  await rawSendRetry(
    transport,
    'SET_MS 0x4D (restore direct/master)',
    { command: proto.cmd.SET_MS, parameters: [proto.P_MS_DIRECT] },
    proto.cmd.SET_MS
  );
  console.log(`\n### INFO probe done. ###`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`fartola coupled-backup probe`);
  console.log(`  serial : ${serialPath}`);
  console.log(
    `  mode   : ${infoMode ? 'INFO (identify station — code/mode/serial)' : rawMode ? 'RAW (manual command-by-command)' : directMode ? 'DIRECT readBackupMemory' : 'COUPLED readCoupledBackupMemory'}`
  );
  console.log(`  baud   : 38400\n`);

  const real = new SerialTransport({ path: serialPath, baudRate: 38400 });
  const transport = new LoggingTransport(real);

  try {
    await transport.open();
    console.log(`${now()}  -- port open --`);
  } catch (err) {
    console.error(`FATAL: could not open ${serialPath}: ${(err as Error).message}`);
    console.error(
      `Is the mini reader plugged in? Is run-local.sh still running and holding the port? Stop it first.`
    );
    process.exit(1);
  }

  // Ctrl-C → close cleanly.
  process.on('SIGINT', () => {
    console.log(`\n${now()}  SIGINT — closing port`);
    void transport.close().finally(() => process.exit(130));
  });

  try {
    if (infoMode) {
      await runInfo(transport);
    } else if (rawMode) {
      await runRaw(transport);
    } else {
      const station = new SiMainStation(real); // real station drives the multiplexer
      // also dump via the logging wrapper already attached to `real`
      console.log(
        `${now()}  running ${directMode ? 'readBackupMemory' : 'readCoupledBackupMemory'}…`
      );
      const result = directMode
        ? await readBackupMemory(station)
        : await readCoupledBackupMemory(station, {
            // Verbose: log each retry by using a sleep that prints.
            sleep: (ms: number) => {
              if (ms > 0) console.log(`${now()}  (retry backoff ${ms}ms)`);
              return new Promise((r) => setTimeout(r, ms));
            },
          });
      console.log(`\n=== RESULT ===`);
      console.log(`  overflow : ${result.overflow}`);
      console.log(`  records  : ${result.records.length}`);
      const cards = [...new Set(result.records.map((r) => r.cardNumber))];
      console.log(`  unique cards (${cards.length}): ${cards.join(', ') || '(none)'}`);
      console.log(
        `\n  >> Tip: the station's code number is the CN1 CN0 bytes in each RX frame above\n` +
          `     (e.g. "02 83 .. 00 88 .." = station 0x0088 = 136). Use it to confirm WHICH\n` +
          `     unit you read — place Start / Mål / 136 / 110 one at a time.`
      );
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/asleep|did not respond/i.test(msg)) {
      console.error(
        `\n!! the unit didn't respond — it's asleep. Dip an SI card into the station to wake it, then run again immediately.`
      );
    } else {
      console.error(`\n!! read failed: ${msg}`);
    }
  } finally {
    await transport.close();
  }
  process.exit(0);
}

void main();
