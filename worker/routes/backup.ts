import { Hono } from 'hono';
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
import type { Env } from '../env.js';

export const backupRouter = new Hono<{ Bindings: Env }>();

// GET /api/backup — mirrors server/routes/backup.ts. Every DB row, no API
// key, no photo/scan binaries — see shared/backup.ts.
backupRouter.get('/', async (c) => {
  const db = c.env.DB;
  const uploads = (await getAllUploads(db)).map((u) => ({
    id: u.id,
    originalFilename: u.original_filename,
    storedPath: u.stored_path,
    mimeType: u.mime_type ?? undefined,
    rootBirdId: u.root_bird_id ?? undefined,
    rawExtraction: u.raw_extraction_json ? JSON.parse(u.raw_extraction_json) : undefined,
    verified: !!u.verified,
  }));

  const childPedigrees = (await getAllChildPedigrees(db)).map((ch) => ({
    id: ch.id,
    childBirdId: ch.child_bird_id,
    sireUploadId: ch.sire_upload_id ?? undefined,
    damUploadId: ch.dam_upload_id ?? undefined,
    prose: JSON.parse(ch.prose_json ?? '{}'),
    layout: ch.layout_json ? JSON.parse(ch.layout_json) : undefined,
    ringFieldOrder: ch.ring_field_order,
    printVariant: ch.print_variant,
    template: ch.template,
    folderId: ch.folder_id ?? undefined,
  }));

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    birds: await getAllBirds(db),
    uploads,
    childPedigrees,
    pairings: await getAllPairings(db),
    folders: (await getAllFolders(db)).map((f) => ({ id: f.id, name: f.name })),
    loft: {
      name: await getSetting(db, LOFT_NAME_SETTING),
      subtitle: await getSetting(db, LOFT_SUBTITLE_SETTING),
      address: await getSetting(db, LOFT_ADDRESS_SETTING),
      phone: await getSetting(db, LOFT_PHONE_SETTING),
      email: await getSetting(db, LOFT_EMAIL_SETTING),
      logoDataUrl: await getSetting(db, LOFT_LOGO_SETTING),
      logoScale: await getSetting(db, LOFT_LOGO_SCALE_SETTING),
    },
  };

  return c.json(backup);
});

// POST /api/backup/restore — mirrors server/routes/backup.ts. FK order:
// birds -> folders -> uploads -> child pedigrees -> loft settings. Only
// upserts by id, never deletes.
backupRouter.post('/restore', async (c) => {
  const body = (await c.req.json().catch(() => undefined)) as Partial<BackupFile> | undefined;
  if (!body || body.version !== BACKUP_VERSION || !Array.isArray(body.birds)) {
    return c.json({ error: 'Not a recognised backup file (wrong version or shape).' }, 400);
  }

  const db = c.env.DB;
  try {
    await saveBirds(db, body.birds);
    for (const f of body.folders ?? []) await upsertFolder(db, f.id, f.name);
    for (const u of body.uploads ?? []) {
      await saveUpload(db, {
        id: u.id,
        originalFilename: u.originalFilename,
        storedPath: u.storedPath,
        mimeType: u.mimeType,
        rootBirdId: u.rootBirdId,
        rawExtraction: u.rawExtraction,
        verified: u.verified,
      });
    }
    for (const ch of body.childPedigrees ?? []) {
      await saveChildPedigree(db, {
        id: ch.id,
        childBirdId: ch.childBirdId,
        sireUploadId: ch.sireUploadId,
        damUploadId: ch.damUploadId,
        prose: ch.prose,
        layout: ch.layout,
        ringFieldOrder: ch.ringFieldOrder,
        printVariant: ch.printVariant,
        template: ch.template,
      });
      if (ch.folderId) await setChildPedigreeFolder(db, ch.id, ch.folderId);
    }
    // After birds: a pairing's cock/hen are FKs into birds.
    for (const p of body.pairings ?? []) await savePairing(db, p);
    if (body.loft?.name !== undefined) await setSetting(db, LOFT_NAME_SETTING, body.loft.name);
    if (body.loft?.subtitle !== undefined) await setSetting(db, LOFT_SUBTITLE_SETTING, body.loft.subtitle);
    if (body.loft?.address !== undefined) await setSetting(db, LOFT_ADDRESS_SETTING, body.loft.address);
    if (body.loft?.phone !== undefined) await setSetting(db, LOFT_PHONE_SETTING, body.loft.phone);
    if (body.loft?.email !== undefined) await setSetting(db, LOFT_EMAIL_SETTING, body.loft.email);
    if (body.loft?.logoDataUrl !== undefined) await setSetting(db, LOFT_LOGO_SETTING, body.loft.logoDataUrl);
    if (body.loft?.logoScale !== undefined) await setSetting(db, LOFT_LOGO_SCALE_SETTING, body.loft.logoScale);

    return c.json({
      birds: body.birds.length,
      folders: body.folders?.length ?? 0,
      uploads: body.uploads?.length ?? 0,
      childPedigrees: body.childPedigrees?.length ?? 0,
      pairings: body.pairings?.length ?? 0,
    });
  } catch (err) {
    console.error('[backup/restore] failed:', err);
    return c.json({ error: err instanceof Error ? err.message : 'Restore failed' }, 500);
  }
});
