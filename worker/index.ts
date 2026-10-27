// Cloudflare Worker entry point — the hosted equivalent of server/index.ts.
// Static assets (the built frontend) are served directly by the Workers
// assets binding; this script only runs for /api/* and /uploads/* (see
// `run_worker_first` in wrangler.toml). Access control (who can reach this
// at all) is handled by Cloudflare Access in front of the route, not by
// application code — see README's "Hosting on Cloudflare" section.

import { Hono } from 'hono';
import { extractRouter } from './routes/extract.js';
import { birdsRouter } from './routes/birds.js';
import { mergeRouter } from './routes/merge.js';
import { crossrefRouter } from './routes/crossref.js';
import { exportRouter } from './routes/export.js';
import { settingsRouter } from './routes/settings.js';
import { foldersRouter } from './routes/folders.js';
import { backupRouter } from './routes/backup.js';
import { importRouter } from './routes/import.js';
import { pairingsRouter } from './routes/pairings.js';
import type { Env } from './env.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/extract', extractRouter);
app.route('/api/birds', birdsRouter);
app.route('/api/merge', mergeRouter);
app.route('/api/crossref', crossrefRouter);
app.route('/api/pedigrees', exportRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/folders', foldersRouter);
app.route('/api/backup', backupRouter);
app.route('/api/import', importRouter);
app.route('/api/pairings', pairingsRouter);

// Serves uploaded scans and exported sheets back out of R2 — the Worker
// equivalent of Express's `app.use('/uploads', express.static(...))`.
app.get('/uploads/*', async (c) => {
  const key = c.req.path.replace(/^\/uploads\//, '');
  const object = await c.env.UPLOADS.get(key);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
});

app.onError((err, c) => {
  console.error('[worker] unhandled error:', err);
  return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
});

export default app;
