import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createSession, emptyWorldState } from '../core/session.js';
import { readJson, writeJson, listDirs, ensureDir } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/sessions — lista sessioni salvate
router.get('/', (req, res) => {
  const sessionIds = listDirs(paths.sessions());
  const sessions = sessionIds
    .map((id) => {
      const s = readJson(paths.sessionFile(id));
      if (!s) return null;
      const character = readJson(paths.characterFile(s.players?.[0]?.character_id));
      return {
        id: s.id,
        adventure_id: s.adventure_id,
        character_name: character?.meta?.name || '?',
        current_scene: readJson(paths.worldStateFile(id))?.current_scene || null,
        last_active: s.last_active,
        status: s.status,
        turn_count: s.turn_count,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.last_active) - new Date(a.last_active));

  res.json(sessions);
});

// GET /api/sessions/:id
router.get('/:id', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  res.json(session);
});

// POST /api/sessions — crea nuova sessione
router.post('/', (req, res) => {
  const { adventure_id, character_id, model } = req.body;
  if (!adventure_id || !character_id) {
    return res.status(400).json({ error: 'adventure_id e character_id sono obbligatori' });
  }

  const session = createSession({ adventureId: adventure_id, characterId: character_id, model });
  const worldState = emptyWorldState(adventure_id);

  ensureDir(paths.session(session.id));
  writeJson(paths.sessionFile(session.id), session);
  writeJson(paths.worldStateFile(session.id), worldState);
  writeJson(paths.historyFile(session.id), []);

  res.status(201).json(session);
});

// PATCH /api/sessions/:id/model — cambia modello a runtime
router.patch('/:id/model', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const { model, mode } = req.body;
  if (model) session.model = model;
  if (mode && ['creative', 'fast'].includes(mode)) session.mode = mode;

  writeJson(paths.sessionFile(req.params.id), session);
  res.json({ model: session.model, mode: session.mode });
});

// DELETE /api/sessions/:id
router.delete('/:id', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  session.status = 'archived';
  writeJson(paths.sessionFile(req.params.id), session);
  res.json({ archived: true });
});

export default router;
