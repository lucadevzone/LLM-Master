import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createCharacter } from '../core/character.js';
import { rollCharacteristics, derivedStats, OCCUPATIONS, BASE_SKILLS } from '../core/cocRules.js';
import { readJson, writeJson, ensureDir } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Specific paths BEFORE /:id to avoid shadowing

// GET /api/characters/roll/characteristics — tira caratteristiche casuali
router.get('/roll/characteristics', (req, res) => {
  const characteristics = rollCharacteristics();
  const derived = derivedStats(characteristics);
  res.json({ characteristics, derived });
});

// GET /api/characters/list/occupations — lista occupazioni disponibili
router.get('/list/occupations', (req, res) => {
  const list = Object.entries(OCCUPATIONS).map(([id, occ]) => ({
    id,
    label: occ.label,
    skills: occ.skills,
    creditRating: occ.creditRating,
  }));
  res.json(list);
});

// GET /api/characters/list/skills — lista skill base
router.get('/list/skills', (req, res) => {
  res.json(BASE_SKILLS);
});

// GET /api/characters/:id
router.get('/:id', (req, res) => {
  const character = readJson(paths.characterFile(req.params.id));
  if (!character) return res.status(404).json({ error: 'Personaggio non trovato' });
  res.json(character);
});

// POST /api/characters — crea nuovo personaggio
// Accetta sia il formato piatto { name, occupation, characteristics, backstory }
// che il formato strutturato { meta: { name, occupation }, characteristics, skill_allocations, backstory }
router.post('/', (req, res) => {
  const body = req.body;

  // Normalizza in formato strutturato
  const meta = body.meta || { name: body.name, occupation: body.occupation };
  const characteristics = body.characteristics;
  const skill_allocations = body.skill_allocations || {};
  const backstory = body.backstory || '';

  if (!meta?.name || !characteristics) {
    return res.status(400).json({ error: 'name/meta.name e characteristics sono obbligatori' });
  }

  const required = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'];
  for (const stat of required) {
    if (!characteristics[stat]) {
      return res.status(400).json({ error: `Caratteristica mancante: ${stat}` });
    }
  }

  ensureDir(paths.characters());
  const id = uuidv4();
  const character = createCharacter({
    id,
    meta,
    characteristics,
    skillAllocations: skill_allocations,
    backstory,
  });

  writeJson(paths.characterFile(id), character);
  res.status(201).json(character);
});

// PATCH /api/characters/:id — aggiorna un personaggio (es. dopo eventi di gioco)
router.patch('/:id', (req, res) => {
  const character = readJson(paths.characterFile(req.params.id));
  if (!character) return res.status(404).json({ error: 'Personaggio non trovato' });

  const updated = {
    ...character,
    ...req.body,
    derived: { ...character.derived, ...(req.body.derived || {}) },
    meta: { ...character.meta, ...(req.body.meta || {}) },
  };

  writeJson(paths.characterFile(req.params.id), updated);
  res.json(updated);
});

export default router;
