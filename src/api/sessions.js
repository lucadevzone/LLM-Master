import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createSession, emptyWorldState } from '../core/session.js';
import { readJson, writeJson, listDirs, ensureDir } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { createClient } from '../gm/llmClient.js';
import { getConnectedPlayers } from '../gm/sseRegistry.js';

const router = Router();
router.use(requireAuth);

// GET /api/models?provider=ollama|openai — lista modelli disponibili per provider (usato dall'admin UI)
router.get('/models', requireAdmin, async (req, res) => {
  const { provider } = req.query;
  if (!provider) return res.status(400).json({ error: 'provider richiesto' });
  try {
    const client = createClient({ provider, creativeModel: '', fastModel: '' });
    const models = await client.listModels();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions — lista sessioni salvate (standalone + dentro stanze)
router.get('/', (req, res) => {
  // Sessioni standalone (legacy single-player)
  const standaloneIds = listDirs(paths.sessions());

  // Sessioni dentro stanze: data/rooms/*/sessions/*/
  const roomSessionIds = [];
  for (const roomId of listDirs(paths.roomsDir())) {
    for (const sessionId of listDirs(paths.roomSessionsDir(roomId))) {
      roomSessionIds.push(sessionId);
    }
  }

  const allIds = [...new Set([...standaloneIds, ...roomSessionIds])];

  const sessions = allIds
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

// GET /api/sessions/:id/history — history completa per replay al reconnect
// Filtra i campi interni (reasoning, directives) non utili al client
router.get('/:id/history', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const raw = readJson(paths.historyFile(req.params.id)) || [];
  const history = raw.map((entry) => {
    if (entry.role === 'gm') {
      return { role: 'gm', turn: entry.turn, content: entry.content, timestamp: entry.timestamp };
    }
    if (entry.role === 'player') {
      return {
        role: 'player',
        turn: entry.turn,
        content: entry.content,
        message_type: entry.message_type || 'action',
        player_id: entry.player_id || null,
        player_name: entry.player_name || null,
        timestamp: entry.timestamp,
      };
    }
    if (entry.role === 'system') {
      return {
        role: 'system',
        turn: entry.turn,
        content: entry.content,
        dice_result: entry.dice_result || null,
        timestamp: entry.timestamp,
      };
    }
    return null;
  }).filter(Boolean);

  res.json(history);
});

// POST /api/sessions — crea nuova sessione
// Supporta sia single-player { adventure_id, character_id }
// che multi-player { adventure_id, players: [{player_id, character_id}], duration_minutes }
router.post('/', (req, res) => {
  const { adventure_id, character_id, players, llmConfig, duration_minutes } = req.body;

  if (!adventure_id) {
    return res.status(400).json({ error: 'adventure_id obbligatorio' });
  }

  // Multi-player: richiede players[]
  if (players?.length) {
    const invalid = players.find((p) => !p.player_id || !p.character_id);
    if (invalid) {
      return res.status(400).json({ error: 'Ogni player deve avere player_id e character_id' });
    }
    const session = createSession({
      adventureId: adventure_id,
      players,
      llmConfig,
      durationMinutes: duration_minutes,
    });
    const worldState = emptyWorldState(adventure_id);
    ensureDir(paths.session(session.id));
    writeJson(paths.sessionFile(session.id), session);
    writeJson(paths.worldStateFile(session.id), worldState);
    writeJson(paths.historyFile(session.id), []);
    return res.status(201).json(session);
  }

  // Single-player (retrocompat)
  if (!character_id) {
    return res.status(400).json({ error: 'character_id obbligatorio per sessione single-player' });
  }
  const session = createSession({ adventureId: adventure_id, characterId: character_id, llmConfig });
  const worldState = emptyWorldState(adventure_id);
  ensureDir(paths.session(session.id));
  writeJson(paths.sessionFile(session.id), session);
  writeJson(paths.worldStateFile(session.id), worldState);
  writeJson(paths.historyFile(session.id), []);
  res.status(201).json(session);
});

// GET /api/sessions/:id/floor — stato attuale del floor (per polling o riconnessione)
router.get('/:id/floor', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  const floor = session.floor ?? { state: 'open', player_id: null, hand_queue: [], dice_player_id: null };
  // 'paused' è stato rimosso dalla logica: normalizza a 'open'
  if (floor.state === 'paused') floor.state = 'open';
  res.json(floor);
});

// GET /api/sessions/:id/connected-players — lista giocatori connessi (per sync tab Sessione)
router.get('/:id/connected-players', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const connectedIds = getConnectedPlayers(req.params.id);
  const players = connectedIds.map((pid) => {
    const entry = session.players.find((p) => p.player_id === pid);
    const character = entry ? readJson(paths.characterFile(entry.character_id)) : null;
    const playerName = character?.meta?.name || pid;
    const playerLogin = entry?.player_id || pid;
    return { player_id: pid, player_name: playerName, player_login: playerLogin };
  });

  res.json(players);
});

// PATCH /api/sessions/:id/llm — cambia configurazione LLM a runtime
router.patch('/:id/llm', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const { llmConfig, mode } = req.body;
  if (llmConfig) session.llmConfig = { ...session.llmConfig, ...llmConfig };
  if (mode && ['creative', 'fast'].includes(mode)) session.mode = mode;

  writeJson(paths.sessionFile(req.params.id), session);
  res.json({ llmConfig: session.llmConfig, mode: session.mode });
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
