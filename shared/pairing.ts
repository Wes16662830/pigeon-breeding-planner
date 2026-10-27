// Pairing planner — ranks every candidate cock × hen pair on the data
// already in the collection. Pure and deterministic (no Claude call, no
// I/O): the same birds in always produce the same ranking, and every
// number shown can be traced back to a stored result or a ring match.
//
// What it measures, per pair:
//  - Projected COI of the offspring (Wright's, via shared/inbreeding.ts),
//    and which common ancestors drive it.
//  - A performance index for each parent: its own scorable results, plus
//    its ancestors' results weighted by relationship (0.5 per generation).
//  - The distance profile each side's results come from, so a sprint line
//    isn't blindly crossed into a long-distance line.
//  - How much evidence sits behind those numbers. A score from two results
//    on a great-great-grandsire is not the same as one from twenty on the
//    bird itself, and the UI must say so.
//
// What it deliberately does NOT do: pretend race performance is mostly
// genetic. Loft management, health, weather and basketing luck dominate a
// single result; this ranks pairings by what the pedigree data supports,
// it doesn't predict a winner.
//
// Identity is `ringNormalised`, same rule as inbreeding.ts/crossref.ts:
// one physical bird uploaded on three different sheets is three rows, and
// its results and parents may be split across them. `buildIdentityGraph`
// folds those rows back into one node per bird before anything is scored.

import type { Bird, BirdMarkers, Result } from './types.js';
import { coefficientOfInbreeding } from './inbreeding.js';

export interface IdentityNode {
  key: string; // `ring:<ringNormalised>` or `id:<row id>`
  rowIds: string[];
  ring: string;
  name?: string;
  sex: Bird['sex'];
  sireKey?: string;
  damKey?: string;
  results: Result[]; // de-duplicated across rows by verbatim `raw`
  markers: BirdMarkers; // merged across rows, first non-empty value per field wins
  parentConflict?: boolean; // two records of this ring name different parents
  childKeys: string[]; // birds that name this one as sire or dam
}

export type IdentityGraph = Map<string, IdentityNode>;

export function identityKeyOf(b: Pick<Bird, 'id' | 'ringNormalised'>): string {
  return b.ringNormalised ? `ring:${b.ringNormalised}` : `id:${b.id}`;
}

export function buildIdentityGraph(birds: Bird[]): IdentityGraph {
  const byId = new Map(birds.map((b) => [b.id, b]));
  const graph: IdentityGraph = new Map();
  for (const b of birds) {
    const key = identityKeyOf(b);
    let node = graph.get(key);
    if (!node) {
      node = { key, rowIds: [], ring: b.ring, sex: 'unknown', results: [], markers: {}, childKeys: [] };
      graph.set(key, node);
    }
    node.rowIds.push(b.id);
    if (!node.name && b.name) node.name = b.name;
    if (node.sex === 'unknown' && b.sex !== 'unknown') node.sex = b.sex;
    if (b.markers) node.markers = { ...b.markers, ...node.markers };
    // First row that knows a parent wins. Two uploads disagreeing about a
    // bird's parents is a data error for the verify step, not something to
    // average over here.
    const sire = b.sireId ? byId.get(b.sireId) : undefined;
    const dam = b.damId ? byId.get(b.damId) : undefined;
    if (sire) {
      const k = identityKeyOf(sire);
      if (!node.sireKey) node.sireKey = k;
      else if (node.sireKey !== k) node.parentConflict = true;
    }
    if (dam) {
      const k = identityKeyOf(dam);
      if (!node.damKey) node.damKey = k;
      else if (node.damKey !== k) node.parentConflict = true;
    }
    const seen = new Set(node.results.map((r) => r.raw));
    for (const r of b.results) {
      if (!seen.has(r.raw)) {
        node.results.push(r);
        seen.add(r.raw);
      }
    }
  }
  for (const node of graph.values()) {
    for (const parentKey of [node.sireKey, node.damKey]) {
      const parent = parentKey ? graph.get(parentKey) : undefined;
      if (parent && !parent.childKeys.includes(node.key)) parent.childKeys.push(node.key);
    }
  }
  return graph;
}

