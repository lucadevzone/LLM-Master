/**
 * UI per i tiri dado: pulsante nel row input, animazione nell'action area.
 */

import { api } from './api.js';
import { appendSystemMessage, clearActionArea, openGMStream } from './chat.js';

const actionArea = document.getElementById('action-area');

const OUTCOME_LABELS = {
  extreme: 'Successo Estremo',
  hard:    'Successo Difficile',
  success: 'Successo',
  failure: 'Fallimento',
  fumble:  'Fumble',
};

const OUTCOME_ICONS = {
  extreme: '✦',
  hard:    '◆',
  success: '●',
  failure: '○',
  fumble:  '✖',
};

/**
 * Mostra il pulsante dado nel row input con skill e tipo di dado.
 * @param {Object} diceData - { skill, skill_value, difficulty, reason, on_success, on_failure, on_extreme }
 * @param {string} sessionId
 */
export function renderDiceButton(diceData, sessionId) {
  const btn = document.getElementById('dice-action-btn');
  if (!btn) return;

  btn.textContent = `⬡ ${diceData.skill} (d100)`;
  btn.title = diceData.reason || `Prova di ${diceData.skill}`;
  btn.style.display = '';
  btn.disabled = false;

  // Sostituisce eventuali handler precedenti
  btn.onclick = () => {
    btn.style.display = 'none';
    btn.onclick = null;
    performRoll(diceData, sessionId);
  };
}

async function performRoll(diceData, sessionId) {
  // Elemento animazione nell'action area
  const animEl = document.createElement('div');
  animEl.className = 'dice-rolling-anim';
  animEl.textContent = '⬡ ...';
  actionArea.appendChild(animEl);

  await sleep(300);
  const rawRoll = Math.floor(Math.random() * 100) + 1;
  await animateRoll(animEl, rawRoll);

  try {
    const result = await api.diceResult(sessionId, diceData.skill, rawRoll);
    clearActionArea();

    const icon = OUTCOME_ICONS[result.outcome] || '●';
    const label = OUTCOME_LABELS[result.outcome] || result.outcome;
    appendSystemMessage(
      `${icon} ${diceData.skill}: ${result.roll} / ${result.skillValue} — ${label}`,
      result.outcome
    );

    const context = (result.outcome === 'failure' || result.outcome === 'fumble')
      ? diceData.on_failure
      : result.outcome === 'extreme'
        ? diceData.on_extreme
        : diceData.on_success;

    if (context) {
      appendSystemMessage(
        context,
        (result.outcome === 'failure' || result.outcome === 'fumble') ? 'failure' : 'success'
      );
    }

    if (result.canPush) {
      renderPushButton(diceData, sessionId);
    } else {
      openGMStream(sessionId);
    }
  } catch (err) {
    clearActionArea();
    appendSystemMessage(`Errore tiro: ${err.message}`, 'failure');
  }
}

function renderPushButton(diceData, sessionId) {
  const pushBtn = document.createElement('button');
  pushBtn.className = 'action-btn';
  pushBtn.textContent = `Spingere il tiro (${diceData.skill}) — a rischio!`;

  const skipBtn = document.createElement('button');
  skipBtn.className = 'action-btn';
  skipBtn.textContent = 'Accettare il fallimento';

  pushBtn.addEventListener('click', async () => {
    clearActionArea();
    const newRoll = Math.floor(Math.random() * 100) + 1;
    const result = await api.diceResult(sessionId, diceData.skill, newRoll);
    appendSystemMessage(
      `PUSH: ${diceData.skill} ${newRoll}/${result.skillValue} — ${OUTCOME_LABELS[result.outcome] || result.outcome}`,
      result.outcome
    );
    openGMStream(sessionId);
  });

  skipBtn.addEventListener('click', () => {
    clearActionArea();
    openGMStream(sessionId);
  });

  actionArea.appendChild(pushBtn);
  actionArea.appendChild(skipBtn);
}

async function animateRoll(el, finalValue) {
  const frames = 12;
  for (let i = 0; i < frames; i++) {
    const fake = Math.floor(Math.random() * 100) + 1;
    el.textContent = `⬡ ${String(fake).padStart(2, '0')}`;
    await sleep(50 + i * 8);
  }
  el.textContent = `⬡ ${finalValue}`;
  await sleep(200);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
