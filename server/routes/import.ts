import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getAllBirds, saveBirds } from '../db.js';
import { IMPORT_SOURCE_PREFIX, planImport, type ImportRow } from '../../shared/importBirds.js';

export const importRouter = Router();

// POST /api/import/birds — rows already parsed and column-mapped in the
// browser (see shared/importBirds.ts). The client sends large files in
// chunks; each chunk links to birds earlier chunks saved, by ring.
importRouter.post('/birds', (req, res) => {
  const rows = req.body?.rows as ImportRow[] | undefined;
  const fileName = String(req.body?.fileName ?? 'spreadsheet');
  if (!Array.isArray(rows) || rows.some((r) => !r?.ring)) {
    res.status(400).json({ error: 'rows must be an array of rows, each with a ring' });
    return;
  }
  const plan = planImport(rows, getAllBirds(), `${IMPORT_SOURCE_PREFIX}${fileName}`, randomUUID);
  saveBirds(plan.birds);
  res.json({ created: plan.created, updated: plan.updated, placeholderParents: plan.placeholderParents, parentConflicts: plan.parentConflicts });
});