// 1.0 = won, ~0 = last. Only results with both a position and a pool size
// can be scored — a bare "17th" means nothing without knowing out of how many.
export function resultPercentile(r: Result): number | undefined {
  if (!r.position || !r.poolSize || r.poolSize < 2 || r.position > r.poolSize) return undefined;
  return 1 - (r.position - 1) / r.poolSize;
}

export interface PerformanceSummary {
  index?: number; // 0–1 weighted mean percentile; undefined when nothing is scorable
  ownIndex?: number;
  ownScorable: number;
  evidence: number; // sum of relationship weights × scorable results — drives the confidence label
  scorableResults: number;
  meanDistanceKm?: number;
  // Progeny test: how this bird's youngsters (any mate) have raced. Best
  // single evidence of what a bird passes on, once there is enough of it.
  progenyIndex?: number;
  progenyRaced: number;
  topAncestors: { key: string; ring: string; name?: string; generation: number; percentile: number; results: number }[];
}

const MAX_GENERATIONS = 6;

export function performanceSummary(key: string, graph: IdentityGraph): PerformanceSummary {
  let weightedSum = 0;
  let weightTotal = 0;
  let evidence = 0;
  let scorableResults = 0;
  let distSum = 0;
  let distWeight = 0;
  let ownIndex: number | undefined;
  let ownScorable = 0;
  const ancestors = new Map<string, PerformanceSummary['topAncestors'][number]>();

  // Each path to an ancestor counts — an ancestor doubled up through
  // line-breeding genuinely contributes twice the expected share of genes.
  function visit(k: string | undefined, generation: number, onPath: Set<string>) {
    if (!k || generation > MAX_GENERATIONS || onPath.has(k)) return;
    const node = graph.get(k);
    if (!node) return;
    const weight = Math.pow(0.5, generation);
    const pcts = node.results.map(resultPercentile).filter((p): p is number => p !== undefined);
    if (pcts.length) {
      const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      // Diminishing returns on result count so one ancestor with 30 races
      // can't swamp the whole pedigree.
      const w = weight * Math.min(1, Math.sqrt(pcts.length / 4));
      weightedSum += mean * w;
      weightTotal += w;
      evidence += weight * pcts.length;
      scorableResults += pcts.length;
      if (generation === 0) {
        ownIndex = mean;
        ownScorable = pcts.length;
      } else if (!ancestors.has(k) || ancestors.get(k)!.generation > generation) {
        ancestors.set(k, { key: k, ring: node.ring, name: node.name, generation, percentile: mean, results: pcts.length });
      }
    }
    for (const r of node.results) {
      if (r.distanceKm) {
        distSum += r.distanceKm * weight;
        distWeight += weight;
      }
    }
    const next = new Set(onPath).add(k);
    visit(node.sireKey, generation + 1, next);
    visit(node.damKey, generation + 1, next);
  }
  visit(key, 0, new Set());

  // Youngsters share half their genes with this bird, same as its parents
  // do, so they're weighted like generation 1.
  const progenyMeans: number[] = [];
  for (const childKey of graph.get(key)?.childKeys ?? []) {
    const pcts = (graph.get(childKey)?.results ?? []).map(resultPercentile).filter((p): p is number => p !== undefined);
    if (!pcts.length) continue;
    const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    const w = 0.5 * Math.min(1, Math.sqrt(pcts.length / 4));
    weightedSum += mean * w;
    weightTotal += w;
    evidence += 0.5 * pcts.length;
    scorableResults += pcts.length;
    progenyMeans.push(mean);
  }

  return {
    progenyIndex: progenyMeans.length ? progenyMeans.reduce((a, b) => a + b, 0) / progenyMeans.length : undefined,
    progenyRaced: progenyMeans.length,
    index: weightTotal > 0 ? weightedSum / weightTotal : undefined,
    ownIndex,
    ownScorable,
    evidence,
    scorableResults,
    meanDistanceKm: distWeight > 0 ? distSum / distWeight : undefined,
    topAncestors: [...ancestors.values()].sort((a, b) => b.percentile * Math.pow(0.5, b.generation) - a.percentile * Math.pow(0.5, a.generation)).slice(0, 5),
  };
}

