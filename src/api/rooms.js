import { Router } from 'express';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { readJson, writeJson, ensureDir, listFiles, listDirs, readText, writeText, appendText, deleteFile } from '../persistence/fileStore.js';
import { paths, registerSessionDir } from '../persistence/paths.js';
import { getPlayerById } from '../core/auth.js';
import { loadAdventure } from '../core/adventure.js';
import { createSession, emptyWorldState } from '../core/session.js';

const router = Router();
router.use(requireAuth);

// ── Migrazione automatica da flat file a struttura cartella ──────────────────

function migrateIfNeeded() {
  ensureDir(paths.roomsDir());
  // Cerca file .json diretti nella cartella rooms (vecchio formato)
  const legacyFiles = listFiles(paths.roomsDir(), '.json');
  for (const f of legacyFiles) {
    const id = f.replace('.json', '');
    const legacyPath = join(paths.roomsDir(), f);
    const data = readJson(legacyPath);
    if (!data) continue;
    // Scrivi nella nuova posizione
    writeJson(paths.roomFile(id), data);
    // Crea diary vuoto se non esiste
    if (!readText(paths.roomDiaryFile(id))) {
      writeText(paths.roomDiaryFile(id), '');
    }
    // Rimuovi il vecchio file flat
    deleteFile(legacyPath);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function listRooms() {
  migrateIfNeeded();
  return listDirs(paths.roomsDir())
    .map((id) => readJson(paths.roomFile(id)))
    .filter(Boolean);
}

function resolvePlayerIds(room) {
  if (room.player_ids?.length) return room.player_ids;
  if (room.player_id) return [room.player_id];
  return [];
}

function enrichRoom(room) {
  const playerIds = resolvePlayerIds(room);
  const players = playerIds.map((id) => {
    const p = getPlayerById(id);
    return { id, name: p?.name || '—', email: p?.email || '—' };
  });
  return {
    ...room,
    player_ids: playerIds,
    players_info: players,
    player_name: players[0]?.name || '—',
    player_email: players[0]?.email || '—',
  };
}

function playerInRoom(room, playerId) {
  return resolvePlayerIds(room).includes(playerId);
}

// ── Routes: rooms ─────────────────────────────────────────────────────────────

// GET /api/rooms
router.get('/', (req, res) => {
  const all = listRooms().map(enrichRoom);
  if (req.user.role === 'admin') return res.json(all);
  res.json(all.filter((r) => playerInRoom(r, req.user.id) && r.status !== 'archived'));
});

// GET /api/rooms/:id
router.get('/:id', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (req.user.role === 'player' && !playerInRoom(room, req.user.id)) {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  res.json(enrichRoom(room));
});

// POST /api/rooms — solo admin
router.post('/', requireAdmin, (req, res) => {
  const { adventure_id, player_ids, player_id, name, llmConfig, session_duration_minutes } = req.body;

  const resolvedIds = player_ids?.length ? player_ids : (player_id ? [player_id] : []);
  if (!adventure_id || !resolvedIds.length) {
    return res.status(400).json({ error: 'adventure_id e almeno un player_id sono obbligatori' });
  }

  if (llmConfig) {
    if (!['ollama', 'openai'].includes(llmConfig.provider)) {
      return res.status(400).json({ error: 'llmConfig.provider deve essere "ollama" o "openai"' });
    }
    if (!llmConfig.creativeModel || !llmConfig.fastModel) {
      return res.status(400).json({ error: 'llmConfig richiede creativeModel e fastModel' });
    }
  }

  const players = resolvedIds.map((id) => getPlayerById(id));
  const missing = players.indexOf(null);
  if (missing !== -1) {
    return res.status(404).json({ error: `Giocatore non trovato: ${resolvedIds[missing]}` });
  }

  const adventureFiles = listFiles(paths.adventures()).filter((f) => f.match(/\.(md|yaml|yml)$/i));
  let adventure = null;
  for (const f of adventureFiles) {
    try {
      const a = loadAdventure(join(paths.adventures(), f));
      if (a.id === adventure_id) { adventure = a; break; }
    } catch (_) {}
  }
  if (!adventure) return res.status(404).json({ error: 'Avventura non trovata' });

  const id = uuidv4();
  const playerNames = players.map((p) => p.name).join(', ');
  const room = {
    id,
    name: name?.trim() || `${adventure.title} — ${playerNames}`,
    adventure_id,
    player_ids: resolvedIds,
    llmConfig: llmConfig || null,
    session_duration_minutes: session_duration_minutes || null,
    session_id: null,
    status: 'waiting',
    created_at: new Date().toISOString(),
    last_active: null,
  };

  // Crea la cartella della stanza con tutti i file iniziali
  writeJson(paths.roomFile(id), room);
  writeText(paths.roomDiaryFile(id), '');
  ensureDir(paths.roomNpcsDir(id));

  res.status(201).json(enrichRoom(room));
});

// DELETE /api/rooms/:id — solo admin
router.delete('/:id', requireAdmin, (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  writeJson(paths.roomFile(req.params.id), { ...room, status: 'archived' });
  res.json({ archived: true });
});

// ── Routes: diary ─────────────────────────────────────────────────────────────

// GET /api/rooms/:id/diary
router.get('/:id/diary', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (req.user.role === 'player' && !playerInRoom(room, req.user.id)) {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  const content = readText(paths.roomDiaryFile(req.params.id));
  res.json({ content });
});

// POST /api/rooms/:id/diary — appende una voce al diario (admin o sistema)
router.post('/:id/diary', requireAdmin, (req, res) => {
  const { entry } = req.body;
  if (!entry?.trim()) return res.status(400).json({ error: 'entry obbligatorio' });
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  appendText(paths.roomDiaryFile(req.params.id), `[${timestamp}] ${entry.trim()}`);
  res.json({ ok: true });
});

// ── Routes: NPCs ──────────────────────────────────────────────────────────────

// GET /api/rooms/:id/npcs
router.get('/:id/npcs', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (req.user.role === 'player' && !playerInRoom(room, req.user.id)) {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  ensureDir(paths.roomNpcsDir(req.params.id));
  const npcs = listFiles(paths.roomNpcsDir(req.params.id), '.json')
    .map((f) => readJson(paths.roomNpcFile(req.params.id, f.replace('.json', ''))))
    .filter(Boolean);
  res.json(npcs);
});

// POST /api/rooms/:id/npcs — crea PNG
router.post('/:id/npcs', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });

  const { name, role, description, stats } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name obbligatorio' });

  const npcId = uuidv4();
  const npc = {
    id: npcId,
    name: name.trim(),
    role: role?.trim() || '',
    description: description?.trim() || '',
    stats: stats || {},
    events: [],
    knowledge: [],
    created_at: new Date().toISOString(),
  };

  ensureDir(paths.roomNpcsDir(req.params.id));
  writeJson(paths.roomNpcFile(req.params.id, npcId), npc);
  res.status(201).json(npc);
});

