import { DIRS, MOVES, isColor, isModeId } from './types.js';
import type { Color, Config, ConfigInput, Vec, WorldTurn } from './types.js';
import { fnv1a, mulberry32 } from './hash.js';

export function tileKey(x: number, y: number): string { return x + ',' + y; }
export function cellKey(t: WorldTurn, x: number, y: number): string { return t + ',' + x + ',' + y; }
export function unkey(k: string): Vec {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

// One tile in from the corner so every spawn has four neighbours.
export function spawnFor(color: Color, w: number, h: number): Vec {
  if (color === 'C') return [1, 1];
  if (color === 'P') return [w - 2, h - 2];
  if (color === 'T') return [w - 2, 1];
  return [1, h - 2];
}

export function centerOf(w: number, h: number): Vec {
  return [Math.floor(w / 2), Math.floor(h / 2)];
}

export type BoardPreviewData = {
  w: number; h: number; roster: Color[]; walls: Vec[];
  spawns: Partial<Record<Color, Vec>>; center: Vec; keyAtCenter: boolean;
};

export function previewBoard(input: ConfigInput): BoardPreviewData & { maxWallPct: number } {
  const cfg = normalizeConfig(input);
  const spawns: Partial<Record<Color, Vec>> = {};
  for (const color of cfg.roster) spawns[color] = spawnFor(color, cfg.w, cfg.h);
  return {
    w: cfg.w, h: cfg.h, roster: cfg.roster, walls: [...genWalls(cfg)].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    maxWallPct: wallPlacement(cfg).maxWallPct,
    spawns, center: centerOf(cfg.w, cfg.h), keyAtCenter: cfg.mode === 'bootstrap'
  };
}

function protectedTiles(cfg: Config): Set<string> {
  const out = new Set<string>();
  for (const c of cfg.roster) {
    const s = spawnFor(c, cfg.w, cfg.h);
    out.add(tileKey(s[0], s[1]));
    for (const m of MOVES) out.add(tileKey(s[0] + DIRS[m][0], s[1] + DIRS[m][1]));
  }
  const ctr = centerOf(cfg.w, cfg.h);
  out.add(tileKey(ctr[0], ctr[1]));
  return out;
}

export function normalizeConfig(c: ConfigInput): Config {
  const asked = c.roster.slice();
  const w = Math.floor(c.w), h = Math.floor(c.h), wallPct = Math.floor(c.wallPct);
  const seed = String(c.seed), mode = c.mode;
  if (!isModeId(mode)) throw new Error('unknown mode ' + mode);
  // 5x5 keeps the center off every spawn; 64 keeps rendering bounded.
  if (!(w >= 5 && w <= 64 && h >= 5 && h <= 64)) throw new Error('board must be between 5x5 and 64x64');
  if (!(wallPct >= 0 && wallPct <= 45)) throw new Error('wall density must be 0-45');
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(seed)) throw new Error('seed must be 1-24 letters, digits, - or _');
  if (!asked.length || asked.length > 4) throw new Error('need 1-4 players');

  const roster: Color[] = [];
  for (const col of asked) {
    if (!isColor(col)) throw new Error('unknown colour ' + col);
    if (roster.includes(col)) throw new Error('duplicate colour ' + col);
    roster.push(col);
  }
  return { mode, w, h, wallPct, seed, roster };
}

type WallPlacement = { tiles: number[]; maxWallPct: number };
const placements = new Map<string, WallPlacement>();

function wallPlacement(cfg: Config): WallPlacement {
  const { w, h } = cfg, area = w * h;
  const key = w + 'x' + h + ':' + cfg.seed + ':' + cfg.roster.slice().sort().join('');
  const cached = placements.get(key);
  if (cached) {
    placements.delete(key); placements.set(key, cached);
    return cached;
  }

  const safe = protectedTiles(cfg);
  const candidates: number[] = [];
  for (let i = 0; i < area; i++) {
    if (!safe.has(tileKey(i % w, Math.floor(i / w)))) candidates.push(i);
  }
  const rnd = mulberry32(fnv1a('walls:' + cfg.seed));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tile = candidates[i]!; candidates[i] = candidates[j]!; candidates[j] = tile;
  }

  const must = [...cfg.roster.map((c) => spawnFor(c, w, h)), centerOf(w, h)];
  const [sx, sy] = must[0]!, start = sy * w + sx;
  const required = new Uint8Array(area);
  for (const [x, y] of must) required[y * w + x] = 1;
  const walls = new Uint8Array(area), seen = new Uint32Array(area), queue = new Uint16Array(area);
  const steps = [-w, -1, w, 1];
  let stamp = 0;
  function connected(): boolean {
    stamp++;
    let head = 0, tail = 1, remaining = must.length - 1;
    queue[0] = start; seen[start] = stamp;
    while (head < tail && remaining) {
      const tile = queue[head++]!, x = tile % w;
      for (const step of steps) {
        const next = tile + step;
        if (next < 0 || next >= area || (step === -1 && x === 0) || (step === 1 && x === w - 1)) continue;
        if (walls[next] || seen[next] === stamp) continue;
        seen[next] = stamp; queue[tail++] = next;
        if (required[next] && --remaining === 0) return true;
      }
    }
    return remaining === 0;
  }

  const tiles: number[] = [], target = Math.floor(area * 45 / 100);
  for (const tile of candidates) {
    walls[tile] = 1;
    if (connected()) tiles.push(tile);
    else walls[tile] = 0;
    if (tiles.length === target) break;
  }
  let maxWallPct = 45;
  while (Math.floor(area * maxWallPct / 100) > tiles.length) maxWallPct--;
  const result = { tiles, maxWallPct };
  placements.set(key, result);
  if (placements.size > 6) placements.delete(placements.keys().next().value!);
  return result;
}

export function genWalls(cfg: Config): Set<string> {
  const placement = wallPlacement(cfg);
  const target = Math.floor(cfg.w * cfg.h * Math.min(cfg.wallPct, placement.maxWallPct) / 100);
  return new Set(placement.tiles.slice(0, target).map((tile) => tileKey(tile % cfg.w, Math.floor(tile / cfg.w))));
}
