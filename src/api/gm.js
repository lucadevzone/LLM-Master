import { Router } from 'express';
import { join } from 'path';
import { listFiles } from '../persistence/fileStore.js';
import { readJson, writeJson } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { loadAdventure } from '../core/adventure.js';
import { gmHistoryEntry, playerHistoryEntry, diceHistoryEntry } from '../core/session.js';
import { performSkillRoll } from '../core/dice.js';
import { streamChat, chat } from '../gm/ollamaClient.js';
import {
  buildGMSystemPrompt,
  buildConversationMessages,
  REASONING_SYSTEM_PROMPT,
} from '../gm/promptBuilder.js';
import { parseGMResponse, parseReasoningResponse, splitDirectives, extractDiceRequests } from '../gm/responseParser.js';
import { applyDirectives } from '../gm/stateUpdater.js';
import { buildContext, appendHistory, maybeGenerateSummary } from '../gm/contextManager.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * POST /api/sessions/:id/player-turn
 * Riceve l'azione del giocatore e avvia il turno GM.
 */
router.post('/:id/player-turn', async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Azione vuota' });

  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Sessione non attiva' });

  // Salva azione giocatore in history
  session.turn_count++;
  // Il primo turno (turn_count === 1) è l'apertura dell'avventura:
  // sostituiamo il trigger generico con un'istruzione esplicita al GM
  const isFirstTurn = session.turn_count === 1;
  const adventure = isFirstTurn ? findAndLoadAdventure(session.adventure_id) : null;
  const actualContent = isFirstTurn
    ? `[SISTEMA - INIZIO AVVENTURA]\nStai iniziando l'avventura "${adventure.title}".\nApri la prima scena esattamente come descritta nella sezione "Atto 1" o "Premessa" del canovaccio. Presenta l'ambiente, l'atmosfera e il contesto iniziale specifici di questa avventura. Non inventare scene non previste dal canovaccio.`
    : content.trim();
  const entry = playerHistoryEntry(session.turn_count, actualContent);
  appendHistory(req.params.id, entry);

  session.last_active = new Date().toISOString();
  writeJson(paths.sessionFile(req.params.id), session);

  res.json({ turn: session.turn_count, status: 'ok' });
});

/**
 * GET /api/sessions/:id/stream
 * SSE stream del turno GM. Aperto dal frontend dopo player-turn.
 */