// GET /api/rooms/:id/npcs/:npcId
router.get('/:id/npcs/:npcId', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (req.user.role === 'player' && !playerInRoom(room, req.user.id)) {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  const npc = readJson(paths.roomNpcFile(req.params.id, req.params.npcId));
  if (!npc) return res.status(404).json({ error: 'PNG non trovato' });
  res.json(npc);
});

// PATCH /api/rooms/:id/npcs/:npcId — aggiorna descrizione/stats
router.patch('/:id/npcs/:npcId', (req, res) => {
  const npc = readJson(paths.roomNpcFile(req.params.id, req.params.npcId));
  if (!npc) return res.status(404).json({ error: 'PNG non trovato' });

  const { name, role, description, stats } = req.body;
  const updated = {
    ...npc,
    ...(name ? { name: name.trim() } : {}),
    ...(role !== undefined ? { role: role.trim() } : {}),
    ...(description !== undefined ? { description: description.trim() } : {}),
    ...(stats ? { stats: { ...npc.stats, ...stats } } : {}),
  };
  writeJson(paths.roomNpcFile(req.params.id, req.params.npcId), updated);
  res.json(updated);
});

// POST /api/rooms/:id/npcs/:npcId/event — aggiunge evento al PNG
router.post('/:id/npcs/:npcId/event', (req, res) => {
  const npc = readJson(paths.roomNpcFile(req.params.id, req.params.npcId));
  if (!npc) return res.status(404).json({ error: 'PNG non trovato' });

  const { description } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'description obbligatorio' });

  const event = { timestamp: new Date().toISOString(), description: description.trim() };
  npc.events.push(event);
  writeJson(paths.roomNpcFile(req.params.id, req.params.npcId), npc);
  res.json({ ok: true, event });
});

