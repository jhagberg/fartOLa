// Authored for fartola. Not ported from upstream.
//
// Live card read of a touch-free (PTD bit 7) start/finish/check record on an
// SI10/SIAC: its station code sits in block 1 (page 1) at 0xa5 / 0xa9 / 0xa1,
// so the read fetches page 1 even when the card holder is already complete,
// and only then. Fake station serves pages from a synthetic memory image.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { proto } from '../../constants.ts';
import type { SiMessage } from '../../siProtocol.ts';
import { SiCard10 } from './SiCard10.ts';
import { SiCard8 } from './SiCard8.ts';
import { SiCard9 } from './SiCard9.ts';

const BYTES_PER_PAGE = 128;
const FINISH = 0x10;
const START = 0x0c;
const CHECK = 0x08;

/** A 0x400-byte card image: erased (0xee) except a complete card holder in
 * page 0 and `punches` punch records at page 4. */
function makeMemory(opts: { punches?: number; holderComplete?: boolean } = {}): number[] {
  const mem = new Array<number>(0x400).fill(0xee);
  const holder = opts.holderComplete === false ? 'A;B' : ';;;;;;;;;;;';
  for (let i = 0; i < holder.length; i++) mem[0x20 + i] = holder.charCodeAt(i);
  mem[0x16] = opts.punches ?? 0;
  for (let i = 0; i < (opts.punches ?? 0); i++)
    mem.splice(0x200 + 4 * i, 4, 0x01, 31 + i, 0x0e, 0x10);
  return mem;
}

function setRecord(mem: number[], offset: number, ptd: number, cn: number): void {
  mem.splice(offset, 4, ptd, cn, 0x0e, 0x10);
}

async function read(mem: number[]): Promise<{ card: SiCard10; pages: number[] }> {
  const card = new SiCard10(0);
  const pages: number[] = [];
  card.mainStation = {
    sendMessage: async (msg: SiMessage) => {
      if (msg.mode !== undefined) return [];
      const page = msg.parameters[0]!;
      pages.push(page);
      const data = mem.slice(page * BYTES_PER_PAGE, (page + 1) * BYTES_PER_PAGE);
      return [[proto.cmd.GET_SI8, BYTES_PER_PAGE + 3, 0x00, 0x0a, page, ...data]];
    },
  } as unknown as NonNullable<SiCard10['mainStation']>;
  await card.typeSpecificRead();
  return { card, pages };
}

describe('block 1 read for touch-free start/finish/check', () => {
  test('touch-free finish: page 1 is read and the block-1 code is decoded', async () => {
    const mem = makeMemory();
    setRecord(mem, FINISH, 0x81, 0xee); // PTD bit 7 + PM; CN is not the code
    mem[0xa9] = 20;
    const { card, pages } = await read(mem);
    assert.deepEqual(pages, [0, 1]);
    assert.equal(card.raceResult.finishCode, 20);
    assert.equal(card.raceResult.finishTouchFree, true);
  });

  test('PTD bit 6 adds 256 to the block-1 code; start (0xa5) and check (0xa1) too', async () => {
    const mem = makeMemory();
    setRecord(mem, FINISH, 0xc1, 0xee);
    setRecord(mem, START, 0x81, 0xee);
    setRecord(mem, CHECK, 0xc1, 0xee);
    mem[0xa9] = 20;
    mem[0xa5] = 11;
    mem[0xa1] = 3;
    const { card, pages } = await read(mem);
    assert.deepEqual(pages, [0, 1]);
    assert.deepEqual(
      [card.raceResult.startCode, card.raceResult.finishCode, card.raceResult.checkCode],
      [11, 276, 259]
    );
  });

  test('touch-free finish with punches: page 1 once, before the punch pages', async () => {
    const mem = makeMemory({ punches: 2 });
    setRecord(mem, FINISH, 0x81, 0xee);
    mem[0xa9] = 20;
    const { card, pages } = await read(mem);
    assert.deepEqual(pages, [0, 1, 4]);
    assert.equal(card.raceResult.finishCode, 20);
    assert.equal(card.raceResult.punches?.length, 2);
  });

  test('incomplete card holder and touch-free finish: page 1 is still read only once', async () => {
    const mem = makeMemory({ holderComplete: false });
    setRecord(mem, FINISH, 0x81, 0xee);
    mem[0xa9] = 20;
    const { card, pages } = await read(mem);
    assert.deepEqual(pages, [0, 1]);
    assert.equal(card.raceResult.finishCode, 20);
  });

  test('no touch-free record: no extra request', async () => {
    const mem = makeMemory({ punches: 2 });
    setRecord(mem, FINISH, 0x01, 20);
    setRecord(mem, START, 0x01, 11);
    const { card, pages } = await read(mem);
    assert.deepEqual(pages, [0, 4]);
    assert.equal(card.raceResult.finishCode, 20);
    assert.equal(card.raceResult.finishTouchFree, undefined);
  });

  test('erased records (0xee has bit 7 set) do not trigger a block-1 read', async () => {
    const { pages } = await read(makeMemory());
    assert.deepEqual(pages, [0]);
  });

  test('block 1 still erased: touch_free without a code', async () => {
    const mem = makeMemory();
    setRecord(mem, FINISH, 0x81, 0xee);
    const { card } = await read(mem);
    assert.equal(card.raceResult.finishTouchFree, true);
    assert.equal(card.raceResult.finishCode, undefined);
  });
});

describe('SI8/SI9 with zero punches', () => {
  for (const [name, Card] of [
    ['SI8', SiCard8],
    ['SI9', SiCard9],
  ] as const) {
    const readCard = async (
      mem: number[]
    ): Promise<{ card: SiCard8 | SiCard9; pages: number[] }> => {
      const card = new Card(0);
      const pages: number[] = [];
      card.mainStation = {
        sendMessage: async (msg: SiMessage) => {
          if (msg.mode !== undefined) return [];
          const page = msg.parameters[0]!;
          pages.push(page);
          const data = mem.slice(page * BYTES_PER_PAGE, (page + 1) * BYTES_PER_PAGE);
          return [[proto.cmd.GET_SI8, BYTES_PER_PAGE + 3, 0x00, 0x0a, page, ...data]];
        },
      } as unknown as NonNullable<SiCard8['mainStation']>;
      await card.typeSpecificRead();
      return { card, pages };
    };

    test(`${name}: touch-free finish reads page 1 and decodes the code`, async () => {
      const mem = makeMemory();
      setRecord(mem, FINISH, 0xc1, 0xee);
      mem[0xa9] = 20;
      const { card, pages } = await readCard(mem);
      assert.deepEqual(pages, [0, 1]);
      assert.equal(card.raceResult.finishCode, 276);
      assert.equal(card.raceResult.finishTouchFree, true);
    });

    test(`${name}: no touch-free record, no punches: page 0 only`, async () => {
      const mem = makeMemory();
      setRecord(mem, FINISH, 0x01, 20);
      const { card, pages } = await readCard(mem);
      assert.deepEqual(pages, [0]);
      assert.equal(card.raceResult.finishCode, 20);
    });
  }
});
