// Core data model. Shared verbatim between the Express backend and the React
// frontend (imported by relative path from both) so extraction, storage and
// rendering never disagree about the shape of a bird.
//
// Rules encoded here (see build brief §4):
//  - `ring` is stored exactly as written on the source pedigree. `ringNormalised`
//    is a derived matching key and must never be written back over `ring`.
//  - `notes` and `results[].raw` preserve source wording verbatim. Any
//    translation goes in a *separate* field (`notesEn`) — never in place.
//  - `sex` is 'unknown' unless the source pedigree states it outright. Never
//    inferred from V/W markers on an ancestor box.

export type Sex = 'cock' | 'hen' | 'unknown';

export type RaceType = 'club' | 'federation' | 'national' | 'olr';

export interface Result {
  race: string; // "Graaff-Reinet"
  distanceKm?: number; // 390
  year?: number; // 2022
  position?: number; // 17
  poolSize?: number; // 1100
  federation?: string; // "Bloemfontein Federation"
  // One-loft races put every bird under the same management, so their
  // results say more about the bird itself than a club result does.
  raceType?: RaceType;
  raw: string; // verbatim source text — always keep
}

export interface Bird {
  id: string;
  ring: string; // verbatim, e.g. "ZA 21 BPFD 845"
  ringNormalised?: string; // "ZA-2021-BPFD-845" for matching
  name?: string; // "YELLOW RING"
  colour?: string;
  sex: Sex;
  breeder?: string;
  loftAddress?: string;
  notes: string[]; // prose claims, one per paragraph, verbatim source wording
  notesEn?: string[]; // English translation of `notes`, same index alignment. Never overwrites notes.
  results: Result[];
  sireId?: string;
  damId?: string;
  sourceFile?: string; // which upload this came from
  photoUrl?: string; // /uploads/photos/... — optional, set via POST /api/birds/:id/photo
  markers?: BirdMarkers; // the fancier's own assessment — see BirdMarkers
  confidence: number; // 0–1, from extraction
  verified: boolean; // human confirmed in Phase 2
  createdAt?: string;
  updatedAt?: string;
}

// The fancier's own breeding and performance assessment of a bird —
// entered by hand (Bird Library) or imported from a spreadsheet, never
// produced by extraction. Every field is optional: a blank is "not
// assessed", not "bad".
export type DistanceCategory = 'sprint' | 'middle' | 'long' | 'marathon';
export type BirdRole = 'racer' | 'stock' | 'proven-breeder' | 'young' | 'retired';

export interface BirdMarkers {
  // Family & strain
  family?: string; // the loft's own line name, e.g. "Yellow Ring line"
  strain?: string; // e.g. "Janssen", "Van Loon x Kopecky"
  foundationBird?: string; // the champion this line is built on (ring or name)
  // Physical / type, scored 1–5 where scored
  eyeSign?: string;
  size?: 'small' | 'medium' | 'large';
  build?: string; // free text: "short-coupled", "long-cast"…
  wingScore?: number;
  featherScore?: number;
  handlingScore?: number; // balance, muscle, back
  // Performance
  category?: DistanceCategory;
  acePoints?: number;
  prizePercent?: number; // % of races prized, 0–100
  bestPerformance?: string;
  // Breeding record
  role?: BirdRole;
  winningOffspring?: number; // youngsters with a top-10% result
  goodWith?: string; // mates/lines it has bred well with
  breedingNotes?: string;
}

// A pedigree upload produces one root Bird (the parent whose sheet was
// scanned) plus its ancestor tree, flattened into a list of Birds linked by
// sireId/damId. The root is always birds[0].
export interface ExtractedPedigree {
  sourceFile: string;
  rootBirdId: string;
  birds: Bird[];
  extractionNotes?: string; // model's free-text caveats about the scan (illegible sections, etc.)
}

export type PedigreeSide = 'sire' | 'dam';

// A completed child sheet: two verified parent pedigrees merged, plus
// generated prose and loft credentials for the sheet itself.
export interface ChildPedigree {
  id: string;
  childBirdId: string;
  sireRootId: string;
  damRootId: string;
  prose: PedigreeProse;
  createdAt: string;
  updatedAt: string;
}

export interface LoftCredential {
  loftName: string;
  claim: string; // e.g. "1st Nat. General Champion CZ six times" — describes the loft, not a bird
  raw: string;
  sourceBirdId?: string; // which ancestor's sheet this credential came from
}

export interface PedigreeProse {
  breeding: string;
  lineBreedingOfNote: string;
  sireOwnRecord: string;
  damOwnRecord: string;
  loftCredentials: LoftCredential[];
}

// Phase 5 — cross-reference results.
export interface SharedAncestorMatch {
  ancestorId: string;
  ancestorRing: string;
  ancestorName?: string;
  foundIn: { birdId: string; birdRing: string; sourceFile?: string }[];
}

export interface LineBreedingMatch {
  birdId: string; // the bird whose pedigree this line-breeding appears in
  ancestorId: string;
  ancestorRing: string;
  ancestorName?: string;
  occurrences: { generation: number; side: PedigreeSide[] }[]; // path of sire/dam choices to reach the ancestor
  notation: string; // e.g. "4x5"
}

export interface SiblingMatch {
  birdAId: string;
  birdBId: string;
  sireId: string;
  damId: string;
  relationship: 'full-sibling' | 'half-sibling';
}

export interface CrossReferenceReport {
  sharedAncestors: SharedAncestorMatch[];
  lineBreeding: LineBreedingMatch[];
  siblings: SiblingMatch[];
}

export interface InbreedingResult {
  birdId: string;
  coefficient: number; // Wright's coefficient of inbreeding, 0–1
  contributingAncestors: { ancestorId: string; ancestorRing: string; contribution: number }[];
}

// Confidence below this threshold is flagged amber in the verification UI.
export const CONFIDENCE_FLAG_THRESHOLD = 0.85;
