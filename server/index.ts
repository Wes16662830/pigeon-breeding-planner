import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { PORT } from './env.js';
import { extractRouter } from './routes/extract.js';
import { birdsRouter } from './routes/birds.js';
import { mergeRouter } from './routes/merge.js';
import { crossrefRouter } from './routes/crossref.js';
import { exportRouter } from './routes/export.js';
import { settingsRouter } from './routes/settings.js';
import { foldersRouter } from './routes/folders.js';
import { backupRouter } from './routes/backup.js';
import { importRouter } from './routes/import.js';
import './db.js'; // ensures schema is applied on startup

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serves the original uploaded scans back to the frontend so the Phase 2
// verify screen can show "original on the left" (build brief §5).
app.use('/uploads', express.static(path.resolve(process.cwd(), 'data', 'uploads')));

app.use('/api/extract', extractRouter);
app.use('/api/birds', birdsRouter);
app.use('/api/merge', mergeRouter);
app.use('/api/crossref', crossrefRouter);
app.use('/api/pedigrees', exportRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/backup', backupRouter);
app.use('/api/import', importRouter);

// Multer / general error fallback — keeps failures as JSON instead of an
// HTML stack trace leaking to the frontend.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`OudeLuck Pedigree Builder API listening on http://localhost:${PORT}`);
});
