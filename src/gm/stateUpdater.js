import {
  applyHpChange,
  applySanityLoss,
  addInventoryItem,
  removeInventoryItem,
} from '../core/character.js';
import { calculateSanityLoss, performSkillRoll } from '../core/dice.js';

/**
 * Applica una lista di direttive allo stato del gioco.
 *
 * @param {Array}  directives  - direttive dalla risposta GM
 * @param {Object} character   - scheda personaggio corrente
 * @param {Object} worldState  - stato del mondo corrente
 * @param {Object} diceResult  - risultato tiro dado (se presente, per direttive condizionali)
 * @returns {{ character, worldState, events }} - stato aggiornato + eventi per il frontend
 */
export function applyDirectives(directives, character, worldState, diceResult = null) {
  let ch = { ...character, derived: { ...character.derived } };
  let ws = deepCloneWorldState(worldState);
  const events = []; // eventi notifica per il frontend

  for (const d of directives) {
    switch (d.type) {

      case 'SET_SCENE':
        ws.current_scene = d.scene;
        break;

      case 'NPC_MOOD':
        if (!ws.npcs[d.npc]) ws.npcs[d.npc] = { name: d.npc };
        ws.npcs[d.npc].disposition = d.disposition;
        break;

      case 'NPC_REVEAL':
        if (!ws.npcs[d.npc]) ws.npcs[d.npc] = { name: d.npc };
        if (!ws.npcs[d.npc].knowledge_revealed) ws.npcs[d.npc].knowledge_revealed = [];
        ws.npcs[d.npc].knowledge_revealed.push(d.info);
        break;

      case 'CLUE_FOUND':
        if (!ws.clues_found.includes(d.clue)) {
          ws.clues_found.push(d.clue);
          events.push({ type: 'clue_found', clue: d.clue, description: d.description });
        }
        break;

      case 'FLAG_SET':
        ws.flags[d.flag] = d.value;
        break;

      case 'SANITY_LOSS': {
        // Determina la perdita in base all'esito del tiro SAN
        const sanRoll = performSkillRoll(ch.derived.sanity_current, 'Sanità');
        const loss = calculateSanityLoss(sanRoll.outcome, d.loss_on_success || '0', d.loss_on_failure || '1d6');
        const { character: updatedCh, newInsanity } = applySanityLoss(ch, loss);
        ch = updatedCh;
        events.push({
          type: 'sanity_loss',
          roll: sanRoll.roll,
          outcome: sanRoll.outcome,
          loss,
          newSanity: ch.derived.sanity_current,
          newInsanity,
          reason: d.reason,
        });
        break;
      }

      case 'HP_LOSS': {
        ch = applyHpChange(ch, -Math.abs(d.amount));
        events.push({
          type: 'hp_change',
          delta: -Math.abs(d.amount),
          newHp: ch.derived.hp_current,
          reason: d.reason,
        });
        break;
      }

      case 'HP_GAIN': {
        ch = applyHpChange(ch, Math.abs(d.amount));
        events.push({
          type: 'hp_change',
          delta: Math.abs(d.amount),
          newHp: ch.derived.hp_current,
          reason: d.reason,
        });
        break;
      }

      case 'ITEM_GAIN': {
        ch = addInventoryItem(ch, { name: d.item, description: d.description || '' });
        events.push({ type: 'item_gained', item: d.item });
        break;
      }

      case 'ITEM_LOSS': {
        ch = removeInventoryItem(ch, d.item);
        events.push({ type: 'item_lost', item: d.item });
        break;
      }

      // REQUEST_SKILL_ROLL, PUSH_AVAILABLE, SESSION_END:
      // gestiti dall'orchestrator (routes/gm.js), non qui.
      default:
        break;
    }
  }

  return { character: ch, worldState: ws, events };
}

function deepCloneWorldState(ws) {
  return {
    ...ws,
    npcs: Object.fromEntries(
      Object.entries(ws.npcs || {}).map(([k, v]) => [k, { ...v, knowledge_revealed: [...(v.knowledge_revealed || [])] }])
    ),
    locations: { ...ws.locations },
    flags: { ...ws.flags },
    active_threats: [...(ws.active_threats || [])],
    clues_found: [...(ws.clues_found || [])],
    notes: [...(ws.notes || [])],
  };
}
