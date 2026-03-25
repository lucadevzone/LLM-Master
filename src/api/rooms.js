import { Router } from 'express';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { unlinkSync, existsSync } from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { readJson, writeJson, ensureDir, listFiles } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { getPlayerById } from '../core/auth.js';
import { loadAdventure } from '../core/adventure.js';

const router = Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

function listRooms() {
  ensureDir(paths.roomsDir());
  return listFiles(paths.roomsDir(), '.json')
    .map((f) => readJson(paths.roomFile(f.replace('.json', ''))))
    .filter(Boolean);
}

function enrichRoom(room) {
  const player = room.player_id ? getPlayerById(room.player_id) : null;
  return {
    ...room,
    player_name: player?.name || '—',
    player_email: player?.email || '—',
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/rooms — admin: tutte; player: solo le sue
router.get('/', (req, res) => {
  const all = listRooms().map(enrichRoom);
  if (req.user.role === 'admin') return res.json(all);
  // Player vede solo le sue
  res.json(all.filter((r) => r.player_id === req.user.id && r.status !== 'archived'));
});

// GET /api/rooms/:id
router.get('/:id', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  // Player può vedere solo le sue
  if (req.user.role === 'player' && room.player_id !== req.user.id) {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  res.json(enrichRoom(room));
});

// POST /api/rooms — solo admin
router.post('/', requireAdmin, (req, res) => {
  const { adventure_id, player_id, name } = req.body;
  if (!adventure_id || !player_id) {
    return res.status(400).json({ error: 'adventure_id e player_id sono obbligatori' });
  }

  // Verifica player
  const player = getPlayerById(player_id);
  if (!player) return res.status(404).json({ error: 'Giocatore non trovato' });

  // Verifica avventura
  const adventureFiles = listFiles(paths.adventures()).filter((f) => f.match(/\.(md|yaml|yml)$/i));
  let adventure = null;
  for (const f of adventureFiles) {
    try {
      const a = loadAdventure(join(paths.adventures(), f));
      if (a.id === adventure_id) { adventure = a; break; }
    } catch (_) {}
  }
  if (!adventure) return res.status(404).json({ error: 'Avventura non trovata' });

  ensureDir(paths.roomsDir());
  const id = uuidv4();
  const room = {
    id,
    name: name?.trim() || `${adventure.title} — ${player.name}`,
    adventure_id,
    player_id,
    session_id: null,     // creato quando il player entra
    character_id: null,
    status: 'waiting',    // waiting | active | archived
    created_at: new Date().toISOString(),
    last_active: null,
  };
  writeJson(paths.roomFile(id), room);
  res.status(201).json(enrichRoom(room));
});

// DELETE /api/rooms/:id — solo admin
router.delete('/:id', requireAdmin, (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });

  // Archivia (non cancella fisicamente per sicurezza)
  writeJson(paths.roomFile(req.params.id), { ...room, status: 'archived' });
  res.json({ archived: true });
});

// POST /api/rooms/:id/enter — player entra nella room (crea sessione se necessario)
router.post('/:id/enter', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (room.status === 'archived') return res.status(400).json({ error: 'Room archiviata' });
  if (req.user.role === 'player' && room.player_id !== req.user.id) {
    return res.status(403).json({ error: 'Accesso negato' });
  }

  // Se la sessione esiste già, ritorna direttamente
  if (room.session_id) {
    const session = readJson(paths.sessionFile(room.session_id));
    if (session) {
      return res.json({ session_id: room.session_id, character_id: room.character_id, needs_character: false });
    }
  }

  // Sessione non ancora creata: il player deve creare il personaggio
  res.json({ session_id: null, character_id: null, needs_character: true });
});

// POST /api/rooms/:id/start — avvia sessione con personaggio appena creato
router.post('/:id/start', (req, res) => {
  const { character_id, session_id } = req.body;
  if (!character_id || !session_id) {
    return res.status(400).json({ error: 'character_id e session_id obbligatori' });
  }

  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (req.user.role === 'player' && room.player_id !== req.user.id) {
    return res.status(403).json({ error: 'Accesso negato' });
  }

  writeJson(paths.roomFile(req.params.id), {
    ...room,
    session_id,
    character_id,
    status: 'active',
    last_active: new Date().toISOString(),
  });

  res.json({ ok: true });
});

export default router;
