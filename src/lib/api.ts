// Thin fetch wrapper over the Express proxy. The frontend never talks to
// Anthropic directly and never sees an API key (build brief §3/§8).

import type { Bird, Pairing, CrossReferenceReport, ExtractedPedigree, InbreedingResult, PedigreeProse, Result } from '../../shared/types';
import type { BackupFile, RestoreSummary } from '../../shared/backup';
import type { ImportRow } from '../../shared/importBirds';
import type { YoungsterInput } from '../../shared/breedingRecord';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ExtractResponse {
  uploadId: string;
  extracted: ExtractedPedigree;
  fileUrl: string;
}

export function extractPedigreeFile(file: File): Promise<ExtractResponse> {
  const form = new FormData();
  form.append('file', file);
  return api('/extract', { method: 'POST', body: form });
}

export interface ExtractedResults {
  results: Result[];
  extractionNotes?: string;
}

// Paste/upload a screenshot of a race-history table (e.g. a oneloft results
// extract) and get back parsed race rows to merge into a bird's results —
// see BirdEditor's "Paste race results" widget.
export function extractRaceResults(file: File): Promise<ExtractedResults> {
  const form = new FormData();
  form.append('file', file);
  return api('/extract/results', { method: 'POST', body: form });
}

export function getUpload(uploadId: string) {
  return api<{
    id: string;
    original_filename: string;
    root_bird_id: string | null;
    verified: number;
    rawExtraction: ExtractedPedigree | null;
    fileUrl: string;
  }>(`/extract/${uploadId}`);
}

export interface ImportResult {
  created: number;
  updated: number;
  placeholderParents: number;
  parentConflicts: string[];
}

export function importBirdRows(fileName: string, rows: ImportRow[]): Promise<ImportResult> {
  return api('/import/birds', { method: 'POST', body: JSON.stringify({ fileName, rows }) });
}

export function getPairings(): Promise<Pairing[]> {
  return api('/pairings');
}

export function createPairing(p: Omit<Pairing, 'id' | 'createdAt' | 'updatedAt'>): Promise<Pairing> {
  return api('/pairings', { method: 'POST', body: JSON.stringify(p) });
}

