/**
 * Gestione chat: rendering messaggi e SSE streaming.
 * Supporta sia single-player (SSE request-response) che multiplayer (SSE persistente).
 */

import { api } from './api.js';
import { updateCharacterPanel } from './characterSheet.js';
import { renderDiceButton } from './dice.js';

const messages = document.getElementById('messages');
const actionArea = document.getElementById('action-area');
const inputText = document.getElementById('input-text');
const declareBtn = document.getElementById('declare-btn');
const interruptBtn = document.getElementById('interrupt-btn');
const handBtn = document.getElementById('hand-btn');
const passTurnBtn = document.getElementById('pass-turn-btn');
const statusText = document.getElementById('status-text');
const floorIndicator = document.getElementById('floor-indicator');
const voteModal = document.getElementById('vote-modal');
const voteMessage = document.getElementById('vote-message');
const voteTally = document.getElementById('vote-tally');
const voteContinueBtn = document.getElementById('vote-continue-btn');
const voteStopBtn = document.getElementById('vote-stop-btn');
const closeSessionBtn = document.getElementById('close-session-btn');

let currentSessionId = null;
let isStreaming = false;

// Stato multiplayer
let isMultiplayer = false;
let myPlayerId = null;
let myPlayerName = '';
let floorState = { state: 'lobby', player_id: null, hand_queue: [] };
let handRaised = false;
let evtSource = null;
let connectedPlayers = new Map();

// Stato gruppi
let activeGroupId = null;
let currentGroups = [];

// ── Tab setup ─────────────────────────────────────────────────────────────────

(function setupCharacterTabs() {
  document.querySelectorAll('.char-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.char-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => (c.style.display = 'none'));
      tab.classList.add('active');
      const content = document.getElementById(`tab-${tab.dataset.tab}`);
      if (content) content.style.display = '';

      // Aggiorna la lista giocatori ogni volta che si apre il tab Sessione
      if (tab.dataset.tab === 'sessione' && currentSessionId) {
        syncSessionTab();
      }
    });
  });
})();

// ── Init multiplayer ──────────────────────────────────────────────────────────

export function initMultiplayer(sessionId, playerId, initialFloor, playerName = '') {
  isMultiplayer = true;
  myPlayerId = playerId;
  myPlayerName = playerName;
  currentSessionId = sessionId;

  if (initialFloor) {
    floorState = initialFloor;
    if (floorState.state === 'paused') floorState.state = 'open';
  }

  // Sync immediato dal server (fonte di verità)
  syncSessionTab();

  // Mostra pulsanti multiplayer
  if (interruptBtn) interruptBtn.style.display = '';
  if (handBtn) handBtn.style.display = '';
  if (passTurnBtn) passTurnBtn.style.display = '';
  if (closeSessionBtn) closeSessionBtn.style.display = '';


  // Pulsanti azione
  if (interruptBtn) interruptBtn.addEventListener('click', () => sendAsInterrupt());
  if (handBtn) handBtn.addEventListener('click', toggleHand);
  if (passTurnBtn) passTurnBtn.addEventListener('click', passTurnAction);
  if (closeSessionBtn) closeSessionBtn.addEventListener('click', requestEndAction);

  // Voto
  if (voteContinueBtn) voteContinueBtn.addEventListener('click', () => sendContinueVote(true));
  if (voteStopBtn) voteStopBtn.addEventListener('click', () => sendContinueVote(false));

  updateFloorUI();
}

