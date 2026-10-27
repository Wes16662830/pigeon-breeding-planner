import { Fragment, useEffect, useMemo, useState } from 'react';
import { getAllBirds } from '../lib/api';
import type { Bird } from '../../shared/types';
import {
  buildIdentityGraph,
  DEFAULT_PAIRING_OPTIONS,
  distanceBand,
  identityKeyOf,
  rankPairings,
  type IdentityGraph,
  type PairingSuggestion,
  type PerformanceSummary,
} from '../../shared/pairing';

// Pairing planner — pick the cocks and hens you're considering this season
// and get every combination ranked by projected COI, the result record
// behind each side, and how much evidence that record actually rests on.
// Computed in the browser from GET /api/birds, so it costs no API calls
// and works identically on the local and Cloudflare targets.

const SHOW_LIMIT = 50;

function pct(n: number | undefined, digits = 0) {
  return n === undefined ? '—' : `${(n * 100).toFixed(digits)}%`;
}

function label(graph: IdentityGraph, key: string) {
  const n = graph.get(key);
  if (!n) return key;
  return n.name ? `${n.ring} "${n.name}"` : n.ring;
}

const evidenceStyle: Record<PairingSuggestion['evidence'], string> = {
  none: 'bg-neutral-100 text-neutral-500',
  thin: 'bg-red-50 text-red-700',
  moderate: 'bg-amber-50 text-amber-700',
  solid: 'bg-green-50 text-green-700',
};

function coiStyle(coi: number) {
  if (coi >= 0.125) return 'text-red-600 font-semibold';
  if (coi >= 0.0625) return 'text-amber-600';
  return '';
}

