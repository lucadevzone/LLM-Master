/**
 * Meccaniche dadi per Call of Cthulhu.
 * Tutte le funzioni sono pure (no side effects).
 */

/**
 * Lancia un singolo dado a N facce.
 */
export function rollDie(faces) {
  return Math.floor(Math.random() * faces) + 1;
}

/**
 * Lancia NdF (es. 3d6, 1d100, 2d6+3).
 * Supporta espressioni: "3d6", "1d100", "2d6+3", "1d4-1"
 * @returns {{ total: number, rolls: number[], expression: string }}
 */
export function rollExpression(expression) {
  const match = expression.trim().toLowerCase().match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) throw new Error(`Espressione dado non valida: ${expression}`);

  const count = parseInt(match[1], 10);
  const faces = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  const rolls = Array.from({ length: count }, () => rollDie(faces));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;

  return { total, rolls, expression };
}

/**
 * Lancia 1d100 (percentile).
 */
export function rollD100() {
  return rollDie(100);
}

/**
 * Valuta l'esito di un tiro percentuale Call of Cthulhu 7e.
 * @param {number} roll  - risultato del d100 (1-100)
 * @param {number} skill - valore della skill (0-100)
 * @returns {'extreme'|'hard'|'success'|'failure'|'fumble'}
 */
export function evaluateRoll(roll, skill) {
  if (roll === 1) return 'extreme'; // critico assoluto
  if (roll >= 96) return 'fumble'; // fumble (96-100; 96+ se skill < 50)
  if (skill < 50 && roll >= 96) return 'fumble';
  if (roll <= Math.floor(skill / 5)) return 'extreme';
  if (roll <= Math.floor(skill / 2)) return 'hard';
  if (roll <= skill) return 'success';
  return 'failure';
}

/**
 * Esegue un tiro completo di skill e ritorna tutti i dettagli.
 * @param {number} skillValue - valore percentuale della skill
 * @param {string} skillName  - nome della skill (per display)
 * @returns {{ roll, skillValue, outcome, label, canPush }}
 */
export function performSkillRoll(skillValue, skillName = '') {
  const roll = rollD100();
  const outcome = evaluateRoll(roll, skillValue);
  const canPush = outcome === 'failure'; // solo i fallimenti normali si possono "spingere"

  const labels = {
    extreme:  'Successo Estremo',
    hard:     'Successo Difficile',
    success:  'Successo',
    failure:  'Fallimento',
    fumble:   'Fumble',
  };

  return {
    roll,
    skillValue,
    skillName,
    outcome,
    label: labels[outcome],
    canPush,
  };
}

/**
 * Esegue un tiro di Sanità.
 * @param {number} sanityValue - valore SAN attuale
 * @returns {{ roll, outcome, canPush }}
 */
export function performSanityRoll(sanityValue) {
  return performSkillRoll(sanityValue, 'Sanità');
}

/**
 * Calcola la perdita di Sanità in base all'esito del tiro.
 * @param {string} outcome   - esito del tiro SAN
 * @param {string} lossOnSuccess - espressione dado per successo (es. "0" o "1")
 * @param {string} lossOnFailure - espressione dado per fallimento (es. "1d6")
 * @returns {number} punti SAN persi
 */
export function calculateSanityLoss(outcome, lossOnSuccess, lossOnFailure) {
  const expr = (outcome === 'success' || outcome === 'hard' || outcome === 'extreme')
    ? lossOnSuccess
    : lossOnFailure;

  // Supporta valori fissi (es. "0", "1", "2") o espressioni dado
  if (/^\d+$/.test(expr.trim())) return parseInt(expr, 10);
  return rollExpression(expr).total;
}