function updateFloorUI() {
  const s = floorState.state;
  const hasFloor = floorState.player_id === myPlayerId;

  // Floor indicator
  if (floorIndicator) {
    floorIndicator.style.display = '';
    if (s === 'lobby') {
      floorIndicator.textContent = 'In attesa che tutti si connettano…';
    } else if (s === 'open') {
      floorIndicator.textContent = '★ Parola libera — puoi agire';
    } else if (s === 'player') {
      floorIndicator.textContent = hasFloor
        ? '★ Hai la parola'
        : `Sta agendo: ${floorState.player_name || floorState.player_id}`;
    } else if (s === 'gm') {
      floorIndicator.textContent = 'Il Custode sta parlando…';
    } else if (s === 'dice') {
      floorIndicator.textContent = 'In attesa del tiro di dado…';
    } else if (s === 'paused') {
      floorIndicator.textContent = 'Sessione in pausa';
    } else if (s === 'ended') {
      floorIndicator.textContent = 'Sessione terminata';
    }
  }

  // Pulsante Dichiara: attivo se floor è open o ce l'abbiamo noi
  const canAct = s === 'open' || (s === 'player' && hasFloor);
  if (declareBtn) {
    declareBtn.disabled = !canAct || isStreaming;
  }
  if (inputText && isMultiplayer) {
    inputText.disabled = !canAct || isStreaming;
  }

  // Pulsante Passa turno: visibile solo se abbiamo il floor
  if (passTurnBtn) {
    passTurnBtn.style.display = (s === 'player' && hasFloor) ? '' : 'none';
  }

  // Hand button: visibile se il floor è occupato da qualcun altro
  if (handBtn) {
    const showHand = isMultiplayer && s !== 'lobby' && s !== 'ended' && !(s === 'player' && hasFloor);
    handBtn.style.display = showHand ? '' : 'none';
    handBtn.textContent = handRaised ? '✋ Abbassa mano' : '🙋 Parola';
    handBtn.title = handRaised ? 'Abbassa la mano' : 'Chiedi la parola';
  }
}

// ── SSE Persistente (multiplayer) ─────────────────────────────────────────────

