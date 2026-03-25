/**
 * Pannello scheda personaggio (destra).
 * Mostra statistiche, skill, inventario, indizi.
 */

let currentCharacter = null;

export function initCharacterPanel(character) {
  currentCharacter = character;
  renderFull(character);
}

export function updateCharacterPanel(update) {
  if (!currentCharacter) return;

  if (update.hp !== undefined) currentCharacter.derived.hp_current = update.hp;
  if (update.mp !== undefined) currentCharacter.derived.mp_current = update.mp;
  if (update.san !== undefined) currentCharacter.derived.sanity_current = update.san;

  renderBars(currentCharacter.derived);
}

export function addClueToPanel(clue) {
  if (!currentCharacter) return;
  if (!currentCharacter._clues) currentCharacter._clues = [];
  currentCharacter._clues.push(clue);
  renderClues(currentCharacter._clues);
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function renderFull(ch) {
  const panel = document.getElementById('character-panel');
  panel.innerHTML = `
    <div class="char-section">
      <div class="char-section-title">Personaggio</div>
      <div class="char-name">${ch.meta.name}</div>
      <div class="char-occupation">${ch.meta.occupation}</div>
      <div class="char-occupation" style="color: var(--text-dim); font-size: 0.7rem; margin-top: 0.2rem">
        ${ch.meta.age} anni · ${ch.meta.residence || ''}
      </div>
    </div>

    <div class="char-section" id="panel-bars">
      <div class="char-section-title">Stato</div>
    </div>

    <div class="char-section" id="panel-chars">
      <div class="char-section-title">Caratteristiche</div>
    </div>

    <div class="char-section" id="panel-skills">
      <div class="char-section-title">Skill</div>
    </div>

    <div class="char-section" id="panel-inventory">
      <div class="char-section-title">Inventario</div>
    </div>

    <div class="char-section" id="panel-clues">
      <div class="char-section-title">Indizi</div>
    </div>

    <div class="char-section" style="padding-bottom: 1rem">
      <div class="char-section-title">Mito</div>
      <div style="font-size: 0.8rem; color: var(--san-light)">${ch.mythos_knowledge}%</div>
    </div>
  `;

  renderBars(ch.derived);
  renderCharacteristics(ch.characteristics);
  renderSkills(ch.skills);
  renderInventory(ch.inventory);
  renderClues([]);
}

function renderBars(derived) {
  const container = document.getElementById('panel-bars');
  if (!container) return;
  const hp = derived.hp_current;
  const hpMax = derived.hp_max;
  const mp = derived.mp_current;
  const mpMax = derived.mp_max;
  const san = derived.sanity_current;
  const sanMax = derived.sanity_max;

  container.innerHTML = `
    <div class="char-section-title">Stato</div>
    ${statBar('PS', hp, hpMax, 'hp')}
    ${statBar('PM', mp, mpMax, 'mp')}
    ${statBar('SAN', san, sanMax, 'san')}
    <div class="skill-row" style="margin-top: 0.3rem">
      <span class="skill-name">Fortuna</span>
      <span class="skill-val">${derived.luck || '—'}</span>
    </div>
  `;
}

function statBar(label, current, max, type) {
  const pct = max > 0 ? Math.round((current / max) * 100) : 0;
  const fillType = pct < 30 ? 'low' : type;
  return `
    <div class="stat-bar-row">
      <div class="stat-bar-label">
        <span class="name">${label}</span>
        <span class="value">${current}/${max}</span>
      </div>
      <div class="stat-bar">
        <div class="stat-bar-fill ${fillType}" style="width: ${pct}%"></div>
      </div>
    </div>
  `;
}

function renderCharacteristics(chars) {
  const container = document.getElementById('panel-chars');
  if (!container) return;
  const entries = Object.entries(chars)
    .map(([k, v]) => `<div class="skill-row"><span class="skill-name">${k}</span><span class="skill-val">${v}</span></div>`)
    .join('');
  container.innerHTML = `<div class="char-section-title">Caratteristiche</div><div class="skill-list">${entries}</div>`;
}

function renderSkills(skills) {
  const container = document.getElementById('panel-skills');
  if (!container) return;
  const topSkills = Object.entries(skills)
    .filter(([, v]) => v > 20)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (!topSkills.length) {
    container.innerHTML = `<div class="char-section-title">Skill</div><div style="font-size:0.75rem; color:var(--text-dim)">nessuna skill specializzata</div>`;
    return;
  }

  const rows = topSkills
    .map(([k, v]) => `<div class="skill-row"><span class="skill-name">${k}</span><span class="skill-val">${v}%</span></div>`)
    .join('');
  container.innerHTML = `<div class="char-section-title">Skill</div><div class="skill-list">${rows}</div>`;
}

function renderInventory(inventory) {
  const container = document.getElementById('panel-inventory');
  if (!container) return;
  if (!inventory?.length) {
    container.innerHTML = `<div class="char-section-title">Inventario</div><div style="font-size:0.75rem; color:var(--text-dim)">vuoto</div>`;
    return;
  }
  const items = inventory.map((i) => `<div class="inventory-item">${i.name || i}</div>`).join('');
  container.innerHTML = `<div class="char-section-title">Inventario</div><div class="inventory-list">${items}</div>`;
}

function renderClues(clues) {
  const container = document.getElementById('panel-clues');
  if (!container) return;
  if (!clues?.length) {
    container.innerHTML = `<div class="char-section-title">Indizi</div><div style="font-size:0.75rem; color:var(--text-dim)">nessuno</div>`;
    return;
  }
  const items = clues.map((c) => `<div class="clue-item">◈ ${typeof c === 'string' ? c : c.clue}</div>`).join('');
  container.innerHTML = `<div class="char-section-title">Indizi</div><div class="clue-list">${items}</div>`;
}
