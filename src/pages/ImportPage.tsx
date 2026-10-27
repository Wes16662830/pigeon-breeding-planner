import { useMemo, useState } from 'react';
import { importBirdRows, type ImportResult } from '../lib/api';
import { guessMapping, IMPORT_FIELDS, parseCsv, rowsToImport, type ColumnMapping, type ImportField } from '../../shared/importBirds';

// Bulk import from another program's export (PigeonDB → a list → "Export to
// CSV", or any spreadsheet saved as CSV). Columns are matched by name
// automatically; anything it guessed wrong can be re-pointed before import.
// Scanned/printed pedigrees still go through New Pedigree instead.

const CHUNK = 150;

export default function ImportPage({ onDone }: { onDone: () => void }) {
  const [fileName, setFileName] = useState<string>();
  const [table, setTable] = useState<string[][]>();
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();

  async function onFile(file: File) {
    setError(undefined);
    setResult(undefined);
    if (/\.xlsx?$/i.test(file.name)) {
      setError('That is an Excel file. In Excel use File → Save As → "CSV (Comma delimited)", then choose the .csv here.');
      return;
    }
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setError('No data rows found — the file needs a header row and at least one bird.');
      return;
    }
    setFileName(file.name);
    setTable(rows);
    setMapping(guessMapping(rows[0]));
  }

  const header = table?.[0] ?? [];
  const parsed = useMemo(() => (table ? rowsToImport(table.slice(1), mapping) : undefined), [table, mapping]);
  const unknownSex = parsed?.rows.filter((r) => r.sex === 'unknown').length ?? 0;

  function setField(field: ImportField, value: string) {
    setMapping((m) => {
      const next = { ...m };
      if (value === '') delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  async function runImport() {
    if (!parsed || !fileName) return;
    setBusy(true);
    setError(undefined);
    const total: ImportResult = { created: 0, updated: 0, placeholderParents: 0, parentConflicts: [] };
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, parsed.rows.length)} of ${parsed.rows.length}…`);
        const r = await importBirdRows(fileName, parsed.rows.slice(i, i + CHUNK));
        total.created += r.created;
        total.updated += r.updated;
        total.placeholderParents += r.placeholderParents;
        total.parentConflicts.push(...r.parentConflicts);
      }
      setResult(total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import birds from a spreadsheet</h1>
        <p className="mt-1 text-sm text-neutral-500">
          From PigeonDB: add the birds to a list, then use <b>Export to CSV</b>. Any other program or an Excel sheet works too — save it as CSV. One row
          per bird; sire and dam ring columns link the family together. Re-importing the same export later updates those birds instead of duplicating
          them, and keeps any markers you've added by hand.
        </p>
      </div>

      <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {error && <p className="text-sm text-red-600">{error}</p>}

      {table && parsed && !result && (
        <>
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="mb-1 font-semibold">Match columns</h2>
            <p className="mb-3 text-xs text-neutral-500">Matched automatically by column name — check them. Ring is the only one required.</p>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              {IMPORT_FIELDS.map(({ field, label }) => (
                <label key={field} className="flex items-center justify-between gap-2">
                  <span className={field === 'ring' ? 'font-semibold' : ''}>{label}</span>
                  <select
                    className={`w-48 rounded border px-2 py-1 ${mapping[field] === undefined ? 'text-neutral-400' : ''}`}
                    value={mapping[field] ?? ''}
                    onChange={(e) => setField(field, e.target.value)}
                  >
                    <option value="">— not in file —</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Preview (first 5 of {parsed.rows.length})</h2>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2">Ring</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Sex</th>
                    <th className="px-3 py-2">Sire</th>
                    <th className="px-3 py-2">Dam</th>
                    <th className="px-3 py-2">Markers</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono">{r.ring}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className={`px-3 py-2 ${r.sex === 'unknown' ? 'text-red-600' : ''}`}>{r.sex}</td>
                      <td className="px-3 py-2 font-mono">{r.sireRing}</td>
                      <td className="px-3 py-2 font-mono">{r.damRing}</td>
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {Object.entries(r.markers)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-2 text-xs text-neutral-500">
              {parsed.skipped > 0 && <li>{parsed.skipped} row(s) have no ring and will be skipped.</li>}
              {unknownSex > 0 && <li className="text-red-600">{unknownSex} bird(s) with no recognised sex — they'll show as "sex unknown" in the Pairing Planner until set.</li>}
              {mapping.sireRing === undefined && mapping.damRing === undefined && (
                <li className="text-red-600">No sire/dam columns matched — birds will import without family links, so inbreeding can't be calculated.</li>
              )}
            </ul>
          </section>

          <button
            className="rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: '#D19A45' }}
            disabled={busy || mapping.ring === undefined || parsed.rows.length === 0}
            onClick={runImport}
          >
            {busy ? progress : `Import ${parsed.rows.length} bird${parsed.rows.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}

      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-semibold">Import complete.</p>
          <p>
            {result.created} new bird{result.created === 1 ? '' : 's'}, {result.updated} updated
            {result.placeholderParents > 0 && `, ${result.placeholderParents} parent${result.placeholderParents === 1 ? '' : 's'} added from sire/dam columns (ring only — fill in from the Bird Library)`}.
          </p>
          {result.parentConflicts.length > 0 && (
            <p className="mt-2 text-red-700">
              Parents in this file don't match a scanned pedigree already on file for: {result.parentConflicts.join(', ')}. Both records are kept — check
              which is right in the Bird Library.
            </p>
          )}
          <button className="mt-2 underline" onClick={onDone}>
            Open the Bird Library
          </button>
        </div>
      )}
    </div>
  );
}
