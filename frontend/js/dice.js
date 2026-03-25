/**
 * UI per i tiri dado: pulsante interattivo, animazione, risultato.
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
 * Renderizza il pulsante dado nell'action area.
 * @param {Object} diceData - { skill, skill_value, difficulty, reason, on_success, on_failure, on_extreme }
 * @param {string} sessionId
 */
export function renderDiceButton(diceData, sessionId) {
  const btn = document.createElement('button');
  btn.className = 'dice-btn';
  btn.innerHTML = `
    <span class="dice-icon">⬡</span>
    <span class="skill-name">${diceData.skill}</span>
    <span class="skill-value">${diceData.skill_value}%</span>
    <span class="dice-reason">[${diceData.difficulty}]</span>
  `;

  if (diceData.reason) {
    btn.title = diceData.reason;
  }

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.style.animation = 'none';
    performRoll(diceData, sessionId, btn);
  });

  actionArea.appendChild(btn);
}

async function performRoll(diceData, sessionId, btn) {
  // Animazione dado che "gira"
  btn.innerHTML = `<span class="dice-icon">⬡</span> <span>...</span>`;

  // Piccola pausa drammatica
  await sleep(300);

  // Genera il roll localmente per l'animazione
  const rawRoll = Math.floor(Math.random() * 100) + 1;

  // Animazione contatore
  await animateRoll(btn, rawRoll);

  try {
    // Invia al server per registrazione e risposta GM
    const result = await api.diceResult(sessionId, diceData.skill, rawRoll);

    clearActionArea();

    // Mostra risultato
    const outcomeClass = result.outcome;
    const icon = OUTCOME_ICONS[result.outcome] || '●';
    const label = OUTCOME_LABELS[result.outcome] || result.outcome;
    appendSystemMessage(
      `${icon} ${diceData.skill}: ${result.roll} / ${result.skillValue} — ${label}`,
      outcomeClass
    );

    // Se il GM ha un'informazione contestuale (on_success/on_failure), mostrala
    const context = result.outcome === 'failure' ? diceData.on_failure
      : result.outcome === 'fumble' ? diceData.on_failure
      : result.outcome === 'extreme' ? diceData.on_extreme
      : diceData.on_success;

    if (context) {
      appendSystemMessage(context, result.outcome === 'failure' || result.outcome === 'fumble' ? 'failure' : 'success');
    }

    // Push disponibile?
    if (result.canPush) {
      renderPushButton(diceData, sessionId, rawRoll);
    } else {
      // Il GM risponde al risultato
      openGMStream(sessionId);
    }

  } catch (err) {
    clearActionArea();
    appendSystemMessage(`Errore tiro: ${err.message}`, 'failure');
  }
}

function renderPushButton(diceData, sessionId, previousRoll) {
  const pushBtn = document.createElement('button');
  pushBtn.className = 'action-btn';
  pushBtn.textContent = `Spingere il tiro (${diceData.skill}) — a rischio!`;

  const skipBtn = document.createElement('button');
  skipBtn.className = 'action-btn';
  skipBtn.textContent = 'Accettare il fallimento';

  pushBtn.addEventListener('click', async () => {
    clearActionArea();
    // Nuovo tiro con pushed=true
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

async function animateRoll(btn, finalValue) {
  const frames = 12;
  for (let i = 0; i < frames; i++) {
    const fake = Math.floor(Math.random() * 100) + 1;
    btn.innerHTML = `<span class="dice-icon">⬡</span> <strong>${String(fake).padStart(2, '0')}</strong>`;
    await sleep(50 + i * 8);
  }
  btn.innerHTML = `<span class="dice-icon">⬡</span> <strong>${finalValue}</strong>`;
  await sleep(200);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