export type EvidenceLevel = 'none' | 'thin' | 'moderate' | 'solid';

export function evidenceLevel(evidence: number): EvidenceLevel {
  if (evidence <= 0) return 'none';
  if (evidence < 2) return 'thin';
  if (evidence < 6) return 'moderate';
  return 'solid';
}

export type DistanceBand = 'sprint' | 'middle' | 'long';

export function distanceBand(km?: number): DistanceBand | undefined {
  if (km === undefined) return undefined;
  if (km < 400) return 'sprint';
  if (km < 650) return 'middle';
  return 'long';
}

function categoryBand(c: BirdMarkers['category']): DistanceBand | undefined {
  if (!c) return undefined;
  return c === 'marathon' ? 'long' : c;
}

export interface PairingOptions {
  // Projected COI below this is not penalised. Mild line-breeding onto a
  // proven bird is often the point; 6.25% ≈ first-cousin mating.
  coiFreeThreshold: number;
  // Each 1% of COI above the threshold costs this many index points (0–100 scale).
  coiPenaltyPerPercent: number;
}

export const DEFAULT_PAIRING_OPTIONS: PairingOptions = { coiFreeThreshold: 0.0625, coiPenaltyPerPercent: 1.5 };

export interface CommonAncestor {
  key: string;
  ring: string;
  name?: string;
  contribution: number; // share of the offspring's COI
  percentile?: number; // that ancestor's own mean result percentile, if scorable
}

export interface PairingSuggestion {
  sireKey: string;
  damKey: string;
  coi: number;
  commonAncestors: CommonAncestor[];
  sirePerf: PerformanceSummary;
  damPerf: PerformanceSummary;
  expectedIndex?: number; // mean of the two parents' evidence-shrunk indices, 0–1
  evidence: EvidenceLevel; // the weaker of the two sides
  distanceMismatch: boolean;
  score?: number; // 0–100 ranking score; undefined if neither side has scorable results
  notes: string[];
}

// Pull an index toward 0.5 (an average bird) in proportion to how little
// evidence backs it, so one lucky result on a distant ancestor can't
// outrank a parent with a long, solid record. A side with no scorable
// results at all is exactly 0.5 — unknown, not assumed good or bad.
const SHRINK_PRIOR = 2;
export function shrunkIndex(perf: PerformanceSummary): number {
  if (perf.index === undefined) return 0.5;
  return (perf.index * perf.evidence + 0.5 * SHRINK_PRIOR) / (perf.evidence + SHRINK_PRIOR);
}

const OFFSPRING_KEY = '__pairing_offspring__';

// Synthetic one-row-per-identity bird list, so coefficientOfInbreeding sees
// the merged tree (parents found on any upload) rather than one row's view.
function graphAsBirds(graph: IdentityGraph): Bird[] {
  return [...graph.values()].map((n) => ({
    id: n.key,
    ring: n.ring,
    ringNormalised: n.key.startsWith('ring:') ? n.key.slice(5) : undefined,
    sex: n.sex,
    notes: [],
    results: [],
    sireId: n.sireKey,
    damId: n.damKey,
    confidence: 1,
    verified: true,
  }));
}

