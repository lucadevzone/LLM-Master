/**
 * Traccia quante volte ogni personaggio ha ricevuto un turno di gioco.
 * Permette al GM di vedere chi è stato meno coinvolto e bilanciare di conseguenza.
 *
 * I dati sono salvati in world_state.turn_counts: { [charName]: number }
 */

/**
 * Incrementa il contatore turni per un personaggio.
 * Modifica worldState in place (chiama dopo deepClone).
 *
 * @param {Object} worldState
 * @param {string} characterName
 * @returns {Object} worldState modificato
 */
export function recordTurn(worldState, characterName) {
  if (!characterName) return worldState;
  if (!worldState.turn_counts) worldState.turn_counts = {};
  worldState.turn_counts[characterName] = (worldState.turn_counts[characterName] || 0) + 1;
  return worldState;
}

/**
 * Costruisce la sezione "turni per personaggio" da iniettare nel prompt GM.
 * Mostra chi ha giocato di più e chi è rimasto indietro.
 *
 * @param {Object} worldState
 * @param {string[]} partyNames - nomi di tutti i PG nel gruppo
 * @returns {string|null}
 */
export function buildTurnMonitorSection(worldState, partyNames) {
  if (!partyNames?.length || partyNames.length < 2) return null;

  const counts = worldState.turn_counts || {};
  const rows = partyNames.map((name) => ({ name, count: counts[name] || 0 }));
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return null;

  rows.sort((a, b) => b.count - a.count);
  const max = rows[0].count;
  const min = rows[rows.length - 1].count;

  const lines = ['## COINVOLGIMENTO DEI PERSONAGGI'];
  lines.push('Turni ricevuti in questa sessione:');

  for (const { name, count } of rows) {
    let marker = '';
    if (count === max && max !== min) marker = ' ★';
    if (count === min && max !== min) marker = ' ⚠ poco coinvolto';
    lines.push(`  ${name}: ${count} turni${marker}`);
  }

  if (max - min >= 3) {
    const behind = rows.filter((r) => r.count === min).map((r) => r.name).join(', ');
    lines.push(`\n→ ${behind} ha ricevuto significativamente meno turni. Considera di coinvolgerlo/a presto.`);
  }

  return lines.join('\n');
}
