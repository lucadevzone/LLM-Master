/**
 * Floor Manager — gestisce lo stato del "pavimento" (chi ha la parola) in una sessione.
 *
 * Stati possibili:
 *   lobby   → sessione non ancora avviata, giocatori in attesa
 *   open    → pavimento libero: il primo che invia un'azione lo prende
 *   player  → un giocatore specifico ha la parola (azione in corso)
 *   gm      → il GM sta elaborando/narrando
 *   dice    → attesa di un tiro dado da parte di un giocatore specifico
 *   paused  → sessione in pausa (disconnessione, voto in corso)
 *
 * Lo stato è persistito nel file session.json (campo `floor`).
 */

import { readJson, writeJson } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';

/**
 * Ritorna il floor corrente della sessione.
 * @param {object} session - oggetto sessione già letto da disco
 */
export function getFloor(session) {
  return session.floor ?? { state: 'open', player_id: null, hand_queue: [], dice_player_id: null };
}

/**
 * Tenta di prendere il floor per un giocatore.
 * Riesce solo se il floor è 'open'.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function takeFloor(sessionId, playerId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return { ok: false, reason: 'Sessione non trovata' };

  const floor = getFloor(session);

  if (floor.state !== 'open') {
    return { ok: false, reason: `Floor non disponibile (stato: ${floor.state})` };
  }

  session.floor = { ...floor, state: 'player', player_id: playerId };
  // Se il giocatore aveva alzato la mano, rimuovilo dalla coda
  session.floor.hand_queue = (floor.hand_queue || []).filter((id) => id !== playerId);
  writeJson(paths.sessionFile(sessionId), session);

  return { ok: true };
}

/**
 * Rilascia il floor e lo riporta a 'open'.
 * Chiamato dal GM dopo aver finito di narrare.
 */
export function releaseFloor(sessionId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return;

  session.floor = {
    state: 'open',
    player_id: null,
    hand_queue: session.floor?.hand_queue || [],
    dice_player_id: null,
  };
  writeJson(paths.sessionFile(sessionId), session);
}

/**
 * Imposta il floor su 'gm' (il GM sta narrando).
 * Chiamato appena prima di avviare lo streaming.
 */
export function setGMFloor(sessionId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return;

  session.floor = {
    ...getFloor(session),
    state: 'gm',
    player_id: null,
  };
  writeJson(paths.sessionFile(sessionId), session);
}

/**
 * Imposta il floor su 'dice' in attesa del tiro di un giocatore.
 */
export function setDiceFloor(sessionId, playerId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return;

  session.floor = {
    ...getFloor(session),
    state: 'dice',
    dice_player_id: playerId,
  };
  writeJson(paths.sessionFile(sessionId), session);
}

/**
 * Aggiunge un giocatore alla coda "mano alzata".
 * Non può alzare la mano chi ha già il floor.
 *
 * @returns {{ ok: boolean, queue: string[] }}
 */
export function raiseHand(sessionId, playerId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return { ok: false, queue: [] };

  const floor = getFloor(session);
  if (floor.player_id === playerId) {
    return { ok: false, queue: floor.hand_queue || [] };  // già in gioco
  }

  const queue = floor.hand_queue || [];
  if (!queue.includes(playerId)) queue.push(playerId);

  session.floor = { ...floor, hand_queue: queue };
  writeJson(paths.sessionFile(sessionId), session);

  return { ok: true, queue };
}

/**
 * Rimuove un giocatore dalla coda "mano alzata".
 *
 * @returns {{ ok: boolean, queue: string[] }}
 */
export function lowerHand(sessionId, playerId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return { ok: false, queue: [] };

  const floor = getFloor(session);
  const queue = (floor.hand_queue || []).filter((id) => id !== playerId);

  session.floor = { ...floor, hand_queue: queue };
  writeJson(paths.sessionFile(sessionId), session);

  return { ok: true, queue };
}

/**
 * Mette la sessione in pausa (disconnessione o voto in corso).
 */
export function pauseSession(sessionId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return;

  session.floor = { ...getFloor(session), state: 'paused' };
  session.status = 'paused';
  writeJson(paths.sessionFile(sessionId), session);
}

/**
 * Riprende la sessione dopo un voto "continuiamo".
 * Riporta il floor a 'open'.
 */
export function resumeSession(sessionId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return;

  session.floor = { ...getFloor(session), state: 'open', player_id: null, dice_player_id: null };
  session.status = 'active';
  writeJson(paths.sessionFile(sessionId), session);
}

/**
 * Avvia ufficialmente la sessione dalla lobby.
 * Imposta session_start_time e porta il floor a 'open'.
 */
export function startSession(sessionId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return;

  session.floor = { ...getFloor(session), state: 'open', player_id: null };
  session.status = 'active';
  session.session_start_time = new Date().toISOString();
  writeJson(paths.sessionFile(sessionId), session);
}
