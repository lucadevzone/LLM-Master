import { Router } from 'express';
import { readdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { readJson } from '../persistence/fileStore.js';
import { paths, getRoomIdForSession } from '../persistence/paths.js';
import { config } from '../config.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// GET /api/debug/session/:id — dump stato completo sessione (dev only)
router.get('/debug/session/:id', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const debugRoomId = getRoomIdForSession(req.params.id);
  const worldState = debugRoomId ? readJson(paths.worldStateFile(debugRoomId)) : null;
  const history = readJson(paths.historyFile(req.params.id), []);
  const summary = readJson(paths.summaryFile(req.params.id));
  const character = readJson(paths.characterFile(session.players?.[0]?.character_id));

  res.json({ session, worldState, character, history, summary });
});

// DELETE /api/admin/reset-rooms — elimina tutte le stanze (testing)
router.delete('/admin/reset-rooms', requireAdmin, (req, res) => {
  const roomsDir = join(config.dataDir, 'rooms');
  let deleted = 0;
  if (existsSync(roomsDir)) {
    const entries = readdirSync(roomsDir);
    for (const entry of entries) {
      rmSync(join(roomsDir, entry), { recursive: true, force: true });
      deleted++;
    }
  }
  res.json({ ok: true, deleted });
});

export default router;
