/**
 * Bootstrap app: gestisce schermata avvio, creazione personaggio, avvio sessione.
 */

import { api } from './api.js';

const config = { defaultModel: 'llama3.1:8b' };
import { setSession, sendPlayerAction, appendSystemMessage } from './chat.js';
import { initCharacterPanel, addClueToPanel } from './characterSheet.js';

// ── Stato ─────────────────────────────────────────────────────────────────────

let state = {
  sessionId: null,
  characterId: null,
  adventureId: null,
  pendingAdventureId: null,
  currentModel: null,   // modello attivo, usato per ri-applicare dopo load dropdown
};

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadStartScreen();
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
    card.addEventListener('click', () => resumeSession(s.id));
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

// ── Creazione personaggio ─────────────────────────────────────────────────────

async function openCharacterCreation(adventureId) {
  state.pendingAdventureId = adventureId;
  const modal = document.getElementById('modal-character');
  modal.classList.add('open');

  // Tira caratteristiche casuali
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

    enterGameScreen(session, character);

    // Primo messaggio GM (apertura avventura)
    await api.playerTurn(session.id, '[INIZIO AVVENTURA]');
    import('./chat.js').then(({ openGMStream }) => openGMStream(session.id));
  } catch (err) {
    alert(`Errore avvio sessione: ${err.message}`);
  }
}

async function resumeSession(sessionId) {
  try {
    const session = await api.getSession(sessionId);
    const character = await api.getCharacter(session.players[0].character_id);

    state.sessionId = sessionId;
    state.characterId = character.id;

    enterGameScreen(session, character);

    // Mostra messaggio di ripresa
    import('./chat.js').then(({ appendSystemMessage }) => {
      appendSystemMessage('— Sessione ripresa —');
    });
  } catch (err) {
    alert(`Errore ripresa sessione: ${err.message}`);
  }
}

function enterGameScreen(session, character) {
  document.getElementById('screen-start').style.display = 'none';
  const gameScreen = document.getElementById('screen-game');
  gameScreen.style.display = 'flex';
  gameScreen.classList.add('active');

  // Titolo
  document.getElementById('game-title').textContent =
    `${character.meta.name} · ${session.adventure_id}`;

  // Scheda personaggio
  initCharacterPanel(character);

  // Imposta sessione nella chat
  setSession(session.id);

  // Salva il modello in state e applicalo alla select (se già popolata)
  state.currentModel = session.model || config.defaultModel;
  const sel = document.getElementById('model-select');
  if (sel.options.length > 0) sel.value = state.currentModel;
  updateModeToggle(session.mode || 'creative');
}

// ── Handlers input ────────────────────────────────────────────────────────────

function setupInputHandlers() {
  const inputText = document.getElementById('input-text');
  const sendBtn = document.getElementById('send-btn');

  sendBtn.addEventListener('click', () => sendInput());

  inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendInput();
    }
  });

  // Auto-resize textarea
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
  try {
    const models = await api.listModels();
    // Popola senza triggerare change: rimuovi listener, aggiorna, poi ri-applica
    select.innerHTML = models
      .map((m) => `<option value="${m.name}">${m.name}</option>`)
      .join('');
    // Ri-applica il modello della sessione corrente (se già in gioco)
    if (state.currentModel) select.value = state.currentModel;
  } catch (_) {
    select.innerHTML = '<option value="">Ollama non disponibile</option>';
  }

  select.addEventListener('change', async () => {
    if (!state.sessionId) return;
    state.currentModel = select.value;
    try {
      await api.updateModel(state.sessionId, select.value);
    } catch (_) {}
  });

  document.getElementById('mode-toggle').addEventListener('click', async () => {
    if (!state.sessionId) return;
    const session = await api.getSession(state.sessionId);
    const newMode = session.mode === 'creative' ? 'fast' : 'creative';
    await api.updateModel(state.sessionId, session.model, newMode);
    updateModeToggle(newMode);
  });
}

function updateModeToggle(mode) {
  const btn = document.getElementById('mode-toggle');
  btn.textContent = mode === 'creative' ? 'Creativo' : 'Veloce';
  btn.className = mode === 'creative' ? 'creative' : '';
  btn.id = 'mode-toggle'; // mantieni id
}
