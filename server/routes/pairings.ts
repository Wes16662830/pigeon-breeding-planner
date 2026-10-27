import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { deletePairing, getAllBirds, getAllPairings, getPairing, saveBird, savePairing } from '../db.js';
import { normaliseRing } from '../../shared/ring.js';
import { planYoungster, validatePairingInput } from '../../shared/breedingRecord.js';
import type { Pairing } from '../../shared/types.js';

export const pairingsRouter = Router();

pairingsRouter.get('/', (_req, res) => {
  res.json(getAllPairings());
});

pairingsRouter.post('/', (req, res) => {
  const body = req.body as Partial<Pairing>;
  const error = validatePairingInput(body, getAllBirds());
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const pairing: Pairing = {
    id: randomUUID(),
    sireId: body.sireId!,
    damId: body.damId!,
    season: body.season!,
    pairedOn: body.pairedOn || undefined,
    status: body.status ?? 'planned',
    notes: body.notes || undefined,
    prediction: body.prediction,
  };
  savePairing(pairing);
  res.status(201).json(getPairing(pairing.id));
});

// PATCH /api/pairings/:id — status, date, notes, season. The cock, hen and
// prediction snapshot are fixed once recorded.
pairingsRouter.patch('/:id', (req, res) => {
  const existing = getPairing(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Pairing not found' });
    return;
  }
  const { status, pairedOn, notes, season } = req.body as Partial<Pairing>;
  const next: Pairing = { ...existing, status: status ?? existing.status, pairedOn: pairedOn ?? existing.pairedOn, notes: notes ?? existing.notes, season: season ?? existing.season };
  const error = validatePairingInput(next, getAllBirds());
  if (error) {
    res.status(400).json({ error });
    return;
  }
  savePairing(next);
  res.json(getPairing(next.id));
});

// Removes the pairing record only — youngsters stay on file as birds.
pairingsRouter.delete('/:id', (req, res) => {
  deletePairing(req.params.id);
  res.status(204).end();
});

pairingsRouter.post('/:id/youngsters', (req, res) => {
  const pairing = getPairing(req.params.id);
  if (!pairing) {
    res.status(404).json({ error: 'Pairing not found' });
    return;
  }
  const result = planYoungster(pairing, req.body ?? {}, getAllBirds(), normaliseRing, randomUUID);
  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  saveBird(result.bird);
  res.status(201).json(result.bird);
});
