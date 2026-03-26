/**
 * Bootstrap app: gestisce schermata avvio, creazione personaggio, avvio sessione.
 */

import { api } from './api.js';
import {
  setSession,
  sendPlayerAction,
  appendSystemMessage,
  initMultiplayer,
  openPersistentStream,
  openGMStream,
  loadHistory,
} from './chat.js';
import { initCharacterPanel } from './characterSheet.js';

// ── Stato ─────────────────────────────────────────────────────────────────────

let state = {
  sessionId: null,
  characterId: null,
  adventureId: null,
  pendingAdventureId: null,
  myPlayerId: null,
  isMultiplayer: false,
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Carica identità player
  try {
    const me = await api.getMe();
    state.myPlayerId = me.id;
  } catch (_) {}

  const params = new URLSearchParams(window.location.search);
  const sessionParam = params.get('session');
  const playerParam = params.get('player');

  if (sessionParam) {
    // Entrata diretta da lobby con sessione già creata
    await resumeSession(sessionParam, playerParam || state.myPlayerId);
  } else {
    // Schermata di avvio (flusso single-player legacy)
    await loadStartScreen();
  }

  setupInputHandlers();
  setupModelSelector();
});

// ── Schermata avvio ───────────────────────────────────────────────────────────

async function loadStartScreen() {
  const [adventures, sessions] = await Promise.all([
    api.listAdventures().catch(() => []),
    api.listSessions().catch(() => []),
  ]);

  renderAdventures(adventures);
  renderSessions(sessions);
}

function renderAdventures(adventures) {
  const grid = document.getElementById('adventure-grid');
  grid.innerHTML = '';

  if (!adventures.length) {
    grid.innerHTML = '<div class="empty-state">Nessuna avventura disponibile.<br>Carica un file .md per iniziare.</div>';
    return;
  }

  for (const adv of adventures) {
    const card = document.createElement('div');
    card.className = 'adventure-card';
    card.innerHTML = `
      <h3>${adv.title}</h3>
      <div class="meta">${adv.era || ''} · ${adv.tone || ''} · ${adv.players} giocatori</div>
    `;
    card.addEventListener('click', () => openCharacterCreation(adv.id));
    grid.appendChild(card);
  }
}

function renderSessions(sessions) {
  const list = document.getElementById('session-list');
  list.innerHTML = '';

  const active = sessions.filter((s) => s.status === 'active');
  if (!active.length) {
    list.innerHTML = '<div class="empty-state">Nessuna partita salvata.</div>';
    return;
  }

  for (const s of active) {
    const card = document.createElement('div');
    card.className = 'session-card';
    const date = new Date(s.last_active).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    card.innerHTML = `
      <h3>${s.character_name}</h3>
      <div class="meta">${s.adventure_id} · ${s.current_scene || 'inizio'} · ${date}</div>
    `;
    card.addEventListener('click', () => resumeSession(s.id, null));
    list.appendChild(card);
  }
}

// ── Upload avventura ──────────────────────────────────────────────────────────

document.getElementById('upload-adventure-btn').addEventListener('click', () => {
  document.getElementById('upload-file-input').click();
});

document.getElementById('upload-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await api.uploadAdventure(file);
    await loadStartScreen();
    alert(`Avventura "${file.name}" caricata!`);
  } catch (err) {
    alert(`Errore upload: ${err.message}`);
  }
  e.target.value = '';
});

// ── Creazione personaggio (single-player) ─────────────────────────────────────

async function openCharacterCreation(adventureId) {
  state.pendingAdventureId = adventureId;
  const modal = document.getElementById('modal-character');
  modal.classList.add('open');

  try {
    const chars = await api.rollCharacteristics();
    for (const [stat, val] of Object.entries(chars)) {
      const input = document.getElementById(`stat-${stat}`);
      if (input) input.value = val;
    }
  } catch (_) {}
}

document.getElementById('btn-reroll').addEventListener('click', async () => {
  try {
    const chars = await api.rollCharacteristics();
    for (const [stat, val] of Object.entries(chars)) {
      const input = document.getElementById(`stat-${stat}`);
      if (input) input.value = val;
    }
  } catch (_) {}
});

document.getElementById('btn-cancel-char').addEventListener('click', () => {
  document.getElementById('modal-character').classList.remove('open');
});

document.getElementById('form-character').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;

  const meta = {
    name: form.querySelector('[name=char-name]').value,
    occupation: form.querySelector('[name=char-occupation]').value,
    age: parseInt(form.querySelector('[name=char-age]').value, 10) || 30,
    residence: form.querySelector('[name=char-residence]').value || '',
  };

  const stats = ['STR','CON','SIZ','DEX','APP','INT','POW','EDU'];
  const characteristics = {};
  for (const s of stats) {
    characteristics[s] = parseInt(document.getElementById(`stat-${s}`).value, 10) || 50;
  }

  try {
    const character = await api.createCharacter({ meta, characteristics });
    state.characterId = character.id;
    document.getElementById('modal-character').classList.remove('open');
    await startNewSession(state.pendingAdventureId, character);
  } catch (err) {
    alert(`Errore creazione personaggio: ${err.message}`);
  }
});