export function updatePairing(id: string, patch: Partial<Pick<Pairing, 'status' | 'pairedOn' | 'notes' | 'season'>>): Promise<Pairing> {
  return api(`/pairings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deletePairing(id: string): Promise<void> {
  return api(`/pairings/${id}`, { method: 'DELETE' });
}

export function addYoungster(pairingId: string, y: YoungsterInput): Promise<Bird> {
  return api(`/pairings/${pairingId}/youngsters`, { method: 'POST', body: JSON.stringify(y) });
}

export function getAllBirds(): Promise<Bird[]> {
  return api('/birds');
}

export function getBird(id: string): Promise<Bird> {
  return api(`/birds/${id}`);
}

export function getBirdsBySource(sourceFile: string): Promise<Bird[]> {
  return api(`/birds/by-source/${encodeURIComponent(sourceFile)}`);
}

export function updateBird(id: string, patch: Partial<Bird>): Promise<Bird> {
  return api(`/birds/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}

export function setBirdVerified(id: string, verified: boolean): Promise<Bird> {
  return api(`/birds/${id}/verify`, { method: 'POST', body: JSON.stringify({ verified }) });
}

export function uploadBirdPhoto(id: string, file: File): Promise<{ photoUrl: string }> {
  const form = new FormData();
  form.append('photo', file);
  return api(`/birds/${id}/photo`, { method: 'POST', body: form });
}

export function deleteBirdPhoto(id: string): Promise<void> {
  return api(`/birds/${id}/photo`, { method: 'DELETE' });
}

export interface BirdAppearance {
  childPedigreeId: string;
  childBirdId: string;
  childRing: string;
  childName?: string;
  asChild: boolean;
}

export function getBirdAppearances(id: string): Promise<BirdAppearance[]> {
  return api(`/birds/${id}/appearances`);
}

export function completeUploadVerification(uploadId: string, sourceFile: string): Promise<{ ok: true }> {
  return api(`/birds/upload/${uploadId}/complete-verification`, {
    method: 'POST',
    body: JSON.stringify({ sourceFile }),
  });
}

// A side is either a freshly uploaded+verified pedigree (uploadId present,
// kept for provenance) or a bird already on file being reused as-is —
// either way rootId must point at an already-`verified` bird (the server
// checks this; see server/routes/merge.ts).
export interface MergeSideInput {
  rootId: string;
  uploadId?: string;
}

export interface MergeInput {
  sire: MergeSideInput;
  dam: MergeSideInput;
  child: { ring: string; name?: string; sex?: Bird['sex']; colour?: string; breeder?: string; loftAddress?: string; results?: Bird['results']; notes?: string[] };
}

export interface MergeResult {
  child: Bird;
  childPedigreeId: string;
  tree: Bird[];
  lineBreedingSummary: string[];
}

export function mergePedigrees(input: MergeInput): Promise<MergeResult> {
  return api('/merge', { method: 'POST', body: JSON.stringify(input) });
}

export interface ChildPedigreeListRow {
  id: string;
  child_bird_id: string;
  folder_id: string | null;
  created_at: string;
}

export function listChildPedigrees() {
  return api<ChildPedigreeListRow[]>('/merge');
}

export function deleteChildPedigree(id: string): Promise<void> {
  return api(`/merge/${id}`, { method: 'DELETE' });
}

// Same DELETE, but with keepalive so the browser still sends it while the
// page is unloading — used to flush a delete the operator has confirmed but
// whose undo window hasn't elapsed when they close the tab (see HomePage).
export function deleteChildPedigreeKeepalive(id: string): void {
  void fetch(`/api/merge/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

export interface ChildPedigreeDetail {
  id: string;
  child_bird_id: string;
  sire_upload_id: string | null;
  dam_upload_id: string | null;
  ring_field_order: string;
  print_variant: string;
  template: string;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  prose: PedigreeProse;
  layout: unknown;
  child: Bird;
  tree: Bird[];
}

export function getChildPedigree(id: string): Promise<ChildPedigreeDetail> {
  return api(`/merge/${id}`);
}

// Birds already on file that can be reused as a parent for a new pairing
// without re-uploading/re-extracting a scan — anything `verified`.
export async function getReusableBirds(): Promise<Bird[]> {
  const birds = await getAllBirds();
  return birds.filter((b) => b.verified).sort((a, b) => a.ring.localeCompare(b.ring));
}

export interface Folder {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function getFolders(): Promise<Folder[]> {
  return api('/folders');
}

export function createFolder(name: string): Promise<Folder> {
  return api('/folders', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameFolder(id: string, name: string): Promise<{ ok: true }> {
  return api(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function deleteFolder(id: string): Promise<void> {
  return api(`/folders/${id}`, { method: 'DELETE' });
}

export function moveChildPedigreeToFolder(id: string, folderId: string | null): Promise<{ ok: true }> {
  return api(`/pedigrees/${id}`, { method: 'PATCH', body: JSON.stringify({ folderId }) });
}

export function getCrossReference(): Promise<CrossReferenceReport> {
  return api('/crossref');
}

export function getInbreeding(birdId: string): Promise<InbreedingResult> {
  return api(`/crossref/inbreeding/${birdId}`);
}

export function patchPedigree(id: string, patch: { layout?: unknown; ringFieldOrder?: string; printVariant?: string; template?: string; prose?: unknown }) {
  return api(`/pedigrees/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function exportPedigreeHtml(id: string, html: string) {
  return api<{ ok: true; path: string; filename: string }>(`/pedigrees/${id}/export`, {
    method: 'POST',
    body: JSON.stringify({ html }),
  });
}

export interface LoftSettings {
  name?: string;
  subtitle?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoDataUrl?: string;
  logoScale?: string;
}

export interface SettingsInfo {
  hasApiKey: boolean;
  apiKeyPreview?: string;
  source: 'settings' | 'env' | 'none';
  loft: LoftSettings;
}

export function getSettings(): Promise<SettingsInfo> {
  return api('/settings');
}

export function saveLoftSettings(patch: {
  loftName?: string;
  loftSubtitle?: string;
  loftAddress?: string;
  loftPhone?: string;
  loftEmail?: string;
  loftLogoDataUrl?: string;
  loftLogoScale?: string;
}): Promise<SettingsInfo> {
  return api('/settings', { method: 'PUT', body: JSON.stringify(patch) });
}

export function clearLoftLogo(): Promise<SettingsInfo> {
  return api('/settings/loft-logo', { method: 'DELETE' });
}

export function saveApiKey(anthropicApiKey: string): Promise<SettingsInfo> {
  return api('/settings', { method: 'PUT', body: JSON.stringify({ anthropicApiKey }) });
}

export function clearApiKey(): Promise<SettingsInfo> {
  return api('/settings/api-key', { method: 'DELETE' });
}

export function getBackup(): Promise<BackupFile> {
  return api('/backup');
}

export function restoreBackup(backup: BackupFile): Promise<RestoreSummary> {
  return api('/backup/restore', { method: 'POST', body: JSON.stringify(backup) });
}
