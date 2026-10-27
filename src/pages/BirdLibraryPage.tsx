import { useEffect, useMemo, useState } from 'react';
import type { Bird } from '../../shared/types';
import { getAllBirds, getBirdAppearances, updateBird, type BirdAppearance } from '../lib/api';
import BirdEditor from '../components/BirdEditor';

// Every bird ever extracted or entered, independent of which pedigree
// sheets it appears on — search it, fix it up, add a photo, and see every
// sheet it shows up in (build brief follow-up: a library page for reuse).

interface Props {
  onOpenPedigree: (childPedigreeId: string) => void;
}

export default function BirdLibraryPage({ onOpenPedigree }: Props) {
  const [birds, setBirds] = useState<Bird[]>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [appearances, setAppearances] = useState<BirdAppearance[]>();
  const [appearancesError, setAppearancesError] = useState<string>();

  useEffect(() => {
    getAllBirds()
      .then((b) => {
        setBirds(b);
        if (b.length) setSelectedId(b[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setAppearances(undefined);
    setAppearancesError(undefined);
    getBirdAppearances(selectedId)
      .then(setAppearances)
      .catch((e) => setAppearancesError(e instanceof Error ? e.message : 'Failed to load appearances'));
  }, [selectedId]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!birds) return birds;
    if (!q) return [...birds].sort((a, b) => a.ring.localeCompare(b.ring));
    return birds
      .filter((b) =>
        [b.ring, b.name, b.markers?.family, b.markers?.strain].some((v) => (v ?? '').toLowerCase().includes(q)),
      ).sort((a, b) => a.ring.localeCompare(b.ring));
  }, [birds, q]);

  const selected = birds?.find((b) => b.id === selectedId);

  async function save(bird: Bird) {
    setBirds((prev) => prev?.map((b) => (b.id === bird.id ? bird : b)));
    try {
      await updateBird(bird.id, bird);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Bird library</h1>
      <p className="mb-6 text-sm text-neutral-500">Every bird on file, verified or not. Fix a record here and it updates everywhere it's used.</p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <input
            autoFocus
            className="mb-2 w-full rounded border px-2 py-1.5 text-sm"
            placeholder="Search by ring, name, family or strain…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-200 bg-white">
            {filtered && filtered.length === 0 && <p className="p-3 text-sm text-neutral-500">No birds match.</p>}
            {filtered?.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                className={`flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-neutral-50 ${
                  b.id === selectedId ? 'bg-neutral-100' : ''
                }`}
              >
                {b.photoUrl ? (
                  <img src={b.photoUrl} alt={b.ring} className="h-7 w-7 flex-shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-7 w-7 flex-shrink-0 rounded bg-neutral-100" />
                )}
                <span className="flex-1 truncate">
                  <span className="font-mono">{b.ring}</span>
                  {b.name && <span className="ml-1 text-neutral-500">"{b.name}"</span>}
                </span>
                {!b.verified && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">unverified</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <>
              <BirdEditor key={selected.id} bird={selected} onSave={save} showMarkers />

              <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-semibold">Appears on</h3>
                {appearancesError && <p className="text-xs text-red-600">{appearancesError}</p>}
                {!appearances && !appearancesError && <p className="text-xs text-neutral-500">Loading…</p>}
                {appearances && appearances.length === 0 && <p className="text-xs text-neutral-500">Not on any generated pedigree sheet yet.</p>}
                {appearances && appearances.length > 0 && (
                  <ul className="divide-y divide-neutral-100 text-sm">
                    {appearances.map((a) => (
                      <li key={a.childPedigreeId} className="flex items-center justify-between py-1.5">
                        <span>
                          <span className="font-mono">{a.childRing}</span>
                          {a.childName && <span className="ml-1 text-neutral-500">"{a.childName}"</span>}
                          <span className="ml-2 text-xs text-neutral-400">{a.asChild ? 'as the child' : 'as an ancestor'}</span>
                        </span>
                        <button onClick={() => onOpenPedigree(a.childPedigreeId)} className="text-xs text-neutral-500 underline hover:text-neutral-900">
                          Open sheet
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-500">{birds && birds.length === 0 ? 'No birds on file yet.' : 'Pick a bird from the list.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