function PerfBlock({ title, perf, graph }: { title: string; perf: PerformanceSummary; graph: IdentityGraph }) {
  return (
    <div>
      <div className="font-semibold">{title}</div>
      <div className="text-neutral-600">
        Own record: {perf.ownScorable ? `${pct(perf.ownIndex)} avg percentile over ${perf.ownScorable} race${perf.ownScorable > 1 ? 's' : ''}` : 'no scorable results'}
      </div>
      <div className="text-neutral-600">
        Pedigree index: {pct(perf.index)} from {perf.scorableResults} scorable result{perf.scorableResults === 1 ? '' : 's'}
      </div>
      <div className="text-neutral-600">
        Distance profile: {perf.meanDistanceKm ? `${Math.round(perf.meanDistanceKm)} km (${distanceBand(perf.meanDistanceKm)})` : 'unknown'}
      </div>
      {perf.topAncestors.length > 0 && (
        <ul className="mt-1 text-xs text-neutral-500">
          {perf.topAncestors.map((a) => (
            <li key={a.key}>
              G{a.generation}: {label(graph, a.key)} — {pct(a.percentile)} over {a.results}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PairingPage() {
  const [birds, setBirds] = useState<Bird[]>();
  const [error, setError] = useState<string>();
  const [selectedSires, setSelectedSires] = useState<Set<string>>(new Set());
  const [selectedDams, setSelectedDams] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [maxCoi, setMaxCoi] = useState(0.125);
  const [expanded, setExpanded] = useState<string>();
  const [results, setResults] = useState<PairingSuggestion[]>();

  useEffect(() => {
    getAllBirds()
      .then(setBirds)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  const graph = useMemo(() => (birds ? buildIdentityGraph(birds) : new Map() as IdentityGraph), [birds]);

  // Candidates are verified birds only — the same rule that lets a bird be
  // reused as a parent on a new sheet.
  const candidates = useMemo(() => {
    if (!birds) return [];
    const keys = new Set(birds.filter((b) => b.verified).map(identityKeyOf));
    return [...keys].map((k) => graph.get(k)!).filter(Boolean).sort((a, b) => a.ring.localeCompare(b.ring));
  }, [birds, graph]);

  const q = search.trim().toLowerCase();
  const visible = candidates.filter((c) => !q || c.ring.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q));
  const cocks = visible.filter((c) => c.sex !== 'hen');
  const hens = visible.filter((c) => c.sex !== 'cock');

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function run() {
    setExpanded(undefined);
    setResults(rankPairings([...selectedSires], [...selectedDams], graph, DEFAULT_PAIRING_OPTIONS));
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!birds) return <p className="text-sm text-neutral-500">Loading…</p>;

  const shown = results?.filter((r) => r.coi <= maxCoi);
  const hiddenByCoi = (results?.length ?? 0) - (shown?.length ?? 0);

  const column = (title: string, list: typeof candidates, selected: Set<string>, setter: (s: Set<string>) => void) => (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">
          {title} ({selected.size} selected)
        </h2>
        <div className="space-x-2 text-xs">
          <button className="hover:underline" onClick={() => setter(new Set([...selected, ...list.map((c) => c.key)]))}>
            All shown
          </button>
          <button className="hover:underline" onClick={() => setter(new Set())}>
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto text-sm">
        {list.map((c) => (
          <label key={c.key} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(selected, setter, c.key)} />
            <span>
              {c.ring} {c.name && `"${c.name}"`}
              {c.sex === 'unknown' && <span className="ml-1 text-xs text-red-600">sex unknown</span>}
            </span>
          </label>
        ))}
        {list.length === 0 && <p className="text-neutral-500">No verified birds match.</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pairing planner</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ranks every selected cock × hen by projected inbreeding, the race record behind each side (own results plus ancestors, halved per generation), and
          distance profile. Only results with both a position and a pool size can be scored — enter those in the Bird Library to sharpen the ranking. A high
          score with thin evidence is a guess, not a recommendation.
        </p>
      </div>

      <input
        className="w-full rounded border px-3 py-2 text-sm"
        placeholder="Filter by ring or name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {column('Cocks', cocks, selectedSires, setSelectedSires)}
        {column('Hens', hens, selectedDams, setSelectedDams)}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          className="rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: '#D19A45' }}
          disabled={!selectedSires.size || !selectedDams.size}
          onClick={run}
        >
          Rank {selectedSires.size * selectedDams.size} pairing{selectedSires.size * selectedDams.size === 1 ? '' : 's'}
        </button>
        <label className="text-sm">
          Hide pairs with projected COI above{' '}
          <select className="rounded border px-2 py-1" value={maxCoi} onChange={(e) => setMaxCoi(Number(e.target.value))}>
            <option value={0.0625}>6.25% (first cousins)</option>
            <option value={0.125}>12.5% (half siblings)</option>
            <option value={0.25}>25% (full siblings / parent × child)</option>
            <option value={1}>show all</option>
          </select>
        </label>
      </div>

      {shown && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">
            Ranked pairings {hiddenByCoi > 0 && <span className="text-sm font-normal text-neutral-500">({hiddenByCoi} hidden by COI limit)</span>}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Cock</th>
                  <th className="px-3 py-2">Hen</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Projected COI</th>
                  <th className="px-3 py-2">Evidence</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, SHOW_LIMIT).map((r, i) => {
                  const id = `${r.sireKey}|${r.damKey}`;
                  return (
                    <Fragment key={id}>
                      <tr className="cursor-pointer border-t hover:bg-neutral-50" onClick={() => setExpanded(expanded === id ? undefined : id)}>
                        <td className="px-3 py-2 text-neutral-400">{i + 1}</td>
                        <td className="px-3 py-2">{label(graph, r.sireKey)}</td>
                        <td className="px-3 py-2">{label(graph, r.damKey)}</td>
                        <td className="px-3 py-2 font-semibold">{r.score === undefined ? '—' : r.score.toFixed(0)}</td>
                        <td className={`px-3 py-2 ${coiStyle(r.coi)}`}>{pct(r.coi, 2)}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${evidenceStyle[r.evidence]}`}>{r.evidence}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-600">{r.notes[0]}</td>
                      </tr>
                      {expanded === id && (
                        <tr className="border-t bg-neutral-50">
                          <td colSpan={7} className="px-3 py-3">
                            <div className="grid gap-4 text-sm md:grid-cols-3">
                              <PerfBlock title="Cock" perf={r.sirePerf} graph={graph} />
                              <PerfBlock title="Hen" perf={r.damPerf} graph={graph} />
                              <div>
                                <div className="font-semibold">Common ancestors</div>
                                {r.commonAncestors.length ? (
                                  <ul className="text-neutral-600">
                                    {r.commonAncestors.map((c) => (
                                      <li key={c.key}>
                                        {label(graph, c.key)} — {pct(c.contribution, 2)} of COI
                                        {c.percentile !== undefined && <span className="text-neutral-400"> (own record {pct(c.percentile)})</span>}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-neutral-500">None found in the data on hand — an outcross, or the pedigrees don't go deep enough to tell.</p>
                                )}
                                {r.notes.length > 0 && (
                                  <ul className="mt-2 list-disc pl-4 text-xs text-neutral-600">
                                    {r.notes.map((n, j) => (
                                      <li key={j}>{n}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length > SHOW_LIMIT && <p className="mt-2 text-xs text-neutral-500">Showing the top {SHOW_LIMIT} of {shown.length}.</p>}
          {shown.length === 0 && <p className="mt-2 text-sm text-neutral-500">Every pairing exceeds the COI limit.</p>}
        </section>
      )}
    </div>
  );
}
