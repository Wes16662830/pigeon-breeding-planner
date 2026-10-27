// Breeding record — which pairings were made, which youngsters came from
// them, and how those youngsters raced. Pure (no I/O); runs in the browser
// over GET /api/birds + GET /api/pairings.
//
// Youngsters are never stored on a pairing. A youngster is any bird whose
// sire and dam are the pairing's cock and hen, matched by ring through the
// identity graph (shared/pairing.ts) — so a bird entered on this page, on a
// merged pedigree sheet or via a spreadsheet import all count the same.
//
// When the same cock and hen are paired in more than one season, each
// youngster goes to the pairing whose season matches the year in its ring.
// A youngster whose ring has no readable year goes to the couple's most
// recent pairing. A youngster from a season with no pairing record isn't
// attributed to any pairing (it still counts toward both parents' progeny
// record in the planner).

import type { Bird, Pairing } from './types.js';
import { parseRingTokens } from './ring.js';
import { identityKeyOf, resultPercentile, type IdentityGraph } from './pairing.js';

export interface YoungsterSummary {
  key: string;
  ring: string;
  name?: string;
  sex: Bird['sex'];
  rowId: string; // a row to edit — the first record of this bird
  scorable: number; // results with position + pool size
  meanPercentile?: number;
  bestPercentile?: number;
  bestRaw?: string;
}

export interface PairingOutcome {
  youngsters: YoungsterSummary[];
  raced: number; // youngsters with at least one scorable result
  meanIndex?: number; // mean over raced youngsters of their mean percentile, 0–1
  topTen: number; // youngsters with any result in the top 10% of the field
}

export function youngsterSummary(key: string, graph: IdentityGraph): YoungsterSummary | undefined {
  const node = graph.get(key);
  if (!node) return undefined;
  let best: { p: number; raw: string } | undefined;
  const pcts: number[] = [];
  for (const r of node.results) {
    const p = resultPercentile(r);
    if (p === undefined) continue;
    pcts.push(p);
    if (!best || p > best.p) best = { p, raw: r.raw };
  }
  return {
    key,
    ring: node.ring,
    name: node.name,
    sex: node.sex,
    rowId: node.rowIds[0],
    scorable: pcts.length,
    meanPercentile: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : undefined,
    bestPercentile: best?.p,
    bestRaw: best?.raw,
  };
}

export function outcomeOf(youngsterKeys: string[], graph: IdentityGraph): PairingOutcome {
  const youngsters = youngsterKeys.map((k) => youngsterSummary(k, graph)).filter((y): y is YoungsterSummary => !!y);
  const raced = youngsters.filter((y) => y.meanPercentile !== undefined);
  return {
    youngsters: youngsters.sort((a, b) => a.ring.localeCompare(b.ring)),
    raced: raced.length,
    meanIndex: raced.length ? raced.reduce((a, y) => a + y.meanPercentile!, 0) / raced.length : undefined,
    topTen: youngsters.filter((y) => (y.bestPercentile ?? 0) >= 0.9).length,
  };
}

export function ringYear(ring: string): number | undefined {
  const y = parseRingTokens(ring).year;
  return y ? Number(y) : undefined;
}

/** Map each pairing id → identity keys of its youngsters. */
export function youngstersByPairing(pairings: Pairing[], birds: Bird[], graph: IdentityGraph): Map<string, string[]> {
  const rowKey = new Map(birds.map((b) => [b.id, identityKeyOf(b)]));
  const couple = (s?: string, d?: string) => `${s}|${d}`;

  const byCouple = new Map<string, Pairing[]>();
  for (const p of pairings) {
    const k = couple(rowKey.get(p.sireId), rowKey.get(p.damId));
    const list = byCouple.get(k) ?? [];
    list.push(p);
    byCouple.set(k, list);
  }

  const out = new Map<string, string[]>(pairings.map((p) => [p.id, []]));
  for (const node of graph.values()) {
    if (!node.sireKey || !node.damKey) continue;
    const candidates = byCouple.get(couple(node.sireKey, node.damKey));
    if (!candidates) continue;
    const year = ringYear(node.ring);
    const target =
      year !== undefined ? candidates.find((p) => p.season === year) : [...candidates].sort((a, b) => b.season - a.season)[0];
    if (target) out.get(target.id)!.push(node.key);
  }
  return out;
}

// ---- proven breeders ----------------------------------------------------------

export interface BreederRecord {
  key: string;
  ring: string;
  name?: string;
  sex: Bird['sex'];
  youngsters: number;
  raced: number;
  progenyIndex?: number; // mean over raced youngsters, 0–1
  shrunkIndex: number; // pulled toward 0.5 when few youngsters have raced — what the ranking uses
  topTen: number;
  mates: number;
}

const BREEDER_PRIOR = 3; // ≈ "3 average youngsters" of prior weight

