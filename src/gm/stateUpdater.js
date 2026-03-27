import {
  applyHpChange,
  applySanityLoss,
  addInventoryItem,
  removeInventoryItem,
} from '../core/character.js';
import { calculateSanityLoss, performSkillRoll } from '../core/dice.js';
import { readJson, writeJson, ensureDir } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Applica una lista di direttive allo stato del gioco.
 *
 * @param {Array}  directives  - direttive dalla risposta GM
 * @param {Object} character   - scheda personaggio corrente
 * @param {Object} worldState  - stato del mondo corrente
 * @param {string} sessionId   - id sessione (per lettura/scrittura file scena)
 * @param {Object} diceResult  - risultato tiro dado (se presente, per direttive condizionali)
 * @returns {{ character, worldState, events }} - stato aggiornato + eventi per il frontend
 */
export function applyDirectives(directives, character, worldState, sessionId = null, diceResult = null) {
  let ch = { ...character, derived: { ...character.derived } };
  let ws = deepCloneWorldState(worldState);
  const events = []; // eventi notifica per il frontend

  for (const d of directives) {
    switch (d.type) {

      // ── Ciclo del custode ──────────────────────────────────────────────────

      case 'SET_CYCLE_PHASE':
        ws.cycle_phase = d.phase;
        events.push({ type: 'cycle_phase', phase: d.phase });
        break;

      case 'NEW_SCENE': {
        if (!sessionId) break;
        // Chiudi la scena corrente se esiste
        if (ws.current_scene_index > 0) {
          const prevScene = readJson(paths.sceneFile(sessionId, ws.current_scene_index));
          if (prevScene && !prevScene.ended_at) {
            writeJson(paths.sceneFile(sessionId, ws.current_scene_index), {
              ...prevScene,
              ended_at: new Date().toISOString(),
            });
          }
        }
        // Crea la nuova scena
        const newIndex = ws.current_scene_index + 1;
        const newScene = {
          index: newIndex,
          title: d.title || `Scena ${newIndex}`,
          time: d.time || '',
          location: d.location || '',
          characters_present: d.characters_present || [],
          threats: d.threats || [],
          clues: d.clues || [],
          events: [],
          started_at: new Date().toISOString(),
          ended_at: null,
        };
        ensureDir(paths.scenesDir(sessionId));
        writeJson(paths.sceneFile(sessionId, newIndex), newScene);
        ws.current_scene_index = newIndex;
        ws.cycle_phase = 'impostare_scena';
        events.push({ type: 'new_scene', scene: newScene });
        break;
      }

      case 'UPDATE_SCENE': {
        if (!sessionId || ws.current_scene_index === 0) break;
        const scene = readJson(paths.sceneFile(sessionId, ws.current_scene_index));
        if (!scene) break;
        const updated = { ...scene };
        if (d.event) updated.events = [...(scene.events || []), { timestamp: new Date().toISOString(), text: d.event }];
        if (d.add_threat) updated.threats = [...(scene.threats || []), d.add_threat];
        if (d.remove_threat) updated.threats = (scene.threats || []).filter((t) => t !== d.remove_threat);
        if (d.add_clue) updated.clues = [...(scene.clues || []), d.add_clue];
        if (d.add_character) updated.characters_present = [...new Set([...(scene.characters_present || []), d.add_character])];
        if (d.remove_character) updated.characters_present = (scene.characters_present || []).filter((c) => c !== d.remove_character);
        if (d.time) updated.time = d.time;
        if (d.location) updated.location = d.location;
        writeJson(paths.sceneFile(sessionId, ws.current_scene_index), updated);
        break;
      }

      // ── Legacy (rimosso) ───────────────────────────────────────────────────
      case 'SET_SCENE':
        // Direttiva vecchia: ignorata, usare NEW_SCENE
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
    groups: ws.groups
      ? ws.groups.map((g) => ({ ...g, members: [...(g.members || [])], character_names: [...(g.character_names || [])] }))
      : undefined,
    npcs: Object.fromEntries(
      Object.entries(ws.npcs || {}).map(([k, v]) => [k, { ...v, knowledge_revealed: [...(v.knowledge_revealed || [])] }])
    ),
    turn_counts: { ...(ws.turn_counts || {}) },
    flags: { ...ws.flags },
    active_threats: [...(ws.active_threats || [])],
    clues_found: [...(ws.clues_found || [])],
    notes: [...(ws.notes || [])],
  };
}
