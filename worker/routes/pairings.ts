import { Hono } from 'hono';
import { deletePairing, getAllBirds, getAllPairings, getPairing, saveBird, savePairing } from '../db.js';
import { normaliseRing } from '../../shared/ring.js';
import { planYoungster, validatePairingInput } from '../../shared/breedingRecord.js';
import type { Pairing } from '../../shared/types.js';
import type { Env } from '../env.js';

// Same surface as server/routes/pairings.ts.
export const pairingsRouter = new Hono<{ Bindings: Env }>();

pairingsRouter.get('/', async (c) => c.json(await getAllPairings(c.env.DB)));

pairingsRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<Pairing>;
  const error = validatePairingInput(body, await getAllBirds(c.env.DB));
  if (error) return c.json({ error }, 400);
  const pairing: Pairing = {
    id: crypto.randomUUID(),
    sireId: body.sireId!,
    damId: body.damId!,
    season: body.season!,
    pairedOn: body.pairedOn || undefined,
    status: body.status ?? 'planned',
    notes: body.notes || undefined,
    prediction: body.prediction,
  };
  await savePairing(c.env.DB, pairing);
  return c.json(await getPairing(c.env.DB, pairing.id), 201);
});

pairingsRouter.patch('/:id', async (c) => {
  const existing = await getPairing(c.env.DB, c.req.param('id'));
  if (!existing) return c.json({ error: 'Pairing not found' }, 404);
  const { status, pairedOn, notes, season } = (await c.req.json().catch(() => ({}))) as Partial<Pairing>;
  const next: Pairing = { ...existing, status: status ?? existing.status, pairedOn: pairedOn ?? existing.pairedOn, notes: notes ?? existing.notes, season: season ?? existing.season };
  const error = validatePairingInput(next, await getAllBirds(c.env.DB));
  if (error) return c.json({ error }, 400);
  await savePairing(c.env.DB, next);
  return c.json(await getPairing(c.env.DB, next.id));
});

pairingsRouter.delete('/:id', async (c) => {
  await deletePairing(c.env.DB, c.req.param('id'));
  return c.body(null, 204);
});

pairingsRouter.post('/:id/youngsters', async (c) => {
  const pairing = await getPairing(c.env.DB, c.req.param('id'));
  if (!pairing) return c.json({ error: 'Pairing not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const result = planYoungster(pairing, body ?? {}, await getAllBirds(c.env.DB), normaliseRing, () => crypto.randomUUID());
  if ('error' in result) return c.json({ error: result.error }, 400);
  await saveBird(c.env.DB, result.bird);
  return c.json(result.bird, 201);
});
