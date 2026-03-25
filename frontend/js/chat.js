/**
 * Gestione chat: rendering messaggi e SSE streaming.
 */

import { api } from './api.js';
import { updateCharacterPanel } from './characterSheet.js';
import { renderDiceButton } from './dice.js';

const messages = document.getElementById('messages');
const actionArea = document.getElementById('action-area');
const inputText = document.getElementById('input-text');
const sendBtn = document.getElementById('send-btn');
const statusText = document.getElementById('status-text');

let currentSessionId = null;
let isStreaming = false;

export function setSession(sessionId) {
  currentSessionId = sessionId;
}

export function setStreaming(val) {
  isStreaming = val;
  inputText.disabled = val;
  sendBtn.disabled = val;
  if (!val) {
    inputText.focus();
    setStatus('');
  }
}

export function setStatus(msg) {
  statusText.textContent = msg;
}

// ── Rendering messaggi ────────────────────────────────────────────────────────

export function appendPlayerMessage(content) {
  const div = document.createElement('div');
  div.className = 'msg-player';
  div.innerHTML = `<div class="label">TU</div><div class="bubble">${escapeHtml(content)}</div>`;
  messages.appendChild(div);
  scrollToBottom();
  return div;
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
  // Rimuovi cursore se presente, aggiungi token, rimetti cursore
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

// ── SSE Stream ────────────────────────────────────────────────────────────────

export function openGMStream(sessionId) {
  setStreaming(true);
  let gmBubble = null;
  let fullNarrative = '';

  const evtSource = new EventSource(`/api/sessions/${sessionId}/stream`);

  evtSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    setStatus(data.message);
  });

  evtSource.addEventListener('token', (e) => {
    const data = JSON.parse(e.data);
    if (!gmBubble) gmBubble = startGMMessage();
    appendToGMBubble(gmBubble, data.content);
    fullNarrative += data.content;
  });

  evtSource.addEventListener('dice_request', (e) => {
    const data = JSON.parse(e.data);
    renderDiceButton(data, sessionId);
  });

  evtSource.addEventListener('ui_hints', (e) => {
    const data = JSON.parse(e.data);
    renderSuggestedActions(data.suggested_actions, sessionId);
  });

  evtSource.addEventListener('game_event', (e) => {
    const event = JSON.parse(e.data);
    handleGameEvent(event);
  });

  evtSource.addEventListener('character_update', (e) => {
    const data = JSON.parse(e.data);
    updateCharacterPanel(data);
  });

  evtSource.addEventListener('error', (e) => {
    try {
      const data = JSON.parse(e.data);
      appendSystemMessage(`Errore: ${data.message}`, 'failure');
    } catch (_) {}
    evtSource.close();
    if (gmBubble) finalizeGMBubble(gmBubble);
    setStreaming(false);
  });

  evtSource.addEventListener('done', (e) => {
    evtSource.close();
    if (gmBubble) finalizeGMBubble(gmBubble);
    setStreaming(false);
  });

  // Fallback: errore di connessione SSE
  evtSource.onerror = () => {
    evtSource.close();
    if (gmBubble) finalizeGMBubble(gmBubble);
    setStreaming(false);
    setStatus('');
  };
}

// ── Azioni suggerite ──────────────────────────────────────────────────────────

function renderSuggestedActions(actions, sessionId) {
  if (!actions?.length) return;
  for (const action of actions.slice(0, 4)) {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = action;
    btn.addEventListener('click', async () => {
      clearActionArea();
      await sendPlayerAction(action, sessionId);
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
      appendSystemMessage(`Nuovo indizio: "${event.clue}" — ${event.description}`, 'success');
      break;
    case 'item_gained':
      appendSystemMessage(`Oggetto acquisito: ${event.item}`, 'success');
      break;
    case 'item_lost':
      appendSystemMessage(`Oggetto perso: ${event.item}`);
      break;
  }
}

export function clearActionArea() {
  actionArea.innerHTML = '';
}

// ── Invio azione giocatore ────────────────────────────────────────────────────

export async function sendPlayerAction(content, sessionId) {
  if (!content.trim() || isStreaming) return;
  const sid = sessionId || currentSessionId;

  appendPlayerMessage(content);
  clearActionArea();

  try {
    await api.playerTurn(sid, content);
    openGMStream(sid);
  } catch (err) {
    appendSystemMessage(`Errore: ${err.message}`, 'failure');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