export function openPersistentStream(sessionId) {
  if (evtSource) evtSource.close();

  evtSource = new EventSource(`/api/sessions/${sessionId}/stream`);

  let gmBubble = null;

  // Token streaming narrativa GM
  evtSource.addEventListener('token', (e) => {
    const data = JSON.parse(e.data);
    if (!gmBubble) gmBubble = startGMMessage();
    appendToGMBubble(gmBubble, data.content);
  });

  // Fine turno GM — finalizza bubble ma non chiude la connessione persistente
  evtSource.addEventListener('done', () => {
    if (gmBubble) { finalizeGMBubble(gmBubble); gmBubble = null; }
    setStatus('');
  });

  // Cambio floor
  evtSource.addEventListener('floor_change', (e) => {
    const data = JSON.parse(e.data);
    floorState = data;
    if (data.state === 'gm') clearActionArea();
    updateFloorUI();
  });

  // Lobby: sessione pronta per partire (tutti connessi)
  evtSource.addEventListener('lobby_ready', (e) => {
    const data = JSON.parse(e.data);
    appendSystemMessage(data.message || 'Tutti i giocatori sono connessi!', 'success');
  });

  // Sessione avviata
  evtSource.addEventListener('session_started', (e) => {
    const data = JSON.parse(e.data);
    floorState = { state: 'open', player_id: null, hand_queue: [] };
    updateFloorUI();
    appendSystemMessage(data.message || 'La sessione è iniziata!', 'success');
  });

  // Giocatore connesso/disconnesso
  evtSource.addEventListener('player_connected', (e) => {
    const data = JSON.parse(e.data);
    connectedPlayers.set(data.player_id, data.player_name || data.player_id);
    renderSessionTab();
    appendSystemMessage(`${data.player_name || data.player_id} si è connesso.`);
  });

  evtSource.addEventListener('player_disconnected', (e) => {
    const data = JSON.parse(e.data);
    connectedPlayers.delete(data.player_id);
    renderSessionTab();
    appendSystemMessage(`${data.player_name || data.player_id} si è disconnesso.`);
  });

  // Voto disconnessione/chiusura
  evtSource.addEventListener('session_paused', (e) => {
    const data = JSON.parse(e.data);
    appendSystemMessage(data.disconnected_player
      ? `${data.disconnected_player} si è disconnesso.`
      : data.requesting_player
        ? `${data.requesting_player} propone di chiudere la sessione.`
        : 'Voto in corso.');
    if (voteModal && voteMessage) {
      voteMessage.textContent = data.message || 'Un giocatore si è disconnesso. Continuate?';
      if (voteTally) voteTally.textContent = '';
      voteModal.style.display = 'flex';
    }
  });

  evtSource.addEventListener('session_resumed', () => {
    floorState.state = 'open';
    updateFloorUI();
    if (voteModal) voteModal.style.display = 'none';
    appendSystemMessage('Sessione ripresa.');
  });

  // Fine sessione
  evtSource.addEventListener('session_ended', (e) => {
    const data = JSON.parse(e.data);
    floorState.state = 'ended';
    updateFloorUI();
    if (voteModal) voteModal.style.display = 'none';
    appendSystemMessage(data.message || 'La sessione è terminata.', 'success');
    evtSource.close();
    evtSource = null;
  });

  // Aggiornamento conteggio voti
  evtSource.addEventListener('continue_vote', (e) => {
    const data = JSON.parse(e.data);
    if (voteTally) {
      voteTally.textContent =
        `Continuare: ${data.votes_continue} · Chiudere: ${data.votes_stop} / ${data.total_connected}`;
    }
  });

  // Messaggi degli altri giocatori
  evtSource.addEventListener('player_action', (e) => {
    const data = JSON.parse(e.data);
    if (data.player_id !== myPlayerId) {
      appendPlayerMessage(data.content, data.player_name || data.player_id);
    }
  });

  evtSource.addEventListener('player_comment', (e) => {
    const data = JSON.parse(e.data);
    if (data.player_id !== myPlayerId) {
      appendCommentMessage(data.content, data.player_name || data.player_id, data.type);
    }
  });

  // Mano alzata/abbassata
  evtSource.addEventListener('hand_raised', (e) => {
    const data = JSON.parse(e.data);
    if (data.player_id !== myPlayerId) {
      appendSystemMessage(`${data.player_name || data.player_id} chiede la parola.`);
    } else {
      handRaised = true;
      updateFloorUI();
    }
  });

  evtSource.addEventListener('hand_lowered', (e) => {
    const data = JSON.parse(e.data);
    if (data.player_id === myPlayerId) {
      handRaised = false;
      updateFloorUI();
    }
  });

  // Richiesta dado (solo al giocatore attivo)
  evtSource.addEventListener('dice_request', (e) => {
    const data = JSON.parse(e.data);
    renderDiceButton(data, sessionId);
  });

  // Notifica dado in attesa (agli altri giocatori)
  evtSource.addEventListener('dice_pending', (e) => {
    const data = JSON.parse(e.data);
    appendSystemMessage(`${data.player_name || 'Un giocatore'} sta tirando i dadi per: ${data.skill}`);
  });

  // Risultato dado
  evtSource.addEventListener('dice_result', (e) => {
    const data = JSON.parse(e.data);
    const outcome = data.success ? 'success' : 'failure';
    appendSystemMessage(`Tiro: ${data.skill} → ${data.roll} (${data.success ? 'Successo' : 'Fallimento'})`, outcome);
  });

  // Aggiornamento personaggio
  evtSource.addEventListener('character_update', (e) => {
    const data = JSON.parse(e.data);
    if (!data.player_id || data.player_id === myPlayerId) {
      updateCharacterPanel(data);
    }
  });

  // Game events (sanità, HP, oggetti…)
  evtSource.addEventListener('game_event', (e) => {
    const event = JSON.parse(e.data);
    handleGameEvent(event);
  });

  // Suggerimento proattivo (timeout silenzio)
  evtSource.addEventListener('gm_hint', (e) => {
    const data = JSON.parse(e.data);
    appendSystemMessage(data.message);
  });

  // Transizione narrativa tra gruppi (nel frattempo...)
  evtSource.addEventListener('gm_transition', (e) => {
    const data = JSON.parse(e.data);
    appendGroupTransition(data.message);
  });

  // Cambio gruppo attivo
  evtSource.addEventListener('group_switch', (e) => {
    const data = JSON.parse(e.data);
    activeGroupId = data.active_group_id;
    currentGroups = data.groups || [];
    updateGroupUI();
  });

  // Sussurro privato dal Custode
  evtSource.addEventListener('whisper', (e) => {
    const data = JSON.parse(e.data);
    appendWhisperMessage(data.message);
  });

  // Azioni suggerite
  evtSource.addEventListener('ui_hints', (e) => {
    const data = JSON.parse(e.data);
    if (!data.player_id || data.player_id === myPlayerId) {
      renderSuggestedActions(data.suggested_actions, sessionId);
    }
  });

  // Status
  evtSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    setStatus(data.message);
  });

  evtSource.addEventListener('game_error', (e) => {
    try {
      const data = JSON.parse(e.data);
      appendSystemMessage(`Errore: ${data.message}`, 'failure');
    } catch (_) {}
    if (gmBubble) { finalizeGMBubble(gmBubble); gmBubble = null; }
  });

  evtSource.onerror = () => {
    setStatus('Connessione persa, riconnessione…');
  };
}