// ── Avvio / ripresa sessione ──────────────────────────────────────────────────

async function startNewSession(adventureId, character) {
  try {
    const session = await api.createSession({
      adventure_id: adventureId,
      character_id: character.id,
    });

    state.sessionId = session.id;
    state.adventureId = adventureId;
    state.isMultiplayer = false;

    enterGameScreen(session, character);

    await api.playerTurn(session.id, '[INIZIO AVVENTURA]');
    openGMStream(session.id);
  } catch (err) {
    alert(`Errore avvio sessione: ${err.message}`);
  }
}

async function resumeSession(sessionId, playerId) {
  try {
    const session = await api.getSession(sessionId);
    const isMulti = session.players.length > 1 && session.players[0]?.player_id !== null;

    state.sessionId = sessionId;
    state.isMultiplayer = isMulti;

    let character = null;
    if (isMulti) {
      const pid = playerId || state.myPlayerId;
      const playerEntry = session.players.find((p) => p.player_id === pid);
      if (playerEntry?.character_id) {
        character = await api.getCharacter(playerEntry.character_id);
        state.characterId = playerEntry.character_id;
      }
    } else {
      const charId = session.players[0]?.character_id;
      if (charId) {
        character = await api.getCharacter(charId);
        state.characterId = charId;
      }
    }

    enterGameScreen(session, character);

    if (isMulti) {
      const pid = playerId || state.myPlayerId;

      // Sincronizza floor state attuale prima di aprire lo stream
      const floor = await api.getFloor(sessionId).catch(() => null);

      // Replay della history (messaggi passati)
      await loadHistory(sessionId, true);

      appendSystemMessage('— Riconnessione —');

      // Apre SSE con floor già sincronizzato
      const playerName = character?.meta?.name || pid;
      initMultiplayer(sessionId, pid, floor, playerName);
      openPersistentStream(sessionId);
    } else {
      // Replay history anche per single-player
      await loadHistory(sessionId, false);
      appendSystemMessage('— Sessione ripresa —');
    }
  } catch (err) {
    alert(`Errore ripresa sessione: ${err.message}`);
  }
}

function enterGameScreen(session, character) {
  document.getElementById('screen-start').style.display = 'none';
  const gameScreen = document.getElementById('screen-game');
  gameScreen.style.display = 'flex';
  gameScreen.classList.add('active');

  const title = character
    ? `${character.meta.name} · ${session.adventure_id}`
    : session.adventure_id;
  document.getElementById('game-title').textContent = title;

  if (character) initCharacterPanel(character);

  setSession(session.id);

  // Modello: mostra provider/modello corrente dalla sessione
  const llmCfg = session.llmConfig;
  if (llmCfg) {
    document.getElementById('model-select').title =
      `${llmCfg.provider} · ${llmCfg.creativeModel} / ${llmCfg.fastModel}`;
  }
  updateModeToggle(session.mode || 'creative');

  // Per multiplayer: nascondi selettore modello (gestito dall'admin)
  if (state.isMultiplayer) {
    document.getElementById('model-select').style.display = 'none';
    document.getElementById('mode-toggle').style.display = 'none';
  }
}

// ── Handlers input ────────────────────────────────────────────────────────────

function setupInputHandlers() {
  const inputText = document.getElementById('input-text');
  const declareBtn = document.getElementById('declare-btn');

  declareBtn.addEventListener('click', () => sendInput());

  inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendInput();
    }
  });

  inputText.addEventListener('input', () => {
    inputText.style.height = 'auto';
    inputText.style.height = Math.min(inputText.scrollHeight, 120) + 'px';
  });
}

function sendInput() {
  const inputText = document.getElementById('input-text');
  const content = inputText.value.trim();
  if (!content || !state.sessionId) return;
  inputText.value = '';
  inputText.style.height = 'auto';
  sendPlayerAction(content, state.sessionId);
}

// ── Model selector ────────────────────────────────────────────────────────────

async function setupModelSelector() {
  const select = document.getElementById('model-select');

  // Carica modelli Ollama di default per single-player
  try {
    const models = await api.listModels('ollama');
    select.innerHTML = models
      .map((m) => `<option value="${m.name}">${m.name}</option>`)
      .join('');
  } catch (_) {
    select.innerHTML = '<option value="">Ollama non disponibile</option>';
  }

  select.addEventListener('change', async () => {
    if (!state.sessionId || state.isMultiplayer) return;
    const model = select.value;
    try {
      await api.updateLlm(state.sessionId, { creativeModel: model, fastModel: model });
    } catch (_) {}
  });

  document.getElementById('mode-toggle').addEventListener('click', async () => {
    if (!state.sessionId) return;
    const session = await api.getSession(state.sessionId);
    const newMode = session.mode === 'creative' ? 'fast' : 'creative';
    await api.updateLlm(state.sessionId, null, newMode);
    updateModeToggle(newMode);
  });
}

function updateModeToggle(mode) {
  const btn = document.getElementById('mode-toggle');
  btn.textContent = mode === 'creative' ? 'Creativo' : 'Veloce';
  btn.className = mode === 'creative' ? 'creative' : '';
  btn.id = 'mode-toggle';
}