router.get('/:id/stream', async (req, res) => {
  const sessionId = req.params.id;
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  // Headers SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (eventType, data) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const character = readJson(paths.characterFile(session.players[0].character_id));
    const worldState = readJson(paths.worldStateFile(sessionId));
    const adventure = findAndLoadAdventure(session.adventure_id);
    const context = buildContext(sessionId);

    // ── Fase 1: Reasoning (solo in modalità creativa) ──────────────────────
    let reasoning = null;
    if (session.mode !== 'fast') {
      const lastPlayerEntry = [...(context.recentHistory)].reverse().find((e) => e.role === 'player');
      if (lastPlayerEntry) {
        try {
          send('status', { message: 'Il Custode riflette...' });
          const reasoningText = await chat(
            config.fastModel,
            [
              { role: 'system', content: REASONING_SYSTEM_PROMPT },
              ...buildConversationMessages({ context, playerAction: lastPlayerEntry.content }),
              { role: 'user', content: `[ANALIZZA questa azione del personaggio e rispondi in JSON]\n${lastPlayerEntry.content}` },
            ],
            { format: 'json', temperature: 0.3 }
          );
          reasoning = parseReasoningResponse(reasoningText);
        } catch (err) {
          console.warn('[gm/stream] Fase 1 reasoning fallita:', err.message);
        }
      }
    }

    // ── Fase 2: Narrazione ─────────────────────────────────────────────────
    const systemPrompt = buildGMSystemPrompt({ adventure, session, character, worldState, context, reasoning });
    const conversationMessages = buildConversationMessages({ context });

    send('status', { message: 'Il Custode narra...' });

    // Streaming reale da Ollama.
    // Un mini-parser estrae solo i caratteri del campo "narrative" mentre arrivano,
    // così il giocatore vede solo il testo narrativo (non il JSON grezzo).
    let fullResponse = '';
    let inNarrative = false;
    let narrativeFound = false;
    let escaped = false;
    let scanBuf = ''; // buffer per rilevare '"narrative"'

    await streamChat(
      session.model,
      [
        { role: 'system', content: systemPrompt },
        ...conversationMessages,
      ],
      (token) => {
        fullResponse += token;

        if (narrativeFound && !inNarrative) return; // già usciti dalla narrative

        for (const ch of token) {
          if (!inNarrative) {
            // Accumula nel buffer di scansione e cerca '"narrative":'
            scanBuf += ch;
            // Teniamo solo gli ultimi 30 caratteri per non sprecare memoria
            if (scanBuf.length > 30) scanBuf = scanBuf.slice(-30);

            if (!narrativeFound) {
              // Cerca la sequenza: "narrative" seguita da : e poi "
              const idx = scanBuf.indexOf('"narrative"');
              if (idx !== -1) {
                const rest = scanBuf.slice(idx + 11); // dopo '"narrative"'
                const colon = rest.indexOf(':');
                if (colon !== -1) {
                  const afterColon = rest.slice(colon + 1).trimStart();
                  if (afterColon.startsWith('"')) {
                    narrativeFound = true;
                    inNarrative = true;
                    scanBuf = '';
                    escaped = false;
                  }
                }
              }
            }
          } else {
            // Siamo dentro il valore "narrative": estrai i caratteri reali
            if (escaped) {
              if (ch === 'n') send('token', { content: '\n' });
              else if (ch === 't') send('token', { content: '\t' });
              else send('token', { content: ch });
              escaped = false;
            } else if (ch === '\\') {
              escaped = true;
            } else if (ch === '"') {
              inNarrative = false; // fine del campo narrative
            } else {
              send('token', { content: ch });
            }
          }
        }
      },
      { format: 'json', temperature: 0.8 }
    );

    // ── Parse JSON completo per le direttive ───────────────────────────────
    const parsed = parseGMResponse(fullResponse);
    const { immediate, afterDice } = splitDirectives(parsed.directives);

    // Applica direttive immediate (no tiri dado)
    const nonDiceDirectives = immediate.filter(
      (d) => d.type !== 'REQUEST_SKILL_ROLL' && d.type !== 'REQUEST_STAT_ROLL'
    );
    const { character: updatedChar, worldState: updatedWS, events } =
      applyDirectives(nonDiceDirectives, character, worldState);

    // Salva stato aggiornato
    writeJson(paths.characterFile(session.players[0].character_id), updatedChar);
    writeJson(paths.worldStateFile(sessionId), updatedWS);

    // Salva turno GM in history
    const gmEntry = gmHistoryEntry(session.turn_count, parsed.narrative, parsed.directives, reasoning);
    appendHistory(sessionId, gmEntry);

    // Salva direttive-post-dado per uso futuro
    if (afterDice.length) {
      session.pending_directives = afterDice;
      writeJson(paths.sessionFile(sessionId), session);
    }

    // Notifica eventi al frontend (cambio SAN, HP, oggetti, ecc.)
    for (const event of events) {
      send('game_event', event);
    }

    // Richieste dado
    const diceRequests = extractDiceRequests(immediate);
    if (diceRequests.length) {
      const dr = diceRequests[0]; // una richiesta alla volta
      const skillValue = dr.type === 'REQUEST_SKILL_ROLL'
        ? (updatedChar.skills[dr.skill] ?? 0)
        : (updatedChar.characteristics[dr.stat] ?? 0);

      send('dice_request', {
        skill: dr.skill || dr.stat,
        skill_value: skillValue,
        difficulty: dr.difficulty,
        reason: dr.reason,
        on_success: dr.on_success,
        on_failure: dr.on_failure,
        on_extreme: dr.on_extreme,
      });
    }

    // UI hints (azioni suggerite, atmosfera)
    send('ui_hints', parsed.ui_hints);

    // Aggiornamento scheda
    send('character_update', {
      hp: updatedChar.derived.hp_current,
      hp_max: updatedChar.derived.hp_max,
      mp: updatedChar.derived.mp_current,
      san: updatedChar.derived.sanity_current,
      san_max: updatedChar.derived.sanity_max,
    });

    // Fine stream
    send('done', { turn: session.turn_count });
    res.end();

    // Genera summary in background (non blocca la risposta)
    maybeGenerateSummary(sessionId, session.turn_count).catch(console.error);

  } catch (err) {
    console.error('[gm/stream] Errore:', err);
    send('error', { message: err.message });
    res.end();
  }
});