export function rankPairings(
  sireKeys: string[],
  damKeys: string[],
  graph: IdentityGraph,
  options: PairingOptions = DEFAULT_PAIRING_OPTIONS,
): PairingSuggestion[] {
  const baseBirds = graphAsBirds(graph);
  const perfCache = new Map<string, PerformanceSummary>();
  const perf = (k: string) => {
    if (!perfCache.has(k)) perfCache.set(k, performanceSummary(k, graph));
    return perfCache.get(k)!;
  };
  const evidenceRank: EvidenceLevel[] = ['none', 'thin', 'moderate', 'solid'];

  const out: PairingSuggestion[] = [];
  for (const sireKey of sireKeys) {
    for (const damKey of damKeys) {
      if (sireKey === damKey) continue;
      const offspring: Bird = { id: OFFSPRING_KEY, ring: '', sex: 'unknown', notes: [], results: [], sireId: sireKey, damId: damKey, confidence: 1, verified: true };
      const { coefficient, contributingAncestors } = coefficientOfInbreeding(OFFSPRING_KEY, [...baseBirds, offspring]);

      const sirePerf = perf(sireKey);
      const damPerf = perf(damKey);
      const expectedIndex =
        sirePerf.index === undefined && damPerf.index === undefined ? undefined : (shrunkIndex(sirePerf) + shrunkIndex(damPerf)) / 2;
      const evidence = evidenceRank[Math.min(evidenceRank.indexOf(evidenceLevel(sirePerf.evidence)), evidenceRank.indexOf(evidenceLevel(damPerf.evidence)))];

      // Measured distances win; the fancier's own category marker fills in
      // when no result carries a distance.
      const sb = distanceBand(sirePerf.meanDistanceKm) ?? categoryBand(graph.get(sireKey)?.markers.category);
      const db = distanceBand(damPerf.meanDistanceKm) ?? categoryBand(graph.get(damKey)?.markers.category);
      const distanceMismatch = !!sb && !!db && ((sb === 'sprint' && db === 'long') || (sb === 'long' && db === 'sprint'));

      const commonAncestors: CommonAncestor[] = contributingAncestors.map((c) => {
        const node = graph.get(c.ancestorId);
        const anc = perf(c.ancestorId);
        return { key: c.ancestorId, ring: node?.ring ?? c.ancestorId, name: node?.name, contribution: c.contribution, percentile: anc.ownIndex };
      });

      const notes: string[] = [];
      if (sireKey === graph.get(damKey)?.sireKey || damKey === graph.get(sireKey)?.damKey) notes.push('Parent × offspring mating.');
      const gs = graph.get(sireKey);
      const gd = graph.get(damKey);
      if (gs?.sireKey && gs.sireKey === gd?.sireKey && gs.damKey && gs.damKey === gd?.damKey) notes.push('Full siblings.');
      else if ((gs?.sireKey && gs.sireKey === gd?.sireKey) || (gs?.damKey && gs.damKey === gd?.damKey)) notes.push('Half siblings.');
      const conflicted = [gs, gd].filter((n) => n?.parentConflict).map((n) => n!.ring);
      if (conflicted.length) {
        notes.unshift(`Records disagree about the parents of ${conflicted.join(' and ')} — COI and sibling checks use the first record found. Fix in the Bird Library.`);
      }
      const provenCommon = commonAncestors.filter((c) => c.percentile !== undefined && c.percentile >= 0.9);
      if (provenCommon.length) {
        notes.push(`Concentrates proven performer${provenCommon.length > 1 ? 's' : ''}: ${provenCommon.map((c) => c.name ? `${c.ring} "${c.name}"` : c.ring).join(', ')}.`);
      }
      if (distanceMismatch) notes.push(`Distance mismatch: sire's line races ${sb}, dam's races ${db}.`);
      if (expectedIndex === undefined) notes.push('No scorable results (need position + pool size) on either side — ranked on COI only.');
      else if (sirePerf.index === undefined || damPerf.index === undefined)
        notes.push(`No scorable results behind the ${sirePerf.index === undefined ? 'cock' : 'hen'} — treated as an average bird.`);
      else if (evidence === 'thin') notes.push('Thin evidence — few scorable results behind this score.');

      let score: number | undefined;
      if (expectedIndex !== undefined) {
        const coiPct = coefficient * 100;
        const penalty = Math.max(0, coiPct - options.coiFreeThreshold * 100) * options.coiPenaltyPerPercent;
        score = Math.max(0, expectedIndex * 100 - penalty - (distanceMismatch ? 5 : 0));
      }

      out.push({ sireKey, damKey, coi: coefficient, commonAncestors, sirePerf, damPerf, expectedIndex, evidence, distanceMismatch, score, notes });
    }
  }

  // Scored pairs first, best score first; unscored pairs after, lowest COI first.
  return out.sort((a, b) => {
    if (a.score !== undefined && b.score !== undefined) return b.score - a.score;
    if (a.score !== undefined) return -1;
    if (b.score !== undefined) return 1;
    return a.coi - b.coi;
  });
}
