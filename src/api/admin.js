import { Router } from 'express';
import { readJson } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';

const router = Router();

// GET /api/debug/session/:id — dump stato completo sessione (dev only)
router.get('/debug/session/:id', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const worldState = readJson(paths.worldStateFile(req.params.id));
  const history = readJson(paths.historyFile(req.params.id), []);
  const summary = readJson(paths.summaryFile(req.params.id));
  const character = readJson(paths.characterFile(session.players?.[0]?.character_id));

  res.json({ session, worldState, character, history, summary });
});

export default router;