/**
 * POST /api/sessions/:id/dice-result
 * Riceve il risultato del tiro dado e fa rispondere il GM.
 */
router.post('/:id/dice-result', async (req, res) => {
  const sessionId = req.params.id;
  const { skill, roll, pushed } = req.body;

  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const character = readJson(paths.characterFile(session.players[0].character_id));
  const skillValue = character.skills[skill] || character.characteristics[skill] || 0;

  // Esegui il tiro (o usa il roll fornito dal client)
  const diceResult = roll
    ? {
        roll,
        skillValue,
        skillName: skill,
        outcome: evaluateRollFromSkill(roll, skillValue),
        label: labelForOutcome(evaluateRollFromSkill(roll, skillValue)),
        canPush: false,
      }
    : performSkillRoll(skillValue, skill);

  // Salva risultato in history
  const entry = diceHistoryEntry(session.turn_count, diceResult);
  appendHistory(sessionId, entry);

  // Applica eventuali direttive in attesa dopo il dado
  if (session.pending_directives?.length) {
    const worldState = readJson(paths.worldStateFile(sessionId));
    const { character: updatedChar, worldState: updatedWS } =
      applyDirectives(session.pending_directives, character, worldState, diceResult);
    writeJson(paths.characterFile(session.players[0].character_id), updatedChar);
    writeJson(paths.worldStateFile(sessionId), updatedWS);
    session.pending_directives = [];
    writeJson(paths.sessionFile(sessionId), session);
  }

  res.json({
    ...diceResult,
    canPush: diceResult.outcome === 'failure' && !pushed,
  });
});

/**
 * POST /api/sessions/:id/choice
 * Giocatore sceglie un'opzione da pulsanti (yes/no o azioni suggerite).
 */
router.post('/:id/choice', async (req, res) => {
  const { choice } = req.body;
  if (!choice) return res.status(400).json({ error: 'choice mancante' });

  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  // Tratta la scelta come un'azione del giocatore
  session.turn_count++;
  const entry = playerHistoryEntry(session.turn_count, choice);
  appendHistory(req.params.id, entry);
  session.last_active = new Date().toISOString();
  writeJson(paths.sessionFile(req.params.id), session);

  res.json({ turn: session.turn_count, status: 'ok' });
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function findAndLoadAdventure(adventureId) {
  const files = listFiles(paths.adventures()).filter((f) => f.match(/\.(md|yaml|yml)$/i));
  for (const file of files) {
    try {
      const adv = loadAdventure(join(paths.adventures(), file));
      if (adv.id === adventureId) return adv;
    } catch (_) {}
  }
  // Fallback: avventura generica se non trovata
  return {
    id: adventureId,
    title: 'Avventura',
    era: '',
    tone: 'investigativo, atmosferico',
    players: '1',
    content: 'Avventura aperta. Segui gli indizi e le scelte del personaggio.',
  };
}

function evaluateRollFromSkill(roll, skill) {
  if (roll === 1) return 'extreme';
  if (roll >= 96) return 'fumble';
  if (skill < 50 && roll >= 96) return 'fumble';
  if (roll <= Math.floor(skill / 5)) return 'extreme';
  if (roll <= Math.floor(skill / 2)) return 'hard';
  if (roll <= skill) return 'success';
  return 'failure';
}

function labelForOutcome(outcome) {
  return { extreme: 'Successo Estremo', hard: 'Successo Difficile', success: 'Successo', failure: 'Fallimento', fumble: 'Fumble' }[outcome] || outcome;
}

export default router;