// ── SSE Stream single-player ──────────────────────────────────────────────────

export function openGMStream(sessionId) {
  setStreaming(true);
  let gmBubble = null;

  const source = new EventSource(`/api/sessions/${sessionId}/stream`);

  source.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    setStatus(data.message);
  });

  source.addEventListener('token', (e) => {
    const data = JSON.parse(e.data);
    if (!gmBubble) gmBubble = startGMMessage();
    appendToGMBubble(gmBubble, data.content);
  });

  source.addEventListener('dice_request', (e) => {
    const data = JSON.parse(e.data);
    renderDiceButton(data, sessionId);
  });

  source.addEventListener('ui_hints', (e) => {
    const data = JSON.parse(e.data);
    renderSuggestedActions(data.suggested_actions, sessionId);
  });

  source.addEventListener('game_event', (e) => {
    const event = JSON.parse(e.data);
    handleGameEvent(event);
  });

  source.addEventListener('whisper', (e) => {
    const data = JSON.parse(e.data);
    appendWhisperMessage(data.message);
  });

  source.addEventListener('character_update', (e) => {
    const data = JSON.parse(e.data);
    updateCharacterPanel(data);
  });

  source.addEventListener('game_error', (e) => {
    try {
      const data = JSON.parse(e.data);
      appendSystemMessage(`Errore: ${data.message}`, 'failure');
    } catch (_) {}
    source.close();
    if (gmBubble) finalizeGMBubble(gmBubble);
    setStreaming(false);
  });

  source.addEventListener('done', () => {
    source.close();
    if (gmBubble) finalizeGMBubble(gmBubble);
    setStreaming(false);
  });

  source.onerror = () => {
    source.close();
    if (gmBubble) finalizeGMBubble(gmBubble);
    setStreaming(false);
    setStatus('');
  };
}

// ── Azioni input ──────────────────────────────────────────────────────────────

async function sendAsInterrupt() {
  const content = inputText.value.trim();
  if (!content) return;
  inputText.value = '';
  inputText.style.height = 'auto';
  appendCommentMessage(content, 'Tu', 'interrupt');
  try {
    await api.sendComment(currentSessionId, content, 'interrupt');
  } catch (err) {
    appendSystemMessage(`Errore: ${err.message}`, 'failure');
  }
}

async function toggleHand() {
  try {
    if (handRaised) {
      await api.lowerHand(currentSessionId);
      handRaised = false;
    } else {
      await api.raiseHand(currentSessionId);
      handRaised = true;
    }
    updateFloorUI();
  } catch (err) {
    appendSystemMessage(`Errore: ${err.message}`, 'failure');
  }
}

async function passTurnAction() {
  try {
    await api.passTurn(currentSessionId);
  } catch (err) {
    appendSystemMessage(`Errore: ${err.message}`, 'failure');
  }
}

