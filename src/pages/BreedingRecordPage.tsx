import { Fragment, useEffect, useMemo, useState } from 'react';
import { addYoungster, createPairing, deletePairing, getAllBirds, getPairings, updateBird, updatePairing } from '../lib/api';
import type { Bird, Pairing, PairingStatus, Result, Sex } from '../../shared/types';
import { buildIdentityGraph, identityKeyOf, rankPairings } from '../../shared/pairing';
import {
  breederRecords,
  checkPredictions,
  MIN_PAIRS_FOR_CORRELATION,
  outcomeOf,
  youngstersByPairing,
  type PairingOutcome,
} from '../../shared/breedingRecord';
import { ResultsEditor } from '../components/ResultsEditor';

// Breeding record — the pairings actually made, the youngsters from each,
// and how they raced. This is the data that tells you which birds really
// breed winners, and whether the Pairing Planner's predictions hold up.

// One decimal near the top so "3rd of 600" (99.7%) doesn't read as a win.
const pct = (n?: number) => (n === undefined ? '—' : `${(n * 100).toFixed(n > 0.99 && n < 1 ? 1 : 0)}%`);

function birdLabel(b?: Bird) {
  if (!b) return '(missing bird)';
  return b.name ? `${b.ring} "${b.name}"` : b.ring;
}

