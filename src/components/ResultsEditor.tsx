import { useRef, useState } from 'react';
import type { Result } from '../../shared/types';
import { extractRaceResults } from '../lib/api';

// The race-results editor, shared by the Phase 2 / post-merge BirdEditor and
// by the merge form's "child's own results" section — extracted here so a
// child's results are entered through the exact same rows, paste-to-extract
// zone, and "unrecorded" affordances as any other bird's, rather than the
// two drifting apart.

export function ResultRow({ result, onChange, onRemove }: { result: Result; onChange: (r: Result) => void; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-6 gap-1 rounded border border-neutral-200 p-2 text-xs">
      <input className="col-span-2 rounded border px-1 py-0.5" placeholder="race" value={result.race} onChange={(e) => onChange({ ...result, race: e.target.value })} />
      <input
        className="rounded border px-1 py-0.5"
        placeholder="year"
        type="number"
        value={result.year ?? ''}
        onChange={(e) => onChange({ ...result, year: e.target.value ? Number(e.target.value) : undefined })}
      />
      <input
        className="rounded border px-1 py-0.5"
        placeholder="position"
        type="number"
        value={result.position ?? ''}
        onChange={(e) => onChange({ ...result, position: e.target.value ? Number(e.target.value) : undefined })}
      />
      <input
        className="rounded border px-1 py-0.5"
        placeholder="pool"
        type="number"
        value={result.poolSize ?? ''}
        onChange={(e) => onChange({ ...result, poolSize: e.target.value ? Number(e.target.value) : undefined })}
      />
      <button onClick={onRemove} className="rounded border border-red-200 px-1 text-red-600 hover:bg-red-50">
        remove
      </button>
      <select
        className="col-span-2 rounded border px-1 py-0.5"
        value={result.raceType ?? ''}
        onChange={(e) => onChange({ ...result, raceType: (e.target.value || undefined) as Result['raceType'] })}
      >
        <option value="">race type…</option>
        <option value="club">club</option>
        <option value="federation">federation</option>
        <option value="national">national</option>
        <option value="olr">one-loft race (OLR)</option>
      </select>
      <input
        className="rounded border px-1 py-0.5"
        placeholder="km"
        type="number"
        value={result.distanceKm ?? ''}
        onChange={(e) => onChange({ ...result, distanceKm: e.target.value ? Number(e.target.value) : undefined })}
      />
      <input
        className="col-span-3 rounded border px-1 py-0.5"
        placeholder="federation / organiser"
        value={result.federation ?? ''}
        onChange={(e) => onChange({ ...result, federation: e.target.value || undefined })}
      />
      <input
        className="col-span-6 rounded border px-1 py-0.5 font-mono"
        placeholder="verbatim source text"
        value={result.raw}
        onChange={(e) => onChange({ ...result, raw: e.target.value })}
      />
      {result.position === undefined && (
        <p className="col-span-6 fill">No position/pool recorded — will render as an unrecorded placeholder, not omitted.</p>
      )}
    </div>
  );
}

// Paste (Ctrl+V) or upload a screenshot of a race-history table — e.g. a
// oneloft results extract — and get its rows parsed straight into the
// Results list below, instead of typing each race in by hand. Extracted
// rows land as ordinary editable ResultRow entries, so nothing here
// bypasses the usual "review what the model read" step (build brief §7).
export function ResultsPasteZone({ onExtracted }: { onExtracted: (results: Result[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const { results, extractionNotes } = await extractRaceResults(file);
      if (!results.length) {
        setError('No race rows found in that image — try a clearer screenshot.');
        return;
      }
      onExtracted(results);
      if (extractionNotes) setNote(extractionNotes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed');
    } finally {
      setBusy(false);
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      handleFile(file);
    }
  }

  return (
    <div
      tabIndex={0}
      onPaste={onPaste}
      onClick={(e) => e.stopPropagation()}
      className="rounded-md border-2 border-dashed border-neutral-300 p-2 text-center text-xs text-neutral-500 focus:border-neutral-500 focus:outline-none"
    >
      {busy ? (
        'Extracting race rows…'
      ) : (
        <>
          Click here, then paste (Ctrl+V) a race-results screenshot, or{' '}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
            className="underline hover:text-neutral-700"
          >
            upload one
          </button>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {error && <p className="mt-1 text-red-600">{error}</p>}
      {note && <p className="mt-1 italic text-neutral-400">Model note: {note}</p>}
    </div>
  );
}

// Paste zone + editable rows + "add result", as one block. Callers own the
// array and get a new one back on every change.
export function ResultsEditor({
  results,
  onChange,
  label = 'Results',
}: {
  results: Result[];
  onChange: (results: Result[]) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-neutral-500">{label}</span>
      <ResultsPasteZone onExtracted={(extracted) => onChange([...results, ...extracted])} />
      {results.map((r, i) => (
        <ResultRow
          key={i}
          result={r}
          onChange={(nr) => onChange(results.map((rr, ii) => (ii === i ? nr : rr)))}
          onRemove={() => onChange(results.filter((_, ii) => ii !== i))}
        />
      ))}
      <button type="button" className="text-xs text-neutral-500 underline" onClick={() => onChange([...results, { race: '', raw: '' }])}>
        + add result
      </button>
    </div>
  );
}
