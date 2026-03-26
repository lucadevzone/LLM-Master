/**
 * SSE Registry — gestisce le connessioni SSE attive per ogni sessione.
 *
 * Struttura in memoria:
 *   registry: Map<sessionId, Map<playerId, res>>
 *
 * Le connessioni sono volatili: si perdono al riavvio del server.
 * EventSource lato client riconnette automaticamente.
 */

const registry = new Map();

/**
 * Registra la connessione SSE di un giocatore per una sessione.
 * Se il giocatore aveva già una connessione aperta, la chiude prima.
 */
export function subscribe(sessionId, playerId, res) {
  if (!registry.has(sessionId)) {
    registry.set(sessionId, new Map());
  }
  const session = registry.get(sessionId);

  // Chiudi eventuale connessione precedente (reload del browser, ecc.)
  if (session.has(playerId)) {
    try { session.get(playerId).end(); } catch (_) {}
  }

  session.set(playerId, res);
}

/**
 * Rimuove la connessione SSE di un giocatore.
 */
export function unsubscribe(sessionId, playerId) {
  const session = registry.get(sessionId);
  if (!session) return;
  session.delete(playerId);
  if (session.size === 0) registry.delete(sessionId);
}

/**
 * Invia un evento SSE a tutti i giocatori connessi nella sessione.
 */
export function broadcast(sessionId, eventType, data) {
  const session = registry.get(sessionId);
  if (!session) return;
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, res] of session) {
    try { res.write(payload); } catch (_) {}
  }
}

/**
 * Invia un evento SSE a un singolo giocatore.
 */
export function sendTo(sessionId, playerId, eventType, data) {
  const session = registry.get(sessionId);
  if (!session) return;
  const res = session.get(playerId);
  if (!res) return;
  try {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}

/**
 * Ritorna l'elenco dei playerId attualmente connessi per una sessione.
 */
export function getConnectedPlayers(sessionId) {
  const session = registry.get(sessionId);
  if (!session) return [];
  return [...session.keys()];
}

/**
 * Verifica se tutti i giocatori attesi sono connessi.
 * @param {string} sessionId
 * @param {string[]} expectedPlayerIds
 */
export function isAllConnected(sessionId, expectedPlayerIds) {
  const connected = getConnectedPlayers(sessionId);
  return expectedPlayerIds.every((id) => connected.includes(id));
}

/**
 * Ritorna true se un giocatore specifico è connesso.
 */
export function isConnected(sessionId, playerId) {
  return registry.get(sessionId)?.has(playerId) ?? false;
}
