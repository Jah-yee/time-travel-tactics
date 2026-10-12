import { it } from 'node:test';
import assert from 'node:assert/strict';
import { Match, previewBoard } from '../play/src/engine/index.js';
import type { BoardPreviewData, Color, ConfigInput, Vec } from '../play/src/engine/index.js';

function config(over: Partial<ConfigInput> = {}): ConfigInput {
  return { mode: 'bootstrap', w: 16, h: 9, wallPct: 45, seed: 'probe65', roster: ['C', 'P', 'T', 'A'], ...over };
}

function assertPlayable(board: BoardPreviewData): void {
  const walls = new Set(board.walls.map(([x, y]) => `${x},${y}`));
  assert.equal(walls.size, board.walls.length);
  for (const [x, y] of board.walls) {
    assert.ok(x >= 0 && x < board.w && y >= 0 && y < board.h);
  }
  const spawns: Record<Color, Vec> = { C: [1, 1], P: [board.w - 2, board.h - 2],
    T: [board.w - 2, 1], A: [1, board.h - 2] };
  assert.deepEqual(board.center, [Math.floor(board.w / 2), Math.floor(board.h / 2)]);
  assert.ok(!walls.has(board.center.join(',')), 'center stays clear');
  for (const color of board.roster) {
    const spawn = spawns[color];
    assert.deepEqual(board.spawns[color], spawn, `spawn ${color}`);
    const [x, y] = spawn;
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      assert.ok(!walls.has(`${x + dx},${y + dy}`), `spawn ${color} tile ${x + dx},${y + dy} stays clear`);
    }
  }
  const first = board.spawns[board.roster[0]!]!;
  const seen = new Set([first.join(',')]), queue = [first];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!;
    const neighbours: Array<[number, number]> = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of neighbours) {
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= board.w || ny < 0 || ny >= board.h || walls.has(key) || seen.has(key)) continue;
      seen.add(key); queue.push([nx, ny]);
    }
  }
  for (const color of board.roster) assert.ok(seen.has(board.spawns[color]!.join(',')), `spawn ${color} disconnected`);
  assert.ok(seen.has(board.center.join(',')), 'center disconnected');
}

it('reports the largest integer percentage that fits the available wall count', () => {
  for (const [w, h, maxWallPct, count] of [[5, 5, 35, 8], [5, 6, 39, 11], [6, 6, 44, 15]] as const) {
    const board = previewBoard(config({ w, h }));
    assert.equal(board.maxWallPct, maxWallPct);
    assert.equal(board.walls.length, count);
    assert.deepEqual(previewBoard(config({ w, h, wallPct: maxWallPct })).walls, board.walls);
    assert.equal(previewBoard(config({ w, h, wallPct: 0 })).maxWallPct, maxWallPct);
  }
});

it('keeps the 45 percent limit when rounding the requested target down', () => {
  for (const [w, h] of [[5, 5], [16, 9], [64, 64]] as const) {
    const board = previewBoard(config({ w, h, roster: ['C', 'P'] }));
    assert.equal(board.maxWallPct, 45);
    assert.equal(board.walls.length, Math.floor(w * h * 45 / 100));
  }
});

it('adds walls without removing earlier walls as density rises', () => {
  let previous = new Set<string>();
  for (let wallPct = 0; wallPct <= 45; wallPct++) {
    const input = config({ wallPct }), board = previewBoard(input);
    const walls = new Set(board.walls.map((tile) => tile.join(',')));
    for (const wall of previous) assert.ok(walls.has(wall), `wall ${wall} removed at ${wallPct}%`);
    assert.equal(walls.size, Math.floor(input.w * input.h * wallPct / 100));
    assertPlayable(board);
    previous = walls;
  }
});

it('protects spawns and neighbours and connects the center on tiny and narrow boards in both modes', () => {
  for (const mode of ['sandbox', 'bootstrap']) {
    for (const roster of [['C', 'P'], ['C', 'P', 'T'], ['C', 'P', 'T', 'A']]) {
      for (const [w, h] of [[5, 5], [5, 64], [64, 5], [64, 64]] as const) {
        const input = config({ mode, roster, w, h, seed: 'narrow' });
        const board = previewBoard(input);
        assertPlayable(board);
        assert.ok(Number.isInteger(board.maxWallPct));
        assert.equal(board.walls.length, Math.floor(w * h * board.maxWallPct / 100));
        assert.deepEqual(Match.fromConfig(input).view('C').walls, board.walls);
      }
    }
  }
});

it('generates repeatable layouts while different seeds produce different walls', () => {
  const input = config(), original = previewBoard(input);
  assert.deepEqual(previewBoard(input), original);
  assert.deepEqual(previewBoard({ ...input, mode: 'sandbox' }).walls, original.walls);
  assert.notDeepEqual(previewBoard({ ...input, seed: 'other-seed' }).walls, original.walls);
});

it('isolates generated layouts from mutation and intervening boards', () => {
  const input = config({ w: 9, h: 7 }), expected = previewBoard(input);
  const changed = previewBoard(input);
  changed.walls[0]![0] = -99;
  changed.walls.push([99, 99]);
  changed.center[0] = -99;
  changed.spawns.C![0] = -99;
  changed.roster.reverse();
  assert.deepEqual(previewBoard(input), expected);
  for (let i = 0; i < 10; i++) previewBoard(config({ w: 5, h: 5, seed: `intervening${i}` }));
  assert.deepEqual(previewBoard(input), expected);
  assert.deepEqual(Match.fromConfig(input).view('C').walls, expected.walls);
});
