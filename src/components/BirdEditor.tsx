import { useEffect, useRef, useState } from 'react';
import type { Bird, Sex } from '../../shared/types';
import { CONFIDENCE_FLAG_THRESHOLD } from '../../shared/types';
import { deleteBirdPhoto, uploadBirdPhoto } from '../lib/api';
import { ResultsEditor } from './ResultsEditor';
import MarkersEditor from './MarkersEditor';

// The full bird field editor — ring/name/sex/colour/breeder/notes/results,
// plus an optional photo. Used both in Phase 2 verification (one card per
// ancestor, with a confidence badge and verify checkbox) and on the sheet
// page for editing the child bird's own details/results after merge
// (build brief follow-up: "edits to the results of the child").

function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface BirdEditorProps {
  bird: Bird;
  onSave: (b: Bird) => void;
  /** Click-to-highlight chrome, used by VerifyPage's split-screen list. */
  active?: boolean;
  onFocus?: () => void;
  /** Confidence badge + amber low-confidence background (VerifyPage only). */
  showConfidence?: boolean;
  /** Verified checkbox — omit to hide it entirely (e.g. editing a child bird, which is verified by construction). */
  onVerifyToggle?: (v: boolean) => void;
  /** Photo upload widget. Defaults on. */
  showPhoto?: boolean;
  /** Breeding/performance markers section. Off by default — it's for the loft's own birds, not for verifying a scan. */
  showMarkers?: boolean;
}

export default function BirdEditor({ bird, onSave, active, onFocus, showConfidence, onVerifyToggle, showPhoto = true, showMarkers = false }: BirdEditorProps) {
  const [local, setLocal] = useState(bird);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(bird), [bird.id]);

  const lowConfidence = showConfidence && local.confidence < CONFIDENCE_FLAG_THRESHOLD;

  function commit(patch: Partial<Bird>) {
    const next = { ...local, ...patch };
    setLocal(next);
    onSave(next);
  }

  async function handlePhotoFile(file: File) {
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      const { photoUrl } = await uploadBirdPhoto(local.id, file);
      commit({ photoUrl });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Photo upload failed');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handlePhotoRemove() {
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      await deleteBirdPhoto(local.id);
      commit({ photoUrl: undefined });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Failed to remove photo');
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div
      onClick={onFocus}
      className={`rounded-lg border p-3 transition ${active ? 'border-neutral-900 ring-2 ring-neutral-900' : 'border-neutral-200'} ${lowConfidence ? 'bg-amber-50' : 'bg-white'}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="truncate font-mono text-xs text-neutral-500">{bird.id}</span>
        {showConfidence && (
          <span className={`rounded px-1.5 py-0.5 text-xs ${lowConfidence ? 'bg-amber-200 text-amber-900' : 'bg-neutral-100 text-neutral-600'}`}>
            confidence {(local.confidence * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {showPhoto && (
        <div className="mb-3 flex items-center gap-3">
          {local.photoUrl ? (
            <img src={local.photoUrl} alt={local.ring} className="h-16 w-16 rounded object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded bg-neutral-100 text-xs text-neutral-400">no photo</div>
          )}
          <div className="flex flex-col gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
              disabled={photoBusy}
              className="rounded border px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
            >
              {photoBusy ? 'Uploading…' : local.photoUrl ? 'Replace photo' : 'Add photo'}
            </button>
            {local.photoUrl && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePhotoRemove();
                }}
                disabled={photoBusy}
                className="text-xs text-neutral-400 underline hover:text-red-600 disabled:opacity-40"
              >
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePhotoFile(file);
              }}
            />
          </div>
          {photoError && <p className="text-xs text-red-600">{photoError}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="col-span-2">
          <span className="block text-xs text-neutral-500">Ring (verbatim)</span>
          <input className="w-full rounded border px-2 py-1 font-mono" value={local.ring} onChange={(e) => commit({ ring: e.target.value })} onBlur={() => onSave(local)} />
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Name</span>
          <input className="w-full rounded border px-2 py-1" value={local.name ?? ''} onChange={(e) => commit({ name: e.target.value })} onBlur={() => onSave(local)} />
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Sex</span>
          <select
            className={`w-full rounded border px-2 py-1 ${local.sex === 'unknown' ? 'text-red-600' : ''}`}
            value={local.sex}
            onChange={(e) => {
              const sex = e.target.value as Sex;
              commit({ sex });
              onSave({ ...local, sex });
            }}
          >
            <option value="unknown">unknown</option>
            <option value="cock">cock</option>
            <option value="hen">hen</option>
          </select>
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Colour</span>
          <input className="w-full rounded border px-2 py-1" value={local.colour ?? ''} onChange={(e) => commit({ colour: e.target.value })} onBlur={() => onSave(local)} />
        </label>
        <label>
          <span className="block text-xs text-neutral-500">Breeder</span>
          <input className="w-full rounded border px-2 py-1" value={local.breeder ?? ''} onChange={(e) => commit({ breeder: e.target.value })} onBlur={() => onSave(local)} />
        </label>
        <label className="col-span-2">
          <span className="block text-xs text-neutral-500">Notes (verbatim source wording, one per line)</span>
          <textarea
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            rows={2}
            value={local.notes.join('\n')}
            onChange={(e) => commit({ notes: linesToArray(e.target.value) })}
            onBlur={() => onSave(local)}
          />
        </label>
        <label className="col-span-2">
          <span className="block text-xs text-neutral-500">English translation (only if source isn't English)</span>
          <textarea
            className="w-full rounded border px-2 py-1 text-xs"
            rows={2}
            value={(local.notesEn ?? []).join('\n')}
            onChange={(e) => commit({ notesEn: linesToArray(e.target.value) })}
            onBlur={() => onSave(local)}
          />
        </label>

        <div className="col-span-2">
          <ResultsEditor
            results={local.results}
            onChange={(results) => {
              commit({ results });
              onSave({ ...local, results });
            }}
          />
        </div>

        {showMarkers && (
          <details className="col-span-2 rounded border border-neutral-200 p-2" open={!!local.markers && Object.keys(local.markers).length > 0}>
            <summary className="cursor-pointer text-sm font-semibold">Breeding &amp; performance markers</summary>
            <MarkersEditor
              markers={local.markers}
              onChange={(markers) => {
                commit({ markers });
              }}
            />
          </details>
        )}
      </div>

      {onVerifyToggle && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={bird.verified} onChange={(e) => onVerifyToggle(e.target.checked)} />
          Verified against original
        </label>
      )}
    </div>
  );
}
