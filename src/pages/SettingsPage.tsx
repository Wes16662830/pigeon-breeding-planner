import { useEffect, useRef, useState } from 'react';
import { clearApiKey, clearLoftLogo, getBackup, getSettings, restoreBackup, saveApiKey, saveLoftSettings, type SettingsInfo } from '../lib/api';
import type { RestoreSummary } from '../../shared/backup';

const MAX_LOGO_BYTES = 1024 * 1024; // must match server/worker MAX_LOGO_BYTES

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export default function SettingsPage() {
  const [info, setInfo] = useState<SettingsInfo>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [savedJustNow, setSavedJustNow] = useState(false);

  const [loftName, setLoftName] = useState('');
  const [loftSubtitle, setLoftSubtitle] = useState('');
  const [loftAddress, setLoftAddress] = useState('');
  const [loftPhone, setLoftPhone] = useState('');
  const [loftEmail, setLoftEmail] = useState('');
  const [loftLogoScale, setLoftLogoScale] = useState(100); // % of each template's own base logo size
  const [loftBusy, setLoftBusy] = useState(false);
  const [loftError, setLoftError] = useState<string>();
  const [loftSavedJustNow, setLoftSavedJustNow] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string>();
  const [restoreSummary, setRestoreSummary] = useState<RestoreSummary>();
  const restoreInputRef = useRef<HTMLInputElement>(null);

  function load() {
    getSettings()
      .then((s) => {
        setInfo(s);
        setLoftName(s.loft.name ?? '');
        setLoftSubtitle(s.loft.subtitle ?? '');
        setLoftAddress(s.loft.address ?? '');
        setLoftPhone(s.loft.phone ?? '');
        setLoftEmail(s.loft.email ?? '');
        const scale = Number(s.loft.logoScale);
        setLoftLogoScale(Number.isFinite(scale) && scale > 0 ? Math.round(scale * 100) : 100);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load settings'));
  }

  useEffect(load, []);

  async function save() {
    if (!input.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await saveApiKey(input.trim());
      setInfo(updated);
      setInput('');
      setSavedJustNow(true);
      setTimeout(() => setSavedJustNow(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save key');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(undefined);
    try {
      setInfo(await clearApiKey());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear key');
    } finally {
      setBusy(false);
    }
  }

  async function saveLoft() {
    setLoftBusy(true);
    setLoftError(undefined);
    try {
      const updated = await saveLoftSettings({ loftName, loftSubtitle, loftAddress, loftPhone, loftEmail, loftLogoScale: (loftLogoScale / 100).toFixed(2) });
      setInfo(updated);
      setLoftSavedJustNow(true);
      setTimeout(() => setLoftSavedJustNow(false), 3000);
    } catch (e) {
      setLoftError(e instanceof Error ? e.message : 'Failed to save loft details');
    } finally {
      setLoftBusy(false);
    }
  }

  async function onLogoFile(file: File) {
    if (file.size > MAX_LOGO_BYTES) {
      setLoftError(`Logo must be under ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`);
      return;
    }
    setLoftBusy(true);
    setLoftError(undefined);
    try {
      const dataUrl = await fileToDataUrl(file);
      const updated = await saveLoftSettings({ loftLogoDataUrl: dataUrl });
      setInfo(updated);
    } catch (e) {
      setLoftError(e instanceof Error ? e.message : 'Failed to upload logo');
    } finally {
      setLoftBusy(false);
    }
  }

  async function removeLogo() {
    setLoftBusy(true);
    setLoftError(undefined);
    try {
      setInfo(await clearLoftLogo());
    } catch (e) {
      setLoftError(e instanceof Error ? e.message : 'Failed to remove logo');
    } finally {
      setLoftBusy(false);
    }
  }

  async function downloadBackup() {
    setBackupBusy(true);
    setBackupError(undefined);
    setRestoreSummary(undefined);
    try {
      const backup = await getBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pedigree-builder-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromFile(file: File) {
    setBackupBusy(true);
    setBackupError(undefined);
    setRestoreSummary(undefined);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const summary = await restoreBackup(parsed);
      setRestoreSummary(summary);
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : 'Restore failed — is this a Pedigree Builder backup file?');
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-2xl font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Your Anthropic API key, used for pedigree extraction and prose generation. It's stored server-side and never sent to any browser other than
        yours — this page only ever shows the last few characters back to you.
      </p>

      {info && (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          {info.hasApiKey ? (
            <p>
              <span className="text-green-600">●</span> API key configured
              {info.apiKeyPreview && (
                <>
                  {' '}
                  (<span className="font-mono">{info.apiKeyPreview}</span>)
                </>
              )}
              {info.source === 'env' && <span className="text-neutral-500"> — from the server's environment, not yet overridden here</span>}
            </p>
          ) : (
            <p>
              <span className="text-red-600">●</span> No API key configured yet. Extraction and prose generation will fail until one is set below.
            </p>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
        <label className="block">
          <span className="block text-xs text-neutral-500">Anthropic API key</span>
          <input
            type="password"
            autoComplete="off"
            className="w-full rounded border px-2 py-1.5 font-mono"
            placeholder="sk-ant-..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy || !input.trim()}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: '#111111' }}
          >
            {busy ? 'Saving…' : 'Save key'}
          </button>
          {info?.source === 'settings' && (
            <button onClick={clear} disabled={busy} className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">
              Remove saved key
            </button>
          )}
          {savedJustNow && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <p className="mt-6 text-xs text-neutral-400">
        Get a key at{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline">
          console.anthropic.com/settings/keys
        </a>
        .
      </p>

      <h2 className="mb-1 mt-10 text-xl font-semibold">Loft branding</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Shown in the header of every rendered pedigree sheet. Leave blank to keep the OudeLuck defaults.
      </p>

      <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="flex items-center gap-4">
          {info?.loft.logoDataUrl ? (
            <img src={info.loft.logoDataUrl} alt="loft logo" className="h-16 w-16 rounded border border-neutral-100 object-contain" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded bg-neutral-100 text-xs text-neutral-400">no logo</div>
          )}
          <div className="flex flex-col gap-1">
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={loftBusy}
              className="rounded border px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
            >
              {info?.loft.logoDataUrl ? 'Replace logo' : 'Upload logo'}
            </button>
            {info?.loft.logoDataUrl && (
              <button onClick={removeLogo} disabled={loftBusy} className="text-xs text-neutral-400 underline hover:text-red-600 disabled:opacity-40">
                Remove
              </button>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onLogoFile(file);
              }}
            />
          </div>
        </div>

        <label className="block">
          <span className="flex items-center justify-between text-xs text-neutral-500">
            <span>Logo size</span>
            <span className="font-mono">{loftLogoScale}%</span>
          </span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={50}
              max={200}
              step={5}
              value={loftLogoScale}
              onChange={(e) => setLoftLogoScale(Number(e.target.value))}
              className="w-full"
            />
            {loftLogoScale !== 100 && (
              <button type="button" onClick={() => setLoftLogoScale(100)} className="shrink-0 text-xs text-neutral-400 underline hover:text-neutral-700">
                Reset
              </button>
            )}
          </div>
          <span className="mt-1 block text-xs text-neutral-400">
            Scales the logo (or initials placeholder) in the header of every template — click "Save loft details" below to apply it.
          </span>
        </label>

        <label className="block">
          <span className="block text-xs text-neutral-500">Loft name</span>
          <input className="w-full rounded border px-2 py-1.5" placeholder="OudeLuck Lofts" value={loftName} onChange={(e) => setLoftName(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs text-neutral-500">Subtitle</span>
          <input className="w-full rounded border px-2 py-1.5" placeholder="OneLoft Genetics" value={loftSubtitle} onChange={(e) => setLoftSubtitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs text-neutral-500">Address</span>
          <input
            className="w-full rounded border px-2 py-1.5"
            placeholder="Athlone Farm, Tarkastad, Eastern Cape"
            value={loftAddress}
            onChange={(e) => setLoftAddress(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-neutral-500">Phone</span>
          <input
            type="tel"
            className="w-full rounded border px-2 py-1.5"
            placeholder="083 6979 536"
            value={loftPhone}
            onChange={(e) => setLoftPhone(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-neutral-500">Email</span>
          <input
            type="email"
            className="w-full rounded border px-2 py-1.5"
            placeholder="oudelucklofts@gmail.com"
            value={loftEmail}
            onChange={(e) => setLoftEmail(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={saveLoft}
            disabled={loftBusy}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: '#111111' }}
          >
            {loftBusy ? 'Saving…' : 'Save loft details'}
          </button>
          {loftSavedJustNow && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </div>

      {loftError && <p className="mt-3 text-sm text-red-600">{loftError}</p>}

      <h2 className="mb-1 mt-10 text-xl font-semibold">Backup</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Every bird, pedigree, folder, and loft setting as one JSON file — not photos or original scans, and never your API key. Restoring only
        adds/overwrites by id, so it's safe to run against a database that already has data in it; it never deletes anything.
      </p>

      <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={downloadBackup}
            disabled={backupBusy}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: '#111111' }}
          >
            {backupBusy ? 'Working…' : 'Download backup'}
          </button>
          <button
            onClick={() => restoreInputRef.current?.click()}
            disabled={backupBusy}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-40"
          >
            Restore from file…
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) restoreFromFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {restoreSummary && (
          <p className="text-sm text-green-600">
            Restored {restoreSummary.birds} bird{restoreSummary.birds === 1 ? '' : 's'}, {restoreSummary.folders} folder
            {restoreSummary.folders === 1 ? '' : 's'}, {restoreSummary.uploads} upload{restoreSummary.uploads === 1 ? '' : 's'},{' '}
            {restoreSummary.childPedigrees} pedigree{restoreSummary.childPedigrees === 1 ? '' : 's'} and {restoreSummary.pairings} pairing{restoreSummary.pairings === 1 ? '' : 's'}.
          </p>
        )}
        {backupError && <p className="text-sm text-red-600">{backupError}</p>}
      </div>
    </div>
  );
}
