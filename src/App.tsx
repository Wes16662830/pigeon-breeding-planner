import { useState } from 'react';
import type { ExtractResponse } from './lib/api';
import type { Bird } from '../shared/types';
import HomePage from './pages/HomePage';
import UploadPage from './pages/UploadPage';
import VerifyPage from './pages/VerifyPage';
import MergePage from './pages/MergePage';
import SheetPage from './pages/SheetPage';
import CrossReferencePage from './pages/CrossReferencePage';
import PairingPage from './pages/PairingPage';
import SettingsPage from './pages/SettingsPage';
import BirdLibraryPage from './pages/BirdLibraryPage';
import ErrorBoundary from './components/ErrorBoundary';

export type ParentSide = 'sire' | 'dam';

// A side is either mid-flow on a fresh upload (needs verification before
// it's usable) or an already-verified bird reused from the library —
// either way, once `ready` is true it can go straight into a merge.
export type ParentState =
  | { kind: 'upload'; uploadId: string; fileUrl: string; extracted: ExtractResponse['extracted']; verified: boolean }
  | { kind: 'reused'; bird: Bird };

// Back-compat alias used by VerifyPage, which only ever deals with the
// upload variant (you don't "verify" a bird you're reusing — it's already
// verified, that's what makes it reusable).
export type ParentUploadState = Extract<ParentState, { kind: 'upload' }>;

export function rootIdOf(p: ParentState): string {
  return p.kind === 'upload' ? p.extracted.rootBirdId : p.bird.id;
}
export function uploadIdOf(p: ParentState): string | undefined {
  return p.kind === 'upload' ? p.uploadId : undefined;
}
export function isReady(p?: ParentState): p is ParentState {
  return !!p && (p.kind === 'reused' || p.verified);
}

type View =
  | { name: 'home' }
  | { name: 'upload' }
  | { name: 'verify'; side: ParentSide }
  | { name: 'merge' }
  | { name: 'sheet'; childPedigreeId: string }
  | { name: 'crossref' }
  | { name: 'pairing' }
  | { name: 'library' }
  | { name: 'settings' };

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [sire, setSire] = useState<ParentState | undefined>();
  const [dam, setDam] = useState<ParentState | undefined>();

  function reset() {
    setSire(undefined);
    setDam(undefined);
    setView({ name: 'home' });
  }

  function onExtracted(side: ParentSide, res: ExtractResponse) {
    const state: ParentState = { kind: 'upload', uploadId: res.uploadId, fileUrl: res.fileUrl, extracted: res.extracted, verified: false };
    if (side === 'sire') setSire(state);
    else setDam(state);
  }

  function onReused(side: ParentSide, bird: Bird) {
    const state: ParentState = { kind: 'reused', bird };
    if (side === 'sire') setSire(state);
    else setDam(state);
  }

  function onVerified(side: ParentSide) {
    if (side === 'sire') setSire((s) => (s && s.kind === 'upload' ? { ...s, verified: true } : s));
    else setDam((d) => (d && d.kind === 'upload' ? { ...d, verified: true } : d));
  }

  function clearSide(side: ParentSide) {
    if (side === 'sire') setSire(undefined);
    else setDam(undefined);
  }

  const bothReady = isReady(sire) && isReady(dam);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="no-print border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <button className="flex items-center gap-2 font-semibold tracking-tight" onClick={reset}>
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: '#D19A45' }} />
            OudeLuck Pedigree Builder
          </button>
          <nav className="flex gap-4 text-sm">
            <button className="hover:underline" onClick={() => setView({ name: 'home' })}>
              Pedigrees
            </button>
            <button className="hover:underline" onClick={() => setView({ name: 'upload' })}>
              New Pedigree
            </button>
            <button className="hover:underline" onClick={() => setView({ name: 'crossref' })}>
              Cross-reference
            </button>
            <button className="hover:underline" onClick={() => setView({ name: 'pairing' })}>
              Pairing Planner
            </button>
            <button className="hover:underline" onClick={() => setView({ name: 'library' })}>
              Bird Library
            </button>
            <button className="hover:underline" onClick={() => setView({ name: 'settings' })}>
              Settings
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Keyed to the view so a crash on one page doesn't stay tripped
            after navigating elsewhere — see ErrorBoundary.tsx. */}
        <ErrorBoundary key={JSON.stringify(view)}>
        {view.name === 'home' && (
          <HomePage
            onNew={() => {
              setSire(undefined);
              setDam(undefined);
              setView({ name: 'upload' });
            }}
            onOpen={(childPedigreeId) => setView({ name: 'sheet', childPedigreeId })}
          />
        )}

        {view.name === 'upload' && (
          <UploadPage
            sire={sire}
            dam={dam}
            onExtracted={onExtracted}
            onReused={onReused}
            onClearSide={clearSide}
            onVerify={(side) => setView({ name: 'verify', side })}
            onContinueToMerge={() => setView({ name: 'merge' })}
          />
        )}

        {view.name === 'verify' && (() => {
          const state = view.side === 'sire' ? sire : dam;
          return state?.kind === 'upload' ? (
            <VerifyPage
              side={view.side}
              state={state}
              onDone={() => {
                onVerified(view.side);
                setView({ name: 'upload' });
              }}
              onCancel={() => setView({ name: 'upload' })}
            />
          ) : null;
        })()}

        {view.name === 'merge' && bothReady && sire && dam && (
          <MergePage sire={sire} dam={dam} onMerged={(childPedigreeId) => setView({ name: 'sheet', childPedigreeId })} />
        )}

        {view.name === 'sheet' && <SheetPage childPedigreeId={view.childPedigreeId} onBack={() => setView({ name: 'home' })} />}

        {view.name === 'crossref' && <CrossReferencePage />}

        {view.name === 'pairing' && <PairingPage />}

        {view.name === 'library' && <BirdLibraryPage onOpenPedigree={(childPedigreeId) => setView({ name: 'sheet', childPedigreeId })} />}

        {view.name === 'settings' && <SettingsPage />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
