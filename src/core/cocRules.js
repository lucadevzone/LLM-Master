/**
 * Regole Call of Cthulhu 7a Edizione.
 * Calcolo statistiche derivate, formule personaggio, ecc.
 */

/**
 * Calcola tutte le statistiche derivate da quelle base.
 * @param {Object} chars - { STR, CON, SIZ, DEX, APP, INT, POW, EDU }
 * @returns {Object} statistiche derivate
 */
export function derivedStats(chars) {
  const { CON, SIZ, POW } = chars;
  return {
    hp_max: Math.floor((CON + SIZ) / 10),
    mp_max: Math.floor(POW / 5),
    sanity_max: POW * 5,
    luck: POW * 5,
    // Bonus danno e Corporatura
    ...buildBonus(chars),
  };
}

/**
 * Calcola bonus danno e corporatura (tabella CoC 7e).
 */
function buildBonus({ STR, SIZ }) {
  const total = STR + SIZ;
  if (total <= 64)  return { damage_bonus: '-2',  build: -2 };
  if (total <= 84)  return { damage_bonus: '-1',  build: -1 };
  if (total <= 124) return { damage_bonus: '0',   build: 0  };
  if (total <= 164) return { damage_bonus: '+1d4', build: 1 };
  if (total <= 204) return { damage_bonus: '+1d6', build: 2 };
  return { damage_bonus: '+2d6', build: 3 };
}

/**
 * Tira le caratteristiche base per un nuovo personaggio.
 * Ritorna i valori × 5 (come da regolamento 7e).
 */
export function rollCharacteristics() {
  const d6 = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1)
    .reduce((a, b) => a + b, 0);

  return {
    STR: d6(3) * 5,
    CON: d6(3) * 5,
    SIZ: (d6(2) + 6) * 5,
    DEX: d6(3) * 5,
    APP: d6(3) * 5,
    INT: (d6(2) + 6) * 5,
    POW: d6(3) * 5,
    EDU: (d6(2) + 6) * 5,
  };
}

/**
 * Occupazioni disponibili con formule punti skill e skill di occupazione.
 */
export const OCCUPATIONS = {
  'Professore': {
    label: 'Professore Universitario',
    skillPoints: (chars) => chars.EDU * 4,
    creditRating: [30, 70],
    skills: ['Biblioteca', 'Storia', 'Occulto', 'Psicologia', 'Linguaggio Straniero', 'Insegnare', 'Scienze', 'Persuasione'],
  },
  'Medico': {
    label: 'Medico',
    skillPoints: (chars) => chars.EDU * 4,
    creditRating: [30, 80],
    skills: ['Pronto Soccorso', 'Medicina', 'Psicologia', 'Biologia', 'Farmacologia', 'Persuasione', 'Linguaggio Straniero', 'Biblioteca'],
  },
  'Investigatore_privato': {
    label: 'Investigatore Privato',
    skillPoints: (chars) => chars.EDU * 2 + chars.INT * 2,
    creditRating: [9, 30],
    skills: ['Legge', 'Biblioteca', 'Psicologia', 'Individuare', 'Ascolto', 'Mascheramento', 'Persuasione', 'Pistola'],
  },
  'Giornalista': {
    label: 'Giornalista',
    skillPoints: (chars) => chars.EDU * 4,
    creditRating: [9, 30],
    skills: ['Biblioteca', 'Fotografia', 'Psicologia', 'Individuare', 'Persuasione', 'Linguaggio Straniero', 'Dattilografia', 'Storia'],
  },
  'Militare': {
    label: 'Militare',
    skillPoints: (chars) => chars.EDU * 2 + (chars.DEX + chars.STR) * 2,
    creditRating: [9, 30],
    skills: ['Armi da Fuoco', 'Armi Bianche', 'Pronto Soccorso', 'Atletica', 'Nuoto', 'Sopravvivenza', 'Meccanica', 'Intimidire'],
  },
  'Antiquario': {
    label: 'Antiquario',
    skillPoints: (chars) => chars.EDU * 4,
    creditRating: [30, 70],
    skills: ['Valutare', 'Storia', 'Biblioteca', 'Contrattare', 'Individuare', 'Occulto', 'Linguaggio Straniero', 'Persuasione'],
  },
};

/**
 * Lista delle skill base con valori di partenza.
 */
export const BASE_SKILLS = {
  'Armi Bianche (Coltello)': 25,
  'Armi da Fuoco (Pistola)': 20,
  'Armi da Fuoco (Fucile)': 25,
  'Arte e Artigianato': 5,
  'Ascoltare': 20,
  'Atletica': 20,
  'Biblioteca': 20,
  'Biologia': 1,
  'Chimica': 1,
  'Contrattare': 5,
  'Elettrica': 10,
  'Equitazione': 5,
  'Furtività': 20,
  'Geologia': 1,
  'Guidare (Auto)': 20,
  'Individuare': 25,
  'Informatica': 5,
  'Intimidire': 15,
  'Legge': 5,
  'Linguaggio Straniero': 1,
  'Mascheramento': 5,
  'Meccanica': 10,
  'Medicina': 1,
  'Navigare': 10,
  'Nuoto': 20,
  'Occulto': 5,
  'Persuasione': 10,
  'Pilotare': 1,
  'Pronto Soccorso': 30,
  'Psicanalisi': 1,
  'Psicologia': 10,
  'Scienze': 1,
  'Sopravvivenza': 10,
  'Storia': 5,
  'Valutare': 5,
  'Insegnare': 5,
  'Fotografia': 5,
  'Dattilografia': 10,
  'Farmacologia': 1,
};

/**
 * Calcola il valore di una skill sommando base + punti allocati.
 */
export function computeSkillValue(skillName, allocated) {
  const base = BASE_SKILLS[skillName] ?? 1;
  return Math.min(base + (allocated || 0), 99);
}
