// Full-database export/import — protects against data loss (see build
// brief follow-up: "a full usable product" needs a recovery path beyond
// Cloudflare D1's own time-travel, and the local Express+SQLite deploy has
// no platform-level safety net at all). Deliberately DB-rows only, not
// photo/scan binaries — those live on disk (local) or R2 (Worker) and are
// a separate concern; a restore repopulates every bird/pedigree/folder
// record correctly, but a photoUrl pointing at a file that's genuinely
// gone stays a broken image rather than being silently dropped.
//
// The Anthropic API key is deliberately EXCLUDED from the export — a
// backup file is something you might hand off, store in a cloud drive, or
// keep for years; a live secret has no business riding along in it.

import type { Bird, Pairing } from './types';

export interface BackupUpload {
  id: string;
  originalFilename: string;
  storedPath: string;
  mimeType?: string;
  rootBirdId?: string;
  rawExtraction?: unknown;
  verified: boolean;
}

export interface BackupChildPedigree {
  id: string;
  childBirdId: string;
  sireUploadId?: string;
  damUploadId?: string;
  prose: unknown;
  layout?: unknown;
  ringFieldOrder: string;
  printVariant: string;
  template: string;
  folderId?: string;
}

export interface BackupFolder {
  id: string;
  name: string;
}

export interface BackupLoft {
  name?: string;
  subtitle?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoDataUrl?: string;
  logoScale?: string;
}

export const BACKUP_VERSION = 1;

export interface BackupFile {
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  birds: Bird[];
  uploads: BackupUpload[];
  childPedigrees: BackupChildPedigree[];
  folders: BackupFolder[];
  pairings?: Pairing[]; // optional so backups from before pairings existed still restore
  loft: BackupLoft;
}

export interface RestoreSummary {
  birds: number;
  folders: number;
  uploads: number;
  childPedigrees: number;
  pairings: number;
}
