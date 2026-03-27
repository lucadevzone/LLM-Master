/**
 * Gestisce i timer proattivi per sessione.
 * Se nessun giocatore agisce entro il timeout, il GM si attiva autonomamente.
 */

// Map<sessionId, { timer: NodeJS.Timeout, firedAt: Date|null }>
const timers = new Map();

// Callback da chiamare allo scadere del timer
// Viene impostata da gm.js al momento dell'import
let proactiveCallback = null;

export function setProactiveCallback(fn) {
  proactiveCallback = fn;
}

/**
 * Avvia o resetta il timer per una sessione.
 * Va chiamato dopo ogni azione del giocatore e dopo ogni risposta del GM.
 *
 * @param {string} sessionId
 * @param {number} timeoutMs - millisecondi prima del trigger proattivo
 */
export function resetGMTimer(sessionId, timeoutMs) {
  clearGMTimer(sessionId);
  const timer = setTimeout(() => {
    timers.delete(sessionId);
    if (proactiveCallback) proactiveCallback(sessionId);
  }, timeoutMs);
  timers.set(sessionId, { timer });
}

/**
 * Avvia il timer SOLO se non ne esiste già uno attivo per la sessione.
 * Usato dopo PASS: non resetta il countdown già in corso durante una
 * conversazione intra-PG, così il GM interviene comunque dopo il primo timeout.
 *
 * @param {string} sessionId
 * @param {number} timeoutMs
 */
export function startGMTimerIfIdle(sessionId, timeoutMs) {
  if (!timers.has(sessionId)) {
    resetGMTimer(sessionId, timeoutMs);
  }
}

/**
 * Cancella il timer per una sessione (es. sessione terminata, tutti disconnessi).
 */
export function clearGMTimer(sessionId) {
  const entry = timers.get(sessionId);
  if (entry) {
    clearTimeout(entry.timer);
    timers.delete(sessionId);
  }
}

/**
 * Cancella tutti i timer attivi (es. shutdown server).
 */
export function clearAllTimers() {
  for (const { timer } of timers.values()) clearTimeout(timer);
  timers.clear();
}
