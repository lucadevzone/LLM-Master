import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

/**
 * Crea una nuova sessione di gioco.
 */
export function createSession({ adventureId, characterId, model }) {
  const id = uuidv4();
  return {
    id,
    created_at: new Date().toISOString(),
    last_active: new Date().toISOString(),
    status: 'active', // active | paused | ended
    adventure_id: adventureId,
    model: model || config.defaultModel,
    mode: 'creative', // creative (2 fasi) | fast (1 fase)
    language: 'it',
    players: [{ character_id: characterId, connection_id: null }],
    turn_count: 0,
  };
}

/**
 * Stato mondo vuoto iniziale per una sessione.
 */
export function emptyWorldState(adventureId) {
  return {
    adventure_id: adventureId,
    npcs: {},
    locations: {},
    flags: {},
    active_threats: [],
    clues_found: [],
    current_scene: null,
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
 * Entry history per un'azione giocatore.
 */
export function playerHistoryEntry(turn, content) {
  return {
    turn,
    timestamp: new Date().toISOString(),
    role: 'player',
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