async function requestEndAction() {
  try {
    await api.requestEnd(currentSessionId);
  } catch (err) {
    appendSystemMessage(`Errore: ${err.message}`, 'failure');
  }
}

async function sendContinueVote(wantContinue) {
  if (voteModal) voteModal.style.display = 'none';
  try {
    await api.continueVote(currentSessionId, wantContinue ? 'continue' : 'stop');
  } catch (err) {
    appendSystemMessage(`Errore nel voto: ${err.message}`, 'failure');
  }
}

// ── Invio azione giocatore ────────────────────────────────────────────────────

export async function sendPlayerAction(content, sessionId) {
  if (!content.trim()) return;
  const sid = sessionId || currentSessionId;

  if (isMultiplayer) {
    if (floorState.state !== 'open' && !(floorState.state === 'player' && floorState.player_id === myPlayerId)) {
      appendSystemMessage('Non hai la parola al momento.', 'failure');
      return;
    }
    appendPlayerMessage(content, 'Tu');
    clearActionArea();
    try {
      await api.playerTurn(sid, content);
    } catch (err) {
      if (err.waiting_group) {
        appendSystemMessage('Il Custode sta seguendo un altro gruppo. Aspetta il tuo turno.', 'failure');
      } else {
        appendSystemMessage(`Errore: ${err.message}`, 'failure');
      }
    }
  } else {
    if (isStreaming) return;
    appendPlayerMessage(content);
    clearActionArea();
    try {
      await api.playerTurn(sid, content);
      openGMStream(sid);
    } catch (err) {
      appendSystemMessage(`Errore: ${err.message}`, 'failure');
    }
  }
}

// ── Rendering messaggi ────────────────────────────────────────────────────────

