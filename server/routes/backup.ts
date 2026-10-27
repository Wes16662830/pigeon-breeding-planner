import { Router } from 'express';
import {
  getAllBirds,
  getAllFolders,
  getAllUploads,
  getAllChildPedigrees,
  saveBirds,
  upsertFolder,
  saveUpload,
  saveChildPedigree,
  setChildPedigreeFolder,
  getSetting,
  getAllPairings,
  savePairing,
  setSetting,
} from '../db.js';
import {
  LOFT_NAME_SETTING,
  LOFT_SUBTITLE_SETTING,
  LOFT_ADDRESS_SETTING,
  LOFT_PHONE_SETTING,
  LOFT_EMAIL_SETTING,
  LOFT_LOGO_SETTING,
  LOFT_LOGO_SCALE_SETTING,
} from '../../shared/settings.js';
import { BACKUP_VERSION, type BackupFile } from '../../shared/backup.js';

export const backupRouter = Router();

// GET /api/backup — every DB row (birds, uploads metadata, child pedigrees,
// folders, loft branding) as one downloadable JSON file. Deliberately
// excludes the Anthropic API key and photo/scan binaries — see
// shared/backup.ts for why.
backupRouter.get('/', (_req, res) => {
  const uploads = getAllUploads().map((u) => ({
    id: u.id,
    originalFilename: u.original_filename,
    storedPath: u.stored_path,
    mimeType: u.mime_type ?? undefined,
    rootBirdId: u.root_bird_id ?? undefined,
    rawExtraction: u.raw_extraction_json ? JSON.parse(u.raw_extraction_json) : undefined,
    verified: !!u.verified,
  }));

  const childPedigrees = getAllChildPedigrees().map((c) => ({
    id: c.id,
    childBirdId: c.child_bird_id,
    sireUploadId: c.sire_upload_id ?? undefined,
    damUploadId: c.dam_upload_id ?? undefined,
    prose: JSON.parse(c.prose_json ?? '{}'),
    layout: c.layout_json ? JSON.parse(c.layout_json) : undefined,
    ringFieldOrder: c.ring_field_order,
    printVariant: c.print_variant,
    template: c.template,
    folderId: c.folder_id ?? undefined,
  }));

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    birds: getAllBirds(),
    uploads,
    childPedigrees,
    folders: getAllFolders().map((f) => ({ id: f.id, name: f.name })),
    pairings: getAllPairings(),
    loft: {
      name: getSetting(LOFT_NAME_SETTING),
      subtitle: getSetting(LOFT_SUBTITLE_SETTING),
      address: getSetting(LOFT_ADDRESS_SETTING),
      phone: getSetting(LOFT_PHONE_SETTING),
      email: getSetting(LOFT_EMAIL_SETTING),
      logoDataUrl: getSetting(LOFT_LOGO_SETTING),
      logoScale: getSetting(LOFT_LOGO_SCALE_SETTING),
    },
  };

  res.json(backup);
});

// POST /api/backup/restore — upserts every row from a previously exported
// file, in FK dependency order (birds -> folders -> uploads -> child
// pedigrees -> loft settings). Never deletes anything not in the file —
// restoring only adds/overwrites by id, so it's safe to run against a
// database that already has data in it.
backupRouter.post('/restore', (req, res) => {
  const body = req.body as Partial<BackupFile> | undefined;
  if (!body || body.version !== BACKUP_VERSION || !Array.isArray(body.birds)) {
    res.status(400).json({ error: 'Not a recognised backup file (wrong version or shape).' });
    return;
  }

  try {
    saveBirds(body.birds);
    for (const f of body.folders ?? []) upsertFolder(f.id, f.name);
    for (const u of body.uploads ?? []) {
      saveUpload({
        id: u.id,
        originalFilename: u.originalFilename,
        storedPath: u.storedPath,
        mimeType: u.mimeType,
        rootBirdId: u.rootBirdId,
        rawExtraction: u.rawExtraction,
        verified: u.verified,
      });
    }
    for (const c of body.childPedigrees ?? []) {
      saveChildPedigree({
        id: c.id,
        childBirdId: c.childBirdId,
        sireUploadId: c.sireUploadId,
        damUploadId: c.damUploadId,
        prose: c.prose,
        layout: c.layout,
        ringFieldOrder: c.ringFieldOrder,
        printVariant: c.printVariant,
        template: c.template,
      });
      if (c.folderId) setChildPedigreeFolder(c.id, c.folderId);
    }
    // After birds: a pairing's cock/hen are FKs into birds.
    for (const p of body.pairings ?? []) savePairing(p);
    if (body.loft?.name !== undefined) setSetting(LOFT_NAME_SETTING, body.loft.name);
    if (body.loft?.subtitle !== undefined) setSetting(LOFT_SUBTITLE_SETTING, body.loft.subtitle);
    if (body.loft?.address !== undefined) setSetting(LOFT_ADDRESS_SETTING, body.loft.address);
    if (body.loft?.phone !== undefined) setSetting(LOFT_PHONE_SETTING, body.loft.phone);
    if (body.loft?.email !== undefined) setSetting(LOFT_EMAIL_SETTING, body.loft.email);
    if (body.loft?.logoDataUrl !== undefined) setSetting(LOFT_LOGO_SETTING, body.loft.logoDataUrl);
    if (body.loft?.logoScale !== undefined) setSetting(LOFT_LOGO_SCALE_SETTING, body.loft.logoScale);

    res.json({
      birds: body.birds.length,
      folders: body.folders?.length ?? 0,
      uploads: body.uploads?.length ?? 0,
      childPedigrees: body.childPedigrees?.length ?? 0,
      pairings: body.pairings?.length ?? 0,
    });
  } catch (err) {
    console.error('[backup/restore] failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Restore failed' });
  }
});
