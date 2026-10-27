import { Hono } from 'hono';
import { getAllBirds, saveBirdsBatch } from '../db.js';
import { IMPORT_SOURCE_PREFIX, planImport, type ImportRow } from '../../shared/importBirds.js';
import type { Env } from '../env.js';

export const importRouter = new Hono<{ Bindings: Env }>();

// POST /api/import/birds — see server/routes/import.ts.
importRouter.post('/birds', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rows = body?.rows as ImportRow[] | undefined;
  const fileName = String(body?.fileName ?? 'spreadsheet');
  if (!Array.isArray(rows) || rows.some((r) => !r?.ring)) return c.json({ error: 'rows must be an array of rows, each with a ring' }, 400);
  const plan = planImport(rows, await getAllBirds(c.env.DB), `${IMPORT_SOURCE_PREFIX}${fileName}`, () => crypto.randomUUID());
  await saveBirdsBatch(c.env.DB, plan.birds);
  return c.json({ created: plan.created, updated: plan.updated, placeholderParents: plan.placeholderParents, parentConflicts: plan.parentConflicts });
});