export default function BreedingRecordPage() {
  const [birds, setBirds] = useState<Bird[]>();
  const [pairings, setPairings] = useState<Pairing[]>();
  const [error, setError] = useState<string>();
  const [seasonFilter, setSeasonFilter] = useState<number | 'all'>('all');
  const [openYoungster, setOpenYoungster] = useState<string>();

  function reload() {
    return Promise.all([getAllBirds(), getPairings()])
      .then(([b, p]) => {
        setBirds(b);
        setPairings(p);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }
  useEffect(() => {
    reload();
  }, []);

  const graph = useMemo(() => buildIdentityGraph(birds ?? []), [birds]);
  const byId = useMemo(() => new Map((birds ?? []).map((b) => [b.id, b])), [birds]);
  const outcomes = useMemo(() => {
    const map = new Map<string, PairingOutcome>();
    if (!birds || !pairings) return map;
    for (const [id, keys] of youngstersByPairing(pairings, birds, graph)) map.set(id, outcomeOf(keys, graph));
    return map;
  }, [birds, pairings, graph]);
  const breeders = useMemo(() => breederRecords(graph).filter((b) => b.raced > 0).slice(0, 15), [graph]);
  const check = useMemo(() => checkPredictions(pairings ?? [], outcomes), [pairings, outcomes]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!birds || !pairings) return <p className="text-sm text-neutral-500">Loading…</p>;

  const seasons = [...new Set(pairings.map((p) => p.season))].sort((a, b) => b - a);
  const shown = pairings.filter((p) => seasonFilter === 'all' || p.season === seasonFilter);

  // Results are saved as they're typed (same as the Bird Library), so patch
  // local state rather than reloading everything per keystroke.
  function saveResults(rowId: string, results: Result[]) {
    setBirds((prev) => prev?.map((b) => (b.id === rowId ? { ...b, results } : b)));
    updateBird(rowId, { results }).catch((e) => setError(e instanceof Error ? e.message : 'Save failed'));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Breeding record</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Record each pairing you make and the youngsters it produces, then their race results. Over a few seasons this shows which birds actually breed
          winners — and whether the Pairing Planner's predictions are worth trusting. Only results with a position <b>and</b> field size count.
        </p>
      </div>

      <NewPairingForm birds={birds} onCreated={reload} />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Pairings ({shown.length})</h2>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {shown.length === 0 && (
          <p className="text-sm text-neutral-500">No pairings recorded yet. Add one above, or use "Record this pairing" in the Pairing Planner.</p>
        )}
        <div className="space-y-4">
          {shown.map((p) => (
            <PairingCard
              key={p.id}
              pairing={p}
              sire={byId.get(p.sireId)}
              dam={byId.get(p.damId)}
              outcome={outcomes.get(p.id)}
              openYoungster={openYoungster}
              onToggleYoungster={(k) => setOpenYoungster(openYoungster === k ? undefined : k)}
              resultsFor={(rowId) => byId.get(rowId)?.results ?? []}
              onSaveResults={saveResults}
              onChanged={reload}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Proven breeders</h2>
        <p className="mb-2 text-xs text-neutral-500">
          Every bird with raced youngsters on file (from any mate, however they were entered), ranked by how those youngsters performed. The ranking pulls
          birds with only one or two raced youngsters toward average — one good youngster is luck as often as it's breeding.
        </p>
        {breeders.length === 0 ? (
          <p className="text-sm text-neutral-500">No youngsters with scorable results yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Bird</th>
                  <th className="px-3 py-2">Sex</th>
                  <th className="px-3 py-2">Youngsters</th>
                  <th className="px-3 py-2">Raced</th>
                  <th className="px-3 py-2">Avg youngster result</th>
                  <th className="px-3 py-2">Top-10% youngsters</th>
                  <th className="px-3 py-2">Mates</th>
                </tr>
              </thead>
              <tbody>
                {breeders.map((b) => (
                  <tr key={b.key} className="border-t">
                    <td className="px-3 py-2">{b.name ? `${b.ring} "${b.name}"` : b.ring}</td>
                    <td className="px-3 py-2">{b.sex}</td>
                    <td className="px-3 py-2">{b.youngsters}</td>
                    <td className="px-3 py-2">{b.raced}</td>
                    <td className="px-3 py-2 font-semibold">
                      {pct(b.progenyIndex)}
                      {b.raced < 3 && <span className="ml-1 text-xs font-normal text-red-600">few raced</span>}
                    </td>
                    <td className="px-3 py-2">{b.topTen}</td>
                    <td className="px-3 py-2">{b.mates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Is the Pairing Planner right?</h2>
        <p className="mb-2 text-xs text-neutral-500">
          Pairings recorded from the planner keep the score it gave at the time. Once their youngsters race, this compares the prediction with what happened.
        </p>
        {check.pairs.length === 0 ? (
          <p className="text-sm text-neutral-500">No planner-recorded pairings with raced youngsters yet.</p>
        ) : (
          <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
            {check.spearman === undefined ? (
              <p>
                {check.pairs.length} pairing{check.pairs.length === 1 ? '' : 's'} so far — need at least {MIN_PAIRS_FOR_CORRELATION} before a comparison means
                anything, and 15–20 before it means much.
              </p>
            ) : (
              <p>
                Over {check.pairs.length} pairings, rank correlation between predicted and actual: <b>{check.spearman.toFixed(2)}</b>{' '}
                <span className="text-neutral-500">
                  ({check.spearman >= 0.4 ? 'the planner is picking up something real' : check.spearman >= 0.15 ? 'weak — slightly better than chance' : 'no better than chance so far'}
                  {check.pairs.length < 15 && '; still a small sample'})
                </span>
              </p>
            )}
            <ul className="mt-2 text-xs text-neutral-600">
              {check.pairs.map((cp) => {
                const p = pairings.find((x) => x.id === cp.pairingId)!;
                return (
                  <li key={cp.pairingId}>
                    {p.season}: {birdLabel(byId.get(p.sireId))} × {birdLabel(byId.get(p.damId))} — predicted {pct(cp.predicted)}, youngsters averaged {pct(cp.actual)}{' '}
                    ({cp.raced} raced)
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function NewPairingForm({ birds, onCreated }: { birds: Bird[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [sireId, setSireId] = useState('');
  const [damId, setDamId] = useState('');
  const [season, setSeason] = useState(new Date().getFullYear());
  const [pairedOn, setPairedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // One row per physical bird, verified records only.
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return birds
      .filter((b) => b.verified)
      .filter((b) => {
        const k = identityKeyOf(b);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.ring.localeCompare(b.ring));
  }, [birds]);
  const graph = useMemo(() => buildIdentityGraph(birds), [birds]);

  const coi = useMemo(() => {
    const s = birds.find((b) => b.id === sireId);
    const d = birds.find((b) => b.id === damId);
    if (!s || !d || s.id === d.id) return undefined;
    return rankPairings([identityKeyOf(s)], [identityKeyOf(d)], graph)[0]?.coi;
  }, [sireId, damId, birds, graph]);

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await createPairing({ sireId, damId, season, pairedOn: pairedOn || undefined, notes: notes || undefined, status: 'active' });
      setSireId('');
      setDamId('');
      setNotes('');
      setPairedOn('');
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="rounded px-4 py-2 text-sm font-semibold text-white" style={{ background: '#D19A45' }} onClick={() => setOpen(true)}>
        + Record a pairing
      </button>
    );
  }

  const option = (b: Bird) => (
    <option key={b.id} value={b.id}>
      {birdLabel(b)}
      {b.sex === 'unknown' ? ' (sex unknown)' : ''}
    </option>
  );

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <label>
          <span className="block text-xs text-neutral-500">Cock</span>
          <select className="w-full rounded border px-2 py-1" value={sireId} onChange={(e) => setSireId(e.target.value)}>
            <option value="">Choose…</option>
            {candidates.filter((b) => b.sex !== 'hen').map(option)}
          </select>
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Hen</span>
          <select className="w-full rounded border px-2 py-1" value={damId} onChange={(e) => setDamId(e.target.value)}>
            <option value="">Choose…</option>
            {candidates.filter((b) => b.sex !== 'cock').map(option)}
          </select>
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Season</span>
          <input type="number" className="w-full rounded border px-2 py-1" value={season} onChange={(e) => setSeason(Number(e.target.value))} />
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Paired on (optional)</span>
          <input type="date" className="w-full rounded border px-2 py-1" value={pairedOn} onChange={(e) => setPairedOn(e.target.value)} />
        </label>
        <label className="md:col-span-2">
          <span className="block text-xs text-neutral-500">Notes (optional)</span>
          <input className="w-full rounded border px-2 py-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {coi !== undefined && (
        <p className={`mt-2 text-sm ${coi >= 0.125 ? 'font-semibold text-red-600' : coi >= 0.0625 ? 'text-amber-600' : 'text-neutral-600'}`}>
          Projected COI of the youngsters: {(coi * 100).toFixed(2)}%
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          className="rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: '#D19A45' }}
          disabled={busy || !sireId || !damId}
          onClick={submit}
        >
          Save pairing
        </button>
        <button className="rounded border px-4 py-2 text-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

interface CardProps {
  pairing: Pairing;
  sire?: Bird;
  dam?: Bird;
  outcome?: PairingOutcome;
  openYoungster?: string;
  onToggleYoungster: (key: string) => void;
  resultsFor: (rowId: string) => Result[];
  onSaveResults: (rowId: string, results: Result[]) => void;
  onChanged: () => void;
}

function PairingCard({ pairing: p, sire, dam, outcome, openYoungster, onToggleYoungster, resultsFor, onSaveResults, onChanged }: CardProps) {
  const [ring, setRing] = useState('');
  const [sex, setSex] = useState<Sex>('unknown');
  const [colour, setColour] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function add() {
    setBusy(true);
    setError(undefined);
    try {
      await addYoungster(p.id, { ring, sex, colour });
      setRing('');
      setColour('');
      setSex('unknown');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: PairingStatus) {
    try {
      await updatePairing(p.id, { status });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  }

  async function remove() {
    if (!confirm('Delete this pairing record? Its youngsters stay on file as birds.')) return;
    try {
      await deletePairing(p.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {birdLabel(sire)} × {birdLabel(dam)}
          </div>
          <div className="text-xs text-neutral-500">
            Season {p.season}
            {p.pairedOn && ` · paired ${p.pairedOn}`}
            {p.prediction && ` · planner predicted ${p.prediction.score === undefined ? 'no score' : p.prediction.score.toFixed(0)} (${p.prediction.evidence} evidence), COI ${(p.prediction.coi * 100).toFixed(2)}%`}
          </div>
          {p.notes && <div className="text-xs text-neutral-600">{p.notes}</div>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <select className="rounded border px-2 py-1" value={p.status} onChange={(e) => setStatus(e.target.value as PairingStatus)}>
            <option value="planned">planned</option>
            <option value="active">active</option>
            <option value="ended">ended</option>
          </select>
          <button className="text-xs text-neutral-400 underline hover:text-red-600" onClick={remove}>
            delete
          </button>
        </div>
      </div>

      {outcome && outcome.youngsters.length > 0 && (
        <>
          <p className="mt-3 text-sm">
            <b>{outcome.youngsters.length}</b> youngster{outcome.youngsters.length === 1 ? '' : 's'}, <b>{outcome.raced}</b> raced
            {outcome.meanIndex !== undefined && (
              <>
                , averaging <b>{pct(outcome.meanIndex)}</b>
              </>
            )}
            {outcome.topTen > 0 && `, ${outcome.topTen} with a top-10% result`}
          </p>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="py-1">Youngster</th>
                <th className="py-1">Sex</th>
                <th className="py-1">Scored races</th>
                <th className="py-1">Average</th>
                <th className="py-1">Best</th>
              </tr>
            </thead>
            <tbody>
              {outcome.youngsters.map((y) => (
                <Fragment key={y.key}>
                  <tr className="cursor-pointer border-t hover:bg-neutral-50" onClick={() => onToggleYoungster(y.key)}>
                    <td className="py-1 font-mono">
                      {y.ring} {y.name && <span className="font-sans">"{y.name}"</span>}
                    </td>
                    <td className={`py-1 ${y.sex === 'unknown' ? 'text-red-600' : ''}`}>{y.sex}</td>
                    <td className="py-1">{y.scorable}</td>
                    <td className="py-1">{pct(y.meanPercentile)}</td>
                    <td className="py-1 text-xs text-neutral-600">{y.bestRaw ?? '—'}</td>
                  </tr>
                  {openYoungster === y.key && (
                    <tr>
                      <td colSpan={5} className="bg-neutral-50 p-2">
                        <ResultsEditor results={resultsFor(y.rowId)} onChange={(r) => onSaveResults(y.rowId, r)} label={`Results for ${y.ring}`} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-neutral-400">Click a youngster to enter its race results.</p>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label>
          <span className="block text-xs text-neutral-500">Youngster ring</span>
          <input className="w-48 rounded border px-2 py-1 font-mono" placeholder={`ZA … ${p.season}`} value={ring} onChange={(e) => setRing(e.target.value)} />
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Sex</span>
          <select className="rounded border px-2 py-1" value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
            <option value="unknown">unknown</option>
            <option value="cock">cock</option>
            <option value="hen">hen</option>
          </select>
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Colour</span>
          <input className="w-28 rounded border px-2 py-1" value={colour} onChange={(e) => setColour(e.target.value)} />
        </label>
        <button className="rounded border px-3 py-1 font-semibold hover:bg-neutral-50 disabled:opacity-40" disabled={busy || !ring.trim()} onClick={add}>
          Add youngster
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
