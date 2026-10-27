import { useEffect, useState } from 'react';
import type { BirdMarkers } from '../../shared/types';

// The fancier's own assessment of a bird — family/strain, type, performance
// and breeding record. Lives in BirdEditor; every field is optional, and a
// blank means "not assessed", never "poor".

type Props = { markers?: BirdMarkers; onChange: (m: BirdMarkers) => void };

const SCORE_FIELDS: { key: 'wingScore' | 'featherScore' | 'handlingScore'; label: string }[] = [
  { key: 'wingScore', label: 'Wing' },
  { key: 'featherScore', label: 'Feather' },
  { key: 'handlingScore', label: 'Handling' },
];

export default function MarkersEditor({ markers, onChange }: Props) {
  const [local, setLocal] = useState<BirdMarkers>(markers ?? {});
  useEffect(() => setLocal(markers ?? {}), [markers]);

  // Text fields update locally and save on blur; selects save immediately.
  const set = (patch: BirdMarkers) => setLocal((m) => ({ ...m, ...patch }));
  const save = (patch: BirdMarkers = {}) => onChange(clean({ ...local, ...patch }));
  const text = (key: keyof BirdMarkers, label: string, span = false) => (
    <label className={span ? 'col-span-2' : ''}>
      <span className="block text-xs text-neutral-500">{label}</span>
      <input className="w-full rounded border px-2 py-1" value={(local[key] as string | undefined) ?? ''} onChange={(e) => set({ [key]: e.target.value })} onBlur={() => save()} />
    </label>
  );
  const number = (key: 'acePoints' | 'prizePercent' | 'winningOffspring', label: string) => (
    <label>
      <span className="block text-xs text-neutral-500">{label}</span>
      <input
        type="number"
        className="w-full rounded border px-2 py-1"
        value={local[key] ?? ''}
        onChange={(e) => set({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })}
        onBlur={() => save()}
      />
    </label>
  );

  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <h4 className="col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Family &amp; strain</h4>
      {text('family', 'Family / line')}
      {text('strain', 'Strain')}
      {text('foundationBird', 'Foundation / champion ancestor', true)}

      <h4 className="col-span-2 mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Physical / type</h4>
      {text('eyeSign', 'Eye sign')}
      <label>
        <span className="block text-xs text-neutral-500">Size</span>
        <select className="w-full rounded border px-2 py-1" value={local.size ?? ''} onChange={(e) => save({ size: (e.target.value || undefined) as BirdMarkers['size'] })}>
          <option value="">—</option>
          <option value="small">small</option>
          <option value="medium">medium</option>
          <option value="large">large</option>
        </select>
      </label>
      {text('build', 'Build (e.g. short-coupled, long-cast)', true)}
      <div className="col-span-2 grid grid-cols-3 gap-2">
        {SCORE_FIELDS.map(({ key, label }) => (
          <label key={key}>
            <span className="block text-xs text-neutral-500">{label} (1–5)</span>
            <select className="w-full rounded border px-2 py-1" value={local[key] ?? ''} onChange={(e) => save({ [key]: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <h4 className="col-span-2 mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Performance</h4>
      <label>
        <span className="block text-xs text-neutral-500">Distance category</span>
        <select className="w-full rounded border px-2 py-1" value={local.category ?? ''} onChange={(e) => save({ category: (e.target.value || undefined) as BirdMarkers['category'] })}>
          <option value="">—</option>
          <option value="sprint">sprint</option>
          <option value="middle">middle</option>
          <option value="long">long</option>
          <option value="marathon">marathon</option>
        </select>
      </label>
      {number('acePoints', 'Ace points')}
      {number('prizePercent', 'Prize % (races prized)')}
      {text('bestPerformance', 'Best performance')}

      <h4 className="col-span-2 mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Breeding record</h4>
      <label>
        <span className="block text-xs text-neutral-500">Role</span>
        <select className="w-full rounded border px-2 py-1" value={local.role ?? ''} onChange={(e) => save({ role: (e.target.value || undefined) as BirdMarkers['role'] })}>
          <option value="">—</option>
          <option value="racer">racer</option>
          <option value="stock">stock</option>
          <option value="proven-breeder">proven breeder</option>
          <option value="young">young bird</option>
          <option value="retired">retired / gone</option>
        </select>
      </label>
      {number('winningOffspring', 'Winning youngsters bred')}
      {text('goodWith', 'Breeds well with (mates / lines)', true)}
      <label className="col-span-2">
        <span className="block text-xs text-neutral-500">Breeding notes</span>
        <textarea className="w-full rounded border px-2 py-1 text-xs" rows={2} value={local.breedingNotes ?? ''} onChange={(e) => set({ breedingNotes: e.target.value })} onBlur={() => save()} />
      </label>
    </div>
  );
}

function clean(m: BirdMarkers): BirdMarkers {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v)))) as BirdMarkers;
}
