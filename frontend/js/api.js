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
  updateModel: (id, model, mode) => req('PATCH', `/api/sessions/${id}/model`, { model, mode }),

  // Characters
  createCharacter: (body) => req('POST', '/api/characters', body),
  getCharacter: (id) => req('GET', `/api/characters/${id}`),
  rollCharacteristics: () => req('GET', '/api/characters/roll/characteristics'),
  listOccupations: () => req('GET', '/api/characters/list/occupations'),

  // GM turns
  playerTurn: (sessionId, content) =>
    req('POST', `/api/sessions/${sessionId}/player-turn`, { content }),
  diceResult: (sessionId, skill, roll) =>
    req('POST', `/api/sessions/${sessionId}/dice-result`, { skill, roll }),
  sendChoice: (sessionId, choice) =>
    req('POST', `/api/sessions/${sessionId}/choice`, { choice }),

  // Admin
  listModels: () => req('GET', '/api/models'),
};