export function appendPlayerMessage(content, playerName = null) {
  const div = document.createElement('div');
  div.className = 'msg-player';
  const label = playerName ? escapeHtml(playerName).toUpperCase() : 'TU';
  div.innerHTML = `<div class="label">${label}</div><div class="bubble">${escapeHtml(content)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
  return div;
}

function appendCommentMessage(content, playerName, type) {
  const div = document.createElement('div');
  div.className = `msg-comment ${type === 'interrupt' ? 'msg-interrupt' : ''}`;
  const icon = type === 'interrupt' ? '✋' : '💬';
  const label = escapeHtml(playerName || 'Giocatore');
  div.innerHTML = `<div class="label">${icon} ${label}</div><div class="bubble">${escapeHtml(content)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
}

export function startGMMessage() {
  clearActionArea();
  const div = document.createElement('div');
  div.className = 'msg-gm';
  const cursor = `<span class="cursor"></span>`;
  div.innerHTML = `<div class="label">CUSTODE</div><div class="bubble">${cursor}</div>`;
  messages.appendChild(div);
  scrollToBottom();
  return div.querySelector('.bubble');
}

export function appendToGMBubble(bubble, token) {
  const cursor = bubble.querySelector('.cursor');
  if (cursor) cursor.remove();
  bubble.appendChild(document.createTextNode(token));
  bubble.insertAdjacentHTML('beforeend', '<span class="cursor"></span>');
  scrollToBottom();
}

export function finalizeGMBubble(bubble) {
  const cursor = bubble.querySelector('.cursor');
  if (cursor) cursor.remove();
}

export function appendSystemMessage(content, outcomeClass = '') {
  const div = document.createElement('div');
  div.className = `msg-system ${outcomeClass}`;
  div.innerHTML = `<div class="bubble">${escapeHtml(content)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
}

export function appendWhisperMessage(message) {
  const div = document.createElement('div');
  div.className = 'msg-whisper';
  div.innerHTML = `<div class="label">🤫 il Custode ti sussurra</div><div class="bubble">${escapeHtml(message)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
}

function appendGroupTransition(message) {
  const div = document.createElement('div');
  div.className = 'msg-group-transition';
  div.innerHTML = `<div class="bubble">${escapeHtml(message)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
}

function updateGroupUI() {
  const banner = document.getElementById('group-banner');
  if (!banner) return;
  if (!activeGroupId || currentGroups.length <= 1) {
    banner.style.display = 'none';
    return;
  }
  const myGroup = currentGroups.find((g) => g.members?.includes(myPlayerId));
  const activeGroup = currentGroups.find((g) => g.id === activeGroupId);
  const isMyTurn = myGroup?.id === activeGroupId;
  banner.style.display = 'block';
  banner.className = `group-banner ${isMyTurn ? 'active' : 'waiting'}`;
  const activeNames = activeGroup?.character_names?.join(', ') || '?';
  const activeLoc = activeGroup?.sub_location || '';
  banner.textContent = isMyTurn
    ? `È il turno del tuo gruppo — ${activeLoc || activeNames}`
    : `Il Custode segue un altro gruppo (${activeNames}${activeLoc ? ' — ' + activeLoc : ''})`;
}

export function appendSanEvent(event) {
  const div = document.createElement('div');
  div.className = 'event-san';
  const sign = event.loss > 0 ? `-${event.loss}` : '0';
  div.textContent = `SANITA' ${sign} (${event.reason}) → ${event.newSanity} rimasti`;
  messages.appendChild(div);
  if (event.loss > 0) {
    document.getElementById('character-panel').classList.add('san-flash');
    setTimeout(() => document.getElementById('character-panel').classList.remove('san-flash'), 800);
  }
  scrollToBottom();
}

// ── Diario ────────────────────────────────────────────────────────────────────

function addDiaryEntry(text, type = 'note') {
  const list = document.getElementById('diary-list');
  if (!list) return;
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const item = document.createElement('div');
  item.className = `diary-item diary-${type}`;
  item.textContent = text;
  list.appendChild(item);
}

// ── Sessione tab ──────────────────────────────────────────────────────────────

async function syncSessionTab() {
  if (!currentSessionId) return;
  try {
    const players = await api.getConnectedPlayers(currentSessionId);
    connectedPlayers.clear();
    for (const p of players) connectedPlayers.set(p.player_id, p.player_name);
    renderSessionTab();
  } catch (_) {}
}

function renderSessionTab() {
  const list = document.getElementById('session-players-list');
  if (!list) return;
  if (connectedPlayers.size === 0) {
    list.innerHTML = '<div class="empty-state">Nessun giocatore connesso.</div>';
    return;
  }
  list.innerHTML = Array.from(connectedPlayers.entries())
    .map(([id, name]) => {
      const label = id === myPlayerId ? `${escapeHtml(name)} (Tu)` : escapeHtml(name);
      return `<div class="session-player-item${id === myPlayerId ? ' me' : ''}">${label}</div>`;
    })
    .join('');
}

// ── History replay ────────────────────────────────────────────────────────────

function appendGMMessageStatic(content) {
  const div = document.createElement('div');
  div.className = 'msg-gm';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.appendChild(document.createTextNode(content));
  div.innerHTML = '<div class="label">CUSTODE</div>';
  div.appendChild(bubble);
  messages.appendChild(div);
  scrollToBottom();
}

export async function loadHistory(sessionId, multi) {
  try {
    const history = await api.getHistory(sessionId);
    if (!history.length) return;

    for (const entry of history) {
      if (entry.role === 'gm' && entry.content) {
        appendGMMessageStatic(entry.content);

      } else if (entry.role === 'player' && entry.content) {
        const mt = entry.message_type;
        if (mt === 'comment' || mt === 'interrupt') {
          const name = entry.player_name || (multi ? entry.player_id : null) || 'Giocatore';
          appendCommentMessage(entry.content, name, mt);
        } else {
          if (entry.content.startsWith('[SISTEMA')) continue;
          const name = multi ? (entry.player_name || entry.player_id || null) : null;
          appendPlayerMessage(entry.content, name);
        }

      } else if (entry.role === 'system' && entry.dice_result) {
        const r = entry.dice_result;
        const cls = ['success', 'extreme', 'hard'].includes(r.outcome) ? 'success' : 'failure';
        appendSystemMessage(`Tiro: ${r.skillName} → ${r.roll} (${r.label})`, cls);
      }
    }
  } catch (_) {
    // History non disponibile — non bloccare
  }
}

// ── Azioni suggerite ──────────────────────────────────────────────────────────

async function sendQuickAction(action, sessionId) {
  const sid = sessionId || currentSessionId;

  if (isMultiplayer) {
    if (floorState.state !== 'open' && !(floorState.state === 'player' && floorState.player_id === myPlayerId)) {
      appendSystemMessage('Non hai la parola al momento.', 'failure');
      return;
    }
    // Nessun player bubble — l'azione è un comando silenzioso
    clearActionArea();
    try {
      await api.playerTurn(sid, action, { quickAction: true });
    } catch (err) {
      appendSystemMessage(`Errore: ${err.message}`, 'failure');
    }
  } else {
    if (isStreaming) return;
    clearActionArea();
    try {
      await api.playerTurn(sid, action, { quickAction: true });
      openGMStream(sid);
    } catch (err) {
      appendSystemMessage(`Errore: ${err.message}`, 'failure');
    }
  }
}

function renderSuggestedActions(actions, sessionId) {
  if (!actions?.length) return;
  for (const action of actions.slice(0, 4)) {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = action;
    btn.addEventListener('click', async () => {
      clearActionArea();
      await sendQuickAction(action, sessionId);
    });
    actionArea.appendChild(btn);
  }
}

function handleGameEvent(event) {
  switch (event.type) {
    case 'sanity_loss':
      appendSanEvent(event);
      break;
    case 'hp_change':
      if (event.delta < 0) appendSystemMessage(`PS ${event.delta} (${event.reason}) → ${event.newHp} rimasti`, 'failure');
      else appendSystemMessage(`PS +${event.delta} (${event.reason}) → ${event.newHp}`, 'success');
      break;
    case 'clue_found':
      appendSystemMessage(`Nuovo indizio: "${event.clue}"`, 'success');
      addDiaryEntry(`◈ ${event.clue}${event.description ? ' — ' + event.description : ''}`, 'clue');
      break;
    case 'item_gained':
      appendSystemMessage(`Oggetto acquisito: ${event.item}`, 'success');
      addDiaryEntry(`+ ${event.item}`, 'item-gained');
      break;
    case 'item_lost':
      appendSystemMessage(`Oggetto perso: ${event.item}`);
      break;
  }
}

export function clearActionArea() {
  actionArea.innerHTML = '';
}

// ── Helpers comuni ────────────────────────────────────────────────────────────

export function setSession(sessionId) {
  currentSessionId = sessionId;

  // Carica note personali (single-player o primo caricamento)
  const notesEl = document.getElementById('player-notes');
  if (notesEl && !notesEl.dataset.bound) {
    const saved = localStorage.getItem(`llm-notes-${sessionId}`);
    if (saved) notesEl.value = saved;
    notesEl.addEventListener('input', () => {
      localStorage.setItem(`llm-notes-${sessionId}`, notesEl.value);
    });
    notesEl.dataset.bound = '1';
  }

  // Inizializza color picker nuvolette
  const picker = document.getElementById('player-color-picker');
  if (picker && !picker.dataset.bound) {
    const savedColor = localStorage.getItem('llm-player-color') || '#1a4a2a';
    picker.value = savedColor;
    document.documentElement.style.setProperty('--player-color', savedColor);
    picker.addEventListener('input', () => {
      document.documentElement.style.setProperty('--player-color', picker.value);
      localStorage.setItem('llm-player-color', picker.value);
    });
    picker.dataset.bound = '1';
  }
}

export function setStreaming(val) {
  isStreaming = val;
  if (!isMultiplayer) {
    if (inputText) inputText.disabled = val;
    if (declareBtn) declareBtn.disabled = val;
  }
  if (!val) {
    if (!isMultiplayer && inputText) inputText.focus();
    setStatus('');
  }
}

export function setStatus(msg) {
  if (statusText) statusText.textContent = msg;
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