/** Every bird with at least one youngster on file, ranked by how its youngsters raced. */
export function breederRecords(graph: IdentityGraph): BreederRecord[] {
  const out: BreederRecord[] = [];
  for (const node of graph.values()) {
    if (!node.childKeys.length) continue;
    const outcome = outcomeOf(node.childKeys, graph);
    const mates = new Set(node.childKeys.map((k) => {
      const c = graph.get(k);
      return c?.sireKey === node.key ? c?.damKey : c?.sireKey;
    }).filter(Boolean));
    const sum = outcome.youngsters.reduce((a, y) => a + (y.meanPercentile ?? 0), 0);
    out.push({
      key: node.key,
      ring: node.ring,
      name: node.name,
      sex: node.sex,
      youngsters: outcome.youngsters.length,
      raced: outcome.raced,
      progenyIndex: outcome.meanIndex,
      shrunkIndex: (sum + 0.5 * BREEDER_PRIOR) / (outcome.raced + BREEDER_PRIOR),
      topTen: outcome.topTen,
      mates: mates.size,
    });
  }
  return out.sort((a, b) => b.shrunkIndex - a.shrunkIndex || b.raced - a.raced);
}

// ---- does the planner predict anything? ---------------------------------------

export interface PredictionCheck {
  pairs: { pairingId: string; predicted: number; actual: number; raced: number }[];
  spearman?: number; // rank correlation, -1..1; undefined below MIN_PAIRS_FOR_CORRELATION
}

export const MIN_PAIRS_FOR_CORRELATION = 5;

export function checkPredictions(pairings: Pairing[], outcomes: Map<string, PairingOutcome>): PredictionCheck {
  const pairs = pairings
    .map((p) => {
      const o = outcomes.get(p.id);
      const predicted = p.prediction?.expectedIndex;
      if (predicted === undefined || !o || o.meanIndex === undefined) return undefined;
      return { pairingId: p.id, predicted, actual: o.meanIndex, raced: o.raced };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return {
    pairs,
    spearman: pairs.length >= MIN_PAIRS_FOR_CORRELATION ? spearman(pairs.map((p) => p.predicted), pairs.map((p) => p.actual)) : undefined,
  };
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1; // ties share the average rank
    for (let k = i; k <= j; k++) r[order[k].i] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number | undefined {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : undefined;
}

// ---- server side: adding a youngster to a pairing ----------------------------

export const PAIRING_SOURCE_PREFIX = 'pairing:';

export interface YoungsterInput {
  ring: string;
  sex?: Bird['sex'];
  colour?: string;
  name?: string;
}

/**
 * Validates a youngster for a pairing and returns the bird row to save.
 * Refuses (rather than guessing) when the ring's year doesn't match the
 * season — the youngster would silently land on the wrong pairing or none —
 * or when a record of that ring already names different parents.
 */
export function planYoungster(
  pairing: Pairing,
  input: YoungsterInput,
  birds: Bird[],
  normalise: (ring: string) => string,
  newId: () => string,
): { bird: Bird } | { error: string } {
  const ring = input.ring?.trim();
  if (!ring) return { error: 'Ring is required.' };
  const year = ringYear(ring);
  if (year !== undefined && year !== pairing.season) {
    return { error: `Ring year ${year} doesn't match this pairing's ${pairing.season} season. Record it on a ${year} pairing of these parents instead.` };
  }

  const byId = new Map(birds.map((b) => [b.id, b]));
  const sire = byId.get(pairing.sireId);
  const dam = byId.get(pairing.damId);
  if (!sire || !dam) return { error: "This pairing's cock or hen is no longer on file." };
  const key = normalise(ring);
  const sameRing = birds.filter((b) => b.ringNormalised === key);
  const sireKey = identityKeyOf(sire);
  const damKey = identityKeyOf(dam);
  for (const b of sameRing) {
    const s = b.sireId ? byId.get(b.sireId) : undefined;
    const d = b.damId ? byId.get(b.damId) : undefined;
    if ((s && identityKeyOf(s) !== sireKey) || (d && identityKeyOf(d) !== damKey)) {
      return { error: `${b.ring} is already on file with different parents. Fix it in the Bird Library first.` };
    }
  }

  // Reuse a record this app created (pairing/import) rather than adding a
  // second row for the same bird; scanned-pedigree rows are left alone.
  const own = sameRing.find((b) => b.sourceFile?.startsWith(PAIRING_SOURCE_PREFIX) || b.sourceFile?.startsWith('import:'));
  const base: Bird = own ?? {
    id: newId(),
    ring,
    ringNormalised: key,
    sex: 'unknown',
    notes: [],
    results: [],
    confidence: 1,
    verified: true,
    sourceFile: `${PAIRING_SOURCE_PREFIX}${pairing.id}`,
  };
  return {
    bird: {
      ...base,
      sex: input.sex && input.sex !== 'unknown' ? input.sex : base.sex,
      colour: input.colour?.trim() || base.colour,
      name: input.name?.trim() || base.name,
      sireId: pairing.sireId,
      damId: pairing.damId,
    },
  };
}

export function validatePairingInput(body: Partial<Pairing>, birds: Bird[]): string | undefined {
  if (!body.sireId || !body.damId) return 'Choose a cock and a hen.';
  if (body.sireId === body.damId) return 'Cock and hen must be different birds.';
  const ids = new Set(birds.map((b) => b.id));
  if (!ids.has(body.sireId) || !ids.has(body.damId)) return 'Cock or hen not found.';
  if (!Number.isInteger(body.season) || body.season! < 1990 || body.season! > 2100) return 'Season must be a year.';
  if (body.status && !['planned', 'active', 'ended'].includes(body.status)) return 'Unknown status.';
  return undefined;
}