// POST /api/rooms/:id/npcs/:npcId/knowledge — aggiunge conoscenza al PNG
router.post('/:id/npcs/:npcId/knowledge', (req, res) => {
  const npc = readJson(paths.roomNpcFile(req.params.id, req.params.npcId));
  if (!npc) return res.status(404).json({ error: 'PNG non trovato' });

  const { fact } = req.body;
  if (!fact?.trim()) return res.status(400).json({ error: 'fact obbligatorio' });

  const entry = { timestamp: new Date().toISOString(), fact: fact.trim() };
  npc.knowledge.push(entry);
  writeJson(paths.roomNpcFile(req.params.id, req.params.npcId), npc);
  res.json({ ok: true, entry });
});

// ── Routes: enter / register-character ───────────────────────────────────────

// POST /api/rooms/:id/enter
router.post('/:id/enter', (req, res) => {
  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (room.status === 'archived') return res.status(400).json({ error: 'Room archiviata' });
  if (req.user.role === 'player' && !playerInRoom(room, req.user.id)) {
    return res.status(403).json({ error: 'Accesso negato' });
  }

  if (room.session_id) {
    const session = readJson(paths.sessionFile(room.session_id));
    if (session) {
      const playerEntry = session.players.find((p) => p.player_id === req.user.id);
      return res.json({
        session_id: room.session_id,
        character_id: playerEntry?.character_id || null,
        needs_character: !playerEntry?.character_id,
        player_ids: resolvePlayerIds(room),
        is_multiplayer: resolvePlayerIds(room).length > 1,
      });
    }
  }

  res.json({
    session_id: null,
    character_id: null,
    needs_character: true,
    player_ids: resolvePlayerIds(room),
    is_multiplayer: resolvePlayerIds(room).length > 1,
  });
});

// POST /api/rooms/:id/register-character
router.post('/:id/register-character', (req, res) => {
  const { character_id } = req.body;
  if (!character_id) return res.status(400).json({ error: 'character_id obbligatorio' });

  const room = readJson(paths.roomFile(req.params.id));
  if (!room) return res.status(404).json({ error: 'Room non trovata' });
  if (req.user.role === 'player' && !playerInRoom(room, req.user.id)) {
    return res.status(403).json({ error: 'Accesso negato' });
  }

  const playerIds = resolvePlayerIds(room);
  const charMap = { ...(room.character_map || {}), [req.user.id]: character_id };
  const allRegistered = playerIds.every((id) => charMap[id]);

  let newSessionId = room.session_id || null;

  if (allRegistered && !room.session_id) {
    const session = createSession({
      adventureId: room.adventure_id,
      players: playerIds.map((id) => ({ player_id: id, character_id: charMap[id] })),
      llmConfig: room.llmConfig,
      durationMinutes: room.session_duration_minutes,
    });
    const worldState = emptyWorldState(room.adventure_id);
    const sessionDir = paths.roomSessionDir(req.params.id, session.id);
    registerSessionDir(session.id, sessionDir);
    ensureDir(sessionDir);
    writeJson(paths.sessionFile(session.id), session);
    writeJson(paths.worldStateFile(session.id), worldState);
    writeJson(paths.historyFile(session.id), []);
    newSessionId = session.id;
  }

  writeJson(paths.roomFile(req.params.id), {
    ...room,
    character_map: charMap,
    ...(playerIds.length === 1 ? { character_id } : {}),
    ...(newSessionId && newSessionId !== room.session_id
      ? { session_id: newSessionId, status: 'active', last_active: new Date().toISOString() }
      : {}),
  });

  res.json({ ok: true, all_registered: allRegistered, session_id: newSessionId });
});

export default router;
