import { derivedStats, BASE_SKILLS, computeSkillValue } from './cocRules.js';

/**
 * Crea una scheda personaggio vuota con valori di default.
 */
export function createCharacter({ id, meta, characteristics, skillAllocations = {}, backstory = {} }) {
  const derived = derivedStats(characteristics);

  // Calcola tutte le skill con i punti allocati
  const skills = {};
  for (const [name, base] of Object.entries(BASE_SKILLS)) {
    skills[name] = computeSkillValue(name, skillAllocations[name] || 0);
  }
  // Aggiungi skill con allocazione che non sono nella lista base
  for (const [name, pts] of Object.entries(skillAllocations)) {
    if (!skills[name]) skills[name] = computeSkillValue(name, pts);
  }

  return {
    id,
    created_at: new Date().toISOString(),
    meta: {
      name: meta.name || 'Senza nome',
      occupation: meta.occupation || '',
      age: meta.age || 30,
      sex: meta.sex || '',
      birthplace: meta.birthplace || '',
      residence: meta.residence || '',
    },
    characteristics: { ...characteristics },
    derived: {
      hp_max: derived.hp_max,
      hp_current: derived.hp_max,
      mp_max: derived.mp_max,
      mp_current: derived.mp_max,
      sanity_max: derived.sanity_max,
      sanity_current: derived.sanity_max,
      luck: derived.luck,
      damage_bonus: derived.damage_bonus,
      build: derived.build,
    },
    skills,
    inventory: [],
    backstory: {
      personal_description: backstory.personal_description || '',
      ideology_beliefs: backstory.ideology_beliefs || '',
      significant_people: backstory.significant_people || '',
      meaningful_locations: backstory.meaningful_locations || '',
      treasured_possessions: backstory.treasured_possessions || '',
      traits: backstory.traits || '',
      injuries_scars: backstory.injuries_scars || '',
    },
    mythos_knowledge: 0,
  };
}

/**
 * Applica una modifica HP al personaggio (danno o guarigione).
 * @returns {Object} personaggio aggiornato
 */
export function applyHpChange(character, delta) {
  const current = character.derived.hp_current;
  const max = character.derived.hp_max;
  const newHp = Math.max(0, Math.min(max, current + delta));
  return {
    ...character,
    derived: { ...character.derived, hp_current: newHp },
  };
}

/**
 * Applica una perdita di Sanità.
 * @returns {{ character: Object, newInsanity: boolean }}
 */
export function applySanityLoss(character, loss) {
  const current = character.derived.sanity_current;
  const newSan = Math.max(0, current - loss);
  const newInsanity = loss >= 5 || newSan === 0;

  return {
    character: {
      ...character,
      derived: { ...character.derived, sanity_current: newSan },
    },
    newInsanity,
  };
}

/**
 * Aggiunge un oggetto all'inventario.
 */
export function addInventoryItem(character, item) {
  return {
    ...character,
    inventory: [...character.inventory, { ...item, id: Date.now().toString() }],
  };
}

/**
 * Rimuove un oggetto dall'inventario per id o nome.
 */
export function removeInventoryItem(character, itemIdOrName) {
  return {
    ...character,
    inventory: character.inventory.filter(
      (i) => i.id !== itemIdOrName && i.name !== itemIdOrName
    ),
  };
}

/**
 * Formato compatto della scheda per iniettarla nel prompt GM.
 */
export function characterSummaryForPrompt(character) {
  const { meta, characteristics, derived, skills, inventory, mythos_knowledge } = character;
  const { STR, CON, SIZ, DEX, APP, INT, POW, EDU } = characteristics;

  const skillLines = Object.entries(skills)
    .filter(([, v]) => v > 20)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v}%`)
    .join('\n');

  const invLine = inventory.length
    ? inventory.map((i) => i.name || i).join(', ')
    : 'nessuno';

  return `## Personaggio: ${meta.name} (${meta.occupation})
Età: ${meta.age} | Residenza: ${meta.residence}

### Caratteristiche
STR ${STR} | CON ${CON} | SIZ ${SIZ} | DEX ${DEX} | APP ${APP} | INT ${INT} | POW ${POW} | EDU ${EDU}

### Stato
PS: ${derived.hp_current}/${derived.hp_max} | PM: ${derived.mp_current}/${derived.mp_max} | SAN: ${derived.sanity_current}/${derived.sanity_max} | Fortuna: ${derived.luck}

### Skill principali (>20%)
${skillLines || '  (nessuna skill specializzata)'}

### Inventario
${invLine}

### Conoscenza del Mito: ${mythos_knowledge}%`;
}
