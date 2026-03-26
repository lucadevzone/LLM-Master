/**
 * Wrapper fetch per tutte le chiamate API.
 */

const BASE = '';

async function req(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  getMe: () => req('GET', '/api/auth/me'),

  // Adventures
  listAdventures: () => req('GET', '/api/adventures'),
  getAdventure: (id) => req('GET', `/api/adventures/${id}`),
  uploadAdventure: (file) => {
    const form = new FormData();
    form.append('adventure', file);
    return fetch('/api/adventures', { method: 'POST', body: form }).then((r) => r.json());
  },

  // Sessions
  listSessions: () => req('GET', '/api/sessions'),
  createSession: (body) => req('POST', '/api/sessions', body),
  getSession: (id) => req('GET', `/api/sessions/${id}`),
  getFloor: (id) => req('GET', `/api/sessions/${id}/floor`),
  getHistory: (id) => req('GET', `/api/sessions/${id}/history`),
  getConnectedPlayers: (id) => req('GET', `/api/sessions/${id}/connected-players`),
  updateLlm: (id, llmConfig, mode) => req('PATCH', `/api/sessions/${id}/llm`, { llmConfig, mode }),
  listModels: (provider = 'ollama') => req('GET', `/api/sessions/models?provider=${provider}`),

  // Characters
  createCharacter: (body) => req('POST', '/api/characters', body),
  getCharacter: (id) => req('GET', `/api/characters/${id}`),
  rollCharacteristics: () => req('GET', '/api/characters/roll/characteristics'),
  listOccupations: () => req('GET', '/api/characters/list/occupations'),

  // Rooms
  listRooms: () => req('GET', '/api/rooms'),
  getRoom: (id) => req('GET', `/api/rooms/${id}`),
  enterRoom: (id) => req('POST', `/api/rooms/${id}/enter`),
  registerCharacter: (roomId, body) => req('POST', `/api/rooms/${roomId}/register-character`, body),

  // Diary
  getDiary: (roomId) => req('GET', `/api/rooms/${roomId}/diary`),
  appendDiary: (roomId, entry) => req('POST', `/api/rooms/${roomId}/diary`, { entry }),

  // NPCs
  listNpcs: (roomId) => req('GET', `/api/rooms/${roomId}/npcs`),
  createNpc: (roomId, body) => req('POST', `/api/rooms/${roomId}/npcs`, body),
  getNpc: (roomId, npcId) => req('GET', `/api/rooms/${roomId}/npcs/${npcId}`),
  updateNpc: (roomId, npcId, body) => req('PATCH', `/api/rooms/${roomId}/npcs/${npcId}`, body),
  addNpcEvent: (roomId, npcId, description) => req('POST', `/api/rooms/${roomId}/npcs/${npcId}/event`, { description }),
  addNpcKnowledge: (roomId, npcId, fact) => req('POST', `/api/rooms/${roomId}/npcs/${npcId}/knowledge`, { fact }),

  // GM — azioni giocatore
  playerTurn: (sessionId, content) =>
    req('POST', `/api/sessions/${sessionId}/player-turn`, { content }),
  sendComment: (sessionId, content, type = 'comment') =>
    req('POST', `/api/sessions/${sessionId}/comment`, { content, type }),
  raiseHand: (sessionId) =>
    req('POST', `/api/sessions/${sessionId}/raise-hand`),
  lowerHand: (sessionId) =>
    req('POST', `/api/sessions/${sessionId}/lower-hand`),
  diceResult: (sessionId, skill, roll) =>
    req('POST', `/api/sessions/${sessionId}/dice-result`, { skill, roll }),
  sendChoice: (sessionId, choice) =>
    req('POST', `/api/sessions/${sessionId}/choice`, { choice }),

  // GM — gestione sessione multiplayer
  startSession: (sessionId) =>
    req('POST', `/api/sessions/${sessionId}/start`),
  continueVote: (sessionId, vote) =>
    req('POST', `/api/sessions/${sessionId}/continue-vote`, { vote }),
  passTurn: (sessionId) =>
    req('POST', `/api/sessions/${sessionId}/pass-turn`),
  requestEnd: (sessionId) =>
    req('POST', `/api/sessions/${sessionId}/request-end`),
};
