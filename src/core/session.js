import { v4 as uuidv4 } from 'uuid';
import { defaultLlmConfig } from '../gm/llmClient.js';

/**
 * Crea una nuova sessione di gioco.
 *
 * @param {object} params
 * @param {string} params.adventureId
 * @param {string} [params.characterId]       - singolo giocatore (retrocompat single-player)
 * @param {object} [params.llmConfig]         - { provider, creativeModel, fastModel }
 * @param {Array}  [params.players]           - [{ player_id, character_id }] per multiplayer
 * @param {number} [params.durationMinutes]   - durata sessione in minuti (null = illimitata)
 */
export function createSession({ adventureId, characterId, llmConfig, players, durationMinutes }) {
  const id = uuidv4();

  // Normalizza players: supporta sia single-player (characterId) che multi-player (players[])
  const resolvedPlayers = players?.length
    ? players.map((p) => ({ player_id: p.player_id, character_id: p.character_id, connected: false }))
    : [{ player_id: null, character_id: characterId, connected: false }];

  // Floor iniziale: lobby per multi-player (attende connessioni), open per single
  const isMultiplayer = resolvedPlayers.length > 1;
  const initialFloor = {
    state: isMultiplayer ? 'lobby' : 'open',
    player_id: null,
    hand_queue: [],
    dice_player_id: null,
  };

  return {
    id,
    created_at: new Date().toISOString(),
    last_active: new Date().toISOString(),
    status: isMultiplayer ? 'waiting' : 'active', // waiting = in lobby
    adventure_id: adventureId,
    llmConfig: llmConfig || defaultLlmConfig(),
    mode: 'creative', // creative (2 fasi) | fast (1 fase)
    language: 'it',
    players: resolvedPlayers,
    floor: initialFloor,
    session_duration_minutes: durationMinutes || null,
    session_start_time: isMultiplayer ? null : new Date().toISOString(),
    turn_count: 0,
    pending_directives: [],
    continue_votes: [],  // voti "continuiamo?" dopo disconnessione
  };
}

/**
 * Stato mondo vuoto iniziale per una sessione.
 */
export function emptyWorldState(adventureId) {
  return {
    adventure_id: adventureId,
    cycle_phase: 'impostare_scena',
    current_scene_index: 0,   // 0 = nessuna scena ancora aperta
    flags: {},
    active_threats: [],
    clues_found: [],
    npcs: {},
    notes: [],
  };
}

/**
 * Entry history per un turno GM.
 */
export function gmHistoryEntry(turn, narrative, directives = [], reasoning = null) {
  return {
    turn,
    timestamp: new Date().toISOString(),
    role: 'gm',
    content: narrative,
    directives_applied: directives.map((d) => d.type),
    gm_reasoning: reasoning, // loggato ma mai mostrato al giocatore
  };
}

/**
 * Entry history per un'azione o commento del giocatore.
 *
 * @param {number} turn
 * @param {string} content
 * @param {object} [opts]
 * @param {string} [opts.playerId]    - UUID del giocatore (null per single-player)
 * @param {string} [opts.playerName]  - nome del personaggio
 * @param {string} [opts.type]        - 'action' | 'comment' | 'interrupt' (default: 'action')
 */
export function playerHistoryEntry(turn, content, { playerId, playerName, type } = {}) {
  return {
    turn,
    timestamp: new Date().toISOString(),
    role: 'player',
    player_id: playerId || null,
    player_name: playerName || null,
    message_type: type || 'action',
    content,
  };
}

/**
 * Entry history per un risultato dado.
 */
export function diceHistoryEntry(turn, diceResult) {
  return {
    turn,
    timestamp: new Date().toISOString(),
    role: 'system',
    content: `Tiro ${diceResult.skillName}: ${diceResult.roll}/${diceResult.skillValue} — ${diceResult.label}`,
    dice_result: diceResult,
  };
}
