import { Router } from 'express';
import { join } from 'path';
import { listFiles, readJson, writeJson, appendText } from '../persistence/fileStore.js';
import { paths, getRoomIdForSession } from '../persistence/paths.js';
import { loadAdventure } from '../core/adventure.js';
import { gmHistoryEntry, playerHistoryEntry, diceHistoryEntry } from '../core/session.js';
import { performSkillRoll } from '../core/dice.js';
import { createClient } from '../gm/llmClient.js';
import {
  buildGMSystemPrompt,
  buildConversationMessages,
  REASONING_SYSTEM_PROMPT,
} from '../gm/promptBuilder.js';
import { parseGMResponse, parseReasoningResponse, splitDirectives, extractDiceRequests } from '../gm/responseParser.js';
import { applyDirectives } from '../gm/stateUpdater.js';
import { buildContext, appendHistory, maybeGenerateSummary } from '../gm/contextManager.js';
import {
  subscribe, unsubscribe, broadcast, sendTo,
  getConnectedPlayers, isAllConnected,
} from '../gm/sseRegistry.js';
import { resetGMTimer, clearGMTimer, setProactiveCallback } from '../gm/timeoutRegistry.js';
import { config } from '../config.js';
import {
  getFloor, takeFloor, releaseFloor,
  setGMFloor, setDiceFloor,
  raiseHand, lowerHand,
  pauseSession, resumeSession, startSession,
} from '../gm/floorManager.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ─── Timeout proattivo ────────────────────────────────────────────────────────

/**
 * Chiamato quando i giocatori non agiscono per troppo tempo.
 * Inietta un messaggio di sistema e fa parlare il GM.
 */
async function proactiveGMTurn(sessionId) {
  const session = readJson(paths.sessionFile(sessionId));
  if (!session || session.status !== 'active') return;

  const floor = getFloor(session);
  // Non intervenire se il GM sta già elaborando o c'è un dado in attesa
  if (floor.state === 'gm' || floor.state === 'dice' || floor.state === 'lobby') return;

  // Non intervenire se nessun giocatore è connesso
  const connected = getConnectedPlayers(sessionId);
  if (!connected.length) return;

  const worldState = readJson(paths.worldStateFile(sessionId));
  const phaseLabel = {
    impostare_scena: 'impostare la scena',
    coinvolgere_pg: 'coinvolgere i PG',
    reagire_dichiarazioni: 'reagire alle dichiarazioni',
  }[worldState?.cycle_phase] || worldState?.cycle_phase || 'reagire alle dichiarazioni';

  const proactiveMessage =
    `[SISTEMA - STIMOLO PROATTIVO]\n` +
    `I giocatori non hanno dichiarato nulla da diversi minuti. ` +
    `Sei in fase "${phaseLabel}". ` +
    `Agisci secondo le regole della tua fase corrente: ` +
    `dai nuovi stimoli narrativi, fai avanzare la situazione, o interpella direttamente un personaggio.`;

  session.turn_count = (session.turn_count || 0) + 1;
  appendHistory(sessionId, playerHistoryEntry(session.turn_count, proactiveMessage));
  session.last_active = new Date().toISOString();
  writeJson(paths.sessionFile(sessionId), session);

  broadcast(sessionId, 'status', { message: 'Il Custode interviene...' });

  runGMTurn(sessionId, null).catch((err) => {
    console.error('[gm/proactive] Errore:', err.message);
  });
}

setProactiveCallback(proactiveGMTurn);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMultiplayerSession(session) {
  return session.players.length > 1 && session.players[0].player_id !== null;
}

function findAndLoadAdventure(adventureId) {
  const files = listFiles(paths.adventures()).filter((f) => f.match(/\.(md|yaml|yml)$/i));
  for (const file of files) {
    try {
      const adv = loadAdventure(join(paths.adventures(), file));
      if (adv.id === adventureId) return adv;
    } catch (_) {}
  }
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
  if (roll <= Math.floor(skill / 5)) return 'extreme';
  if (roll <= Math.floor(skill / 2)) return 'hard';
  if (roll <= skill) return 'success';
  return 'failure';
}

function labelForOutcome(outcome) {
  return { extreme: 'Successo Estremo', hard: 'Successo Difficile', success: 'Successo', failure: 'Fallimento', fumble: 'Fumble' }[outcome] || outcome;
}

// ─── Core GM Turn ─────────────────────────────────────────────────────────────

/**
 * Elabora un turno GM e distribuisce gli eventi via sseRegistry.
 * Usato sia in single-player (dal GET /stream) che in multi-player (async dal POST /player-turn).
 *
 * @param {string} sessionId
 * @param {string|null} actingPlayerId - null per single-player
 */
async function runGMTurn(sessionId, actingPlayerId) {
  const session = readJson(paths.sessionFile(sessionId));
  const llmConfig = session.llmConfig;
  const client = createClient(llmConfig);
  const isMulti = isMultiplayerSession(session);

  // Leggi tutti i personaggi del gruppo
  const allCharacters = session.players
    .map((p) => readJson(paths.characterFile(p.character_id)))
    .filter(Boolean);

  // Personaggio attivo: per multi-player è quello del player che ha agito.
  // Se actingPlayerId è null (apertura avventura da admin), usa il primo player.
  const actingPlayerEntry = isMulti
    ? (session.players.find((p) => p.player_id === actingPlayerId) ?? session.players[0])
    : session.players[0];
  const character = readJson(paths.characterFile(actingPlayerEntry.character_id));

  const worldState = readJson(paths.worldStateFile(sessionId));
  const adventure = findAndLoadAdventure(session.adventure_id);
  const context = buildContext(sessionId);

  // Raccoglie commenti/interruzioni pendenti per il floor context
  const floorState = getFloor(session);
  const pendingComments = context.recentHistory
    .filter((e) => e.role === 'player' && e.message_type !== 'action' && e.turn === session.turn_count)
    .map((e) => ({ player_name: e.player_name, content: e.content }));

  // Nomi nella coda mani alzate (per il prompt)
  const handQueueNames = (floorState.hand_queue || []).map((pid) => {
    const p = session.players.find((pl) => pl.player_id === pid);
    return p ? readJson(paths.characterFile(p.character_id))?.meta?.name || pid : pid;
  });

  const floorContext = isMulti
    ? {
        actingPlayerName: character?.meta?.name,
        handQueue: handQueueNames,
        pendingComments,
      }
    : null;

  // Imposta floor su 'gm'
  setGMFloor(sessionId);
  broadcast(sessionId, 'floor_change', { state: 'gm', player_id: null });

  // ── Fase 1: Reasoning (solo in modalità creativa) ───────────────────────────
  let reasoning = null;
  if (session.mode !== 'fast') {
    const lastPlayerEntry = [...(context.recentHistory)].reverse().find((e) => e.role === 'player' && e.message_type !== 'comment' && e.message_type !== 'interrupt');
    if (lastPlayerEntry) {
      try {
        broadcast(sessionId, 'status', { message: 'Il Custode riflette...' });
        const reasoningText = await client.chat(
          llmConfig.fastModel,
          [
            { role: 'system', content: REASONING_SYSTEM_PROMPT },
            ...buildConversationMessages({ context, playerAction: lastPlayerEntry.content }),
            { role: 'user', content: `[ANALIZZA questa azione e rispondi in JSON]\n${lastPlayerEntry.content}` },
          ],
          { format: 'json', temperature: 0.3 }
        );
        reasoning = parseReasoningResponse(reasoningText);
      } catch (err) {
        console.warn('[gm/runGMTurn] Fase 1 reasoning fallita:', err.message);
      }
    }
  }

  // ── Fase 2: Narrazione streaming ────────────────────────────────────────────
  const systemPrompt = buildGMSystemPrompt({
    adventure, session, character,
    characters: isMulti ? allCharacters : null,
    worldState, context, reasoning, floorContext,
    sessionId,
  });
  const conversationMessages = buildConversationMessages({ context });

  broadcast(sessionId, 'status', { message: 'Il Custode narra...' });

  let fullResponse = '';
  let inNarrative = false;
  let narrativeFound = false;
  let escaped = false;
  let scanBuf = '';

  await client.streamChat(
    llmConfig.creativeModel,
    [
      { role: 'system', content: systemPrompt },
      ...conversationMessages,
    ],
    (token) => {
      fullResponse += token;

      if (narrativeFound && !inNarrative) return;

      for (const ch of token) {
        if (!inNarrative) {
          scanBuf += ch;
          if (scanBuf.length > 30) scanBuf = scanBuf.slice(-30);

          if (!narrativeFound) {
            const idx = scanBuf.indexOf('"narrative"');
            if (idx !== -1) {
              const rest = scanBuf.slice(idx + 11);
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
          if (escaped) {
            if (ch === 'n') broadcast(sessionId, 'token', { content: '\n' });
            else if (ch === 't') broadcast(sessionId, 'token', { content: '\t' });
            else broadcast(sessionId, 'token', { content: ch });
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inNarrative = false;
          } else {
            broadcast(sessionId, 'token', { content: ch });
          }
        }
      }
    },
    { format: 'json', temperature: 0.8 }
  );

  // ── Parse e direttive ────────────────────────────────────────────────────────
  const parsed = parseGMResponse(fullResponse);

  // PASS: il GM sceglie di non intervenire, lascia i giocatori parlare tra loro
  if (parsed.directives.some((d) => d.type === 'PASS')) {
    releaseFloor(sessionId);
    broadcast(sessionId, 'floor_change', { state: 'open', hand_queue: getFloor(readJson(paths.sessionFile(sessionId))).hand_queue });
    broadcast(sessionId, 'done', { turn: session.turn_count });
    resetGMTimer(sessionId, config.gmProactiveTimeoutMs);
    return;
  }

  const { immediate, afterDice } = splitDirectives(parsed.directives);

  const nonDiceDirectives = immediate.filter(
    (d) => d.type !== 'REQUEST_SKILL_ROLL' && d.type !== 'REQUEST_STAT_ROLL'
  );
  const { character: updatedChar, worldState: updatedWS, events } =
    applyDirectives(nonDiceDirectives, character, worldState, sessionId);

  // Salva stato aggiornato
  writeJson(paths.characterFile(actingPlayerEntry.character_id), updatedChar);
  writeJson(paths.worldStateFile(sessionId), updatedWS);

  // Salva turno GM in history
  const gmEntry = gmHistoryEntry(session.turn_count, parsed.narrative, parsed.directives, reasoning);
  appendHistory(sessionId, gmEntry);

  // Salva direttive post-dado
  if (afterDice.length) {
    const freshSession = readJson(paths.sessionFile(sessionId));
    freshSession.pending_directives = afterDice;
    writeJson(paths.sessionFile(sessionId), freshSession);
  }

  // Notifica eventi (game_event) — a tutti
  for (const event of events) {
    broadcast(sessionId, 'game_event', event);
  }

  // Aggiorna diary.txt quando si apre una nuova scena
  const newSceneEvent = events.find((e) => e.type === 'new_scene');
  if (newSceneEvent) {
    const roomId = getRoomIdForSession(sessionId);
    if (roomId) {
      const sc = newSceneEvent.scene;
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const diaryLine = `[${timestamp}] SCENA ${sc.index}: ${sc.title} — ${sc.location || ''} (${sc.time || ''})`;
      appendText(paths.roomDiaryFile(roomId), diaryLine);
    }
  }

  // Sussurri — solo al giocatore destinatario
  const whispers = immediate.filter((d) => d.type === 'WHISPER' && d.character_name && d.message);
  for (const w of whispers) {
    const freshSession = readJson(paths.sessionFile(sessionId));
    const targetEntry = freshSession.players.find((p) => {
      const ch = readJson(paths.characterFile(p.character_id));
      return ch?.meta?.name === w.character_name;
    });
    if (targetEntry && isMulti) {
      sendTo(sessionId, targetEntry.player_id, 'whisper', { message: w.message });
    } else if (!isMulti) {
      // Single-player: il sussurro va comunque al giocatore unico
      broadcast(sessionId, 'whisper', { message: w.message });
    }
  }

  // Richiesta dado — solo al giocatore attivo
  const diceRequests = extractDiceRequests(immediate);
  if (diceRequests.length) {
    const dr = diceRequests[0];
    const skillValue = dr.type === 'REQUEST_SKILL_ROLL'
      ? (updatedChar.skills[dr.skill] ?? 0)
      : (updatedChar.characteristics[dr.stat] ?? 0);

    const dicePayload = {
      skill: dr.skill || dr.stat,
      skill_value: skillValue,
      difficulty: dr.difficulty,
      reason: dr.reason,
      on_success: dr.on_success,
      on_failure: dr.on_failure,
      on_extreme: dr.on_extreme,
    };

    if (isMulti && actingPlayerId) {
      // Solo al giocatore attivo
      sendTo(sessionId, actingPlayerId, 'dice_request', dicePayload);
      // Agli altri: notifica che c'è un tiro in corso
      const connectedOthers = getConnectedPlayers(sessionId).filter((id) => id !== actingPlayerId);
      for (const pid of connectedOthers) {
        sendTo(sessionId, pid, 'dice_pending', {
          player_name: character.meta.name,
          skill: dicePayload.skill,
          reason: dicePayload.reason,
        });
      }
      setDiceFloor(sessionId, actingPlayerId);
      broadcast(sessionId, 'floor_change', { state: 'dice', player_id: actingPlayerId });
    } else {
      broadcast(sessionId, 'dice_request', dicePayload);
    }
  }

  // UI hints (scelte rapide) — solo al giocatore attivo
  if (isMulti && actingPlayerId) {
    sendTo(sessionId, actingPlayerId, 'ui_hints', parsed.ui_hints);
  } else {
    broadcast(sessionId, 'ui_hints', parsed.ui_hints);
  }
  broadcast(sessionId, 'character_update', {
    player_id: actingPlayerId,
    character_id: actingPlayerEntry.character_id,
    hp: updatedChar.derived.hp_current,
    hp_max: updatedChar.derived.hp_max,
    mp: updatedChar.derived.mp_current,
    san: updatedChar.derived.sanity_current,
    san_max: updatedChar.derived.sanity_max,
  });

  // Fine turno
  broadcast(sessionId, 'done', { turn: session.turn_count });

  // Aggiorna floor in base alle direttive del GM (solo se non in attesa di dado)
  if (!diceRequests.length) {
    const assignTurn = immediate.find((d) => d.type === 'ASSIGN_TURN');

    if (isMulti && assignTurn?.character_name) {
      // Trova il player_id dal nome personaggio
      const freshSession = readJson(paths.sessionFile(sessionId));
      const targetEntry = freshSession.players.find((p) => {
        const ch = readJson(paths.characterFile(p.character_id));
        return ch?.meta?.name === assignTurn.character_name;
      });
      if (targetEntry) {
        takeFloor(sessionId, targetEntry.player_id);
        broadcast(sessionId, 'floor_change', {
          state: 'player',
          player_id: targetEntry.player_id,
          player_name: assignTurn.character_name,
          hand_queue: getFloor(freshSession).hand_queue,
        });
      } else {
        // Nome non trovato: apri il floor comunque
        releaseFloor(sessionId);
        broadcast(sessionId, 'floor_change', { state: 'open', hand_queue: getFloor(readJson(paths.sessionFile(sessionId))).hand_queue });
      }
    } else {
      // OPEN_FLOOR esplicita o default
      releaseFloor(sessionId);
      broadcast(sessionId, 'floor_change', { state: 'open', hand_queue: getFloor(readJson(paths.sessionFile(sessionId))).hand_queue });
    }
  }

  // Summary in background
  maybeGenerateSummary(sessionId, session.turn_count, llmConfig).catch(console.error);

  // Resetta il timer proattivo: il GM ha appena risposto, si aspetta che i giocatori agiscano
  resetGMTimer(sessionId, config.gmProactiveTimeoutMs);
}

// ─── Session auto-start ───────────────────────────────────────────────────────

/**
 * Legge il riepilogo generato automaticamente, oppure ricava le ultime
 * narrazioni GM dalla history come fallback.
 */
function getSessionRecap(sessionId) {
  const summaryData = readJson(paths.summaryFile(sessionId));
  if (summaryData?.summary) return summaryData.summary;

  const history = readJson(paths.historyFile(sessionId)) || [];
  const gmNarratives = history
    .filter((e) => e.role === 'gm' && e.content)
    .slice(-4)
    .map((e) => e.content);
  return gmNarratives.join('\n\n') || '(nessun contenuto precedente)';
}

/**
 * Avvia la sessione multiplayer: determina se è la prima volta (incipit)
 * o una ripresa (riepilogo), scrive il turno di apertura e lancia il GM.
 * Chiamata automaticamente quando tutti i giocatori si connettono.
 */
async function triggerSessionStart(sessionId) {
  startSession(sessionId);

  const session = readJson(paths.sessionFile(sessionId));
  const isFirstTime = (session.turn_count || 0) === 0;
  const adventure = findAndLoadAdventure(session.adventure_id);
  const partyNames = session.players
    .map((p) => readJson(paths.characterFile(p.character_id))?.meta?.name)
    .filter(Boolean)
    .join(', ');

  session.turn_count = (session.turn_count || 0) + 1;

  // Imposta la fase corretta nel world state prima di chiamare il GM
  const wsStart = readJson(paths.worldStateFile(sessionId));
  if (wsStart) {
    wsStart.cycle_phase = isFirstTime ? 'avvio' : 'inizio_sessione';
    writeJson(paths.worldStateFile(sessionId), wsStart);
  }

  let startMessage;
  if (isFirstTime) {
    startMessage =
      `[SISTEMA - INIZIO AVVENTURA]\n` +
      `Avventura: "${adventure.title}".\n` +
      `Gruppo: ${partyNames}.\n` +
      `Segui le regole di fase "avvio": presenta l'ambientazione, i personaggi e gli antefatti. ` +
      `Non aprire ancora la prima scena — quella verrà nella fase successiva.`;
  } else {
    const recap = getSessionRecap(sessionId);
    startMessage =
      `[SISTEMA - RIPRESA AVVENTURA]\n` +
      `Avventura: "${adventure.title}".\n` +
      `Gruppo: ${partyNames}.\n` +
      `Segui le regole di fase "inizio_sessione": fai un riepilogo narrativo degli eventi precedenti.\n` +
      `Contesto delle sessioni precedenti:\n${recap}`;
  }

  appendHistory(sessionId, playerHistoryEntry(session.turn_count, startMessage));
  writeJson(paths.sessionFile(sessionId), session);

  broadcast(sessionId, 'session_started', {
    floor: { state: 'open' },
    message: isFirstTime ? 'La sessione è iniziata!' : 'La sessione è ripresa!',
  });

  runGMTurn(sessionId, null).catch((err) => {
    console.error('[gm/autoStart] Errore:', err.message);
    broadcast(sessionId, 'game_error', { message: err.message });
  });
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /api/sessions/:id/stream
 *
 * - Single-player: registra in sseRegistry, esegue runGMTurn sincronamente, poi chiude
 * - Multi-player: registra connessione persistente, GM riceve eventi da POST /player-turn
 */
router.get('/:id/stream', async (req, res) => {
  const sessionId = req.params.id;
  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const isMulti = isMultiplayerSession(session);
  // Per multi-player: usa player_id dell'utente autenticato
  // Per single-player: usa character_id come chiave registry
  const registryKey = isMulti ? req.user.id : session.players[0].character_id;

  subscribe(sessionId, registryKey, res);

  if (isMulti) {
    // ── Multi-player: connessione persistente ───────────────────────────────
    const playerEntry = session.players.find((p) => p.player_id === req.user.id);
    const charName = playerEntry
      ? readJson(paths.characterFile(playerEntry.character_id))?.meta?.name || req.user.id
      : req.user.id;

    // Notifica tutti della connessione
    broadcast(sessionId, 'player_connected', { player_id: req.user.id, player_name: charName });

    // Normalizza floor 'paused' (stato legacy): riporta a 'open'
    if (session.floor?.state === 'paused') {
      const s = readJson(paths.sessionFile(sessionId));
      s.floor = { ...s.floor, state: 'open' };
      if (s.status === 'paused') s.status = 'active';
      writeJson(paths.sessionFile(sessionId), s);
    }

    // Auto-start: se tutti sono connessi e la sessione è in lobby, parte automaticamente
    const expectedIds = session.players.map((p) => p.player_id);
    if (isAllConnected(sessionId, expectedIds) && session.floor?.state === 'lobby') {
      broadcast(sessionId, 'lobby_ready', {
        message: 'Tutti connessi — la sessione sta per iniziare…',
        connected: getConnectedPlayers(sessionId),
      });
      // Piccolo delay per dare tempo all'ultimo client di registrarsi all'SSE
      setTimeout(() => triggerSessionStart(sessionId).catch(console.error), 800);
    }

    // Heartbeat (60s) per tenere la connessione viva attraverso proxy/firewall
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); }
    }, 60_000);

    // Disconnect handler
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe(sessionId, req.user.id);

      broadcast(sessionId, 'player_disconnected', { player_id: req.user.id, player_name: charName });

      // Se la sessione era attiva, avvia voto (senza mettere in pausa)
      const current = readJson(paths.sessionFile(sessionId));
      if (current?.status === 'active') {
        current.continue_votes = [];
        writeJson(paths.sessionFile(sessionId), current);
        broadcast(sessionId, 'session_paused', {
          reason: 'disconnessione',
          disconnected_player: charName,
          message: `${charName} si è disconnesso. Volete continuare o chiudere qui la sessione?`,
        });

        // Nessun giocatore connesso: sospendi il timer proattivo
        if (!getConnectedPlayers(sessionId).length) {
          clearGMTimer(sessionId);
        }
      }
    });

  } else {
    // ── Single-player: esegui GM turn sincronamente ─────────────────────────
    try {
      await runGMTurn(sessionId, null);
    } catch (err) {
      console.error('[gm/stream] Errore single-player:', err);
      broadcast(sessionId, 'game_error', { message: err.message });
    } finally {
      unsubscribe(sessionId, registryKey);
      res.end();
    }
  }
});

/**
 * POST /api/sessions/:id/player-turn
 * Riceve l'azione principale del giocatore (prende il floor).
 */
router.post('/:id/player-turn', async (req, res) => {
  const { content, quick_action: quickAction = false } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Azione vuota' });

  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (session.status !== 'active') return res.status(400).json({ error: 'Sessione non attiva' });

  const isMulti = isMultiplayerSession(session);

  if (isMulti) {
    // ── Multi-player: controlla e prende il floor ─────────────────────────
    const floor = getFloor(session);
    if (floor.state === 'lobby') return res.status(400).json({ error: 'La sessione non è ancora iniziata' });

    const alreadyAssigned = floor.state === 'player' && floor.player_id === req.user.id;

    if (!alreadyAssigned) {
      // Floor libero: prova a prenderlo
      if (floor.state !== 'open') return res.status(409).json({ error: 'Non hai la parola al momento', floor_state: floor.state, floor_player: floor.player_id });
      const result = takeFloor(req.params.id, req.user.id);
      if (!result.ok) return res.status(409).json({ error: result.reason });
    }
    // Se alreadyAssigned: il floor è già di questo giocatore (via ASSIGN_TURN), nessun takeFloor necessario

    // Trova il personaggio del player attivo
    const playerEntry = session.players.find((p) => p.player_id === req.user.id);
    const character = playerEntry ? readJson(paths.characterFile(playerEntry.character_id)) : null;
    const playerName = character?.meta?.name || req.user.id;

    // Salva azione in history
    session.turn_count++;
    const isFirstTurn = session.turn_count === 1;
    const adventure = isFirstTurn ? findAndLoadAdventure(session.adventure_id) : null;
    const actualContent = isFirstTurn
      ? `[SISTEMA - INIZIO AVVENTURA]\nStai iniziando l'avventura "${adventure.title}".\nApri la prima scena. Il gruppo è: ${session.players.map((p) => readJson(paths.characterFile(p.character_id))?.meta?.name).filter(Boolean).join(', ')}.`
      : content.trim();

    const entry = playerHistoryEntry(session.turn_count, actualContent, {
      playerId: req.user.id,
      playerName,
      type: 'action',
    });
    appendHistory(req.params.id, entry);

    session.last_active = new Date().toISOString();
    writeJson(paths.sessionFile(req.params.id), session);

    // Transizione automatica a fase "reagire_dichiarazioni" quando il giocatore agisce
    const wsOnAction = readJson(paths.worldStateFile(req.params.id));
    if (wsOnAction && wsOnAction.cycle_phase !== 'reagire_dichiarazioni') {
      wsOnAction.cycle_phase = 'reagire_dichiarazioni';
      writeJson(paths.worldStateFile(req.params.id), wsOnAction);
    }

    // Broadcast: il giocatore ha preso la parola
    broadcast(req.params.id, 'floor_change', { state: 'player', player_id: req.user.id, player_name: playerName });
    // Per i comandi rapidi non mostriamo in chat il testo grezzo dell'azione
    if (!quickAction) {
      broadcast(req.params.id, 'player_action', { player_id: req.user.id, player_name: playerName, content: content.trim() });
    }

    res.json({ turn: session.turn_count, status: 'ok' });

    // Il giocatore ha agito: cancella il timer proattivo (il GM risponderà a breve)
    clearGMTimer(req.params.id);

    // Avvia turno GM in background
    runGMTurn(req.params.id, req.user.id).catch((err) => {
      console.error('[gm/player-turn] Errore runGMTurn:', err);
      broadcast(req.params.id, 'game_error', { message: err.message });
      releaseFloor(req.params.id);
      broadcast(req.params.id, 'floor_change', { state: 'open' });
    });

  } else {
    // ── Single-player: salva azione, GET /stream eseguirà il GM ──────────
    session.turn_count++;
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
  }
});

/**
 * POST /api/sessions/:id/comment
 * Invia un commento o un'interruzione (non prende il floor).
 * Disponibile a tutti i giocatori in qualsiasi momento.
 */
router.post('/:id/comment', (req, res) => {
  const { content, type } = req.body; // type: 'comment' | 'interrupt'
  if (!content?.trim()) return res.status(400).json({ error: 'Contenuto vuoto' });

  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (!isMultiplayerSession(session)) return res.status(400).json({ error: 'Solo per sessioni multi-player' });

  const playerEntry = session.players.find((p) => p.player_id === req.user.id);
  const character = playerEntry ? readJson(paths.characterFile(playerEntry.character_id)) : null;
  const playerName = character?.meta?.name || req.user.id;

  const messageType = type === 'interrupt' ? 'interrupt' : 'comment';

  const entry = playerHistoryEntry(session.turn_count, content.trim(), {
    playerId: req.user.id,
    playerName,
    type: messageType,
  });
  appendHistory(req.params.id, entry);

  broadcast(req.params.id, 'player_comment', {
    player_id: req.user.id,
    player_name: playerName,
    content: content.trim(),
    type: messageType,
  });

  res.json({ ok: true });
});

/**
 * POST /api/sessions/:id/raise-hand
 * Il giocatore chiede la parola per il prossimo turno libero.
 */
router.post('/:id/raise-hand', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (!isMultiplayerSession(session)) return res.status(400).json({ error: 'Solo per sessioni multi-player' });

  const playerEntry = session.players.find((p) => p.player_id === req.user.id);
  const character = playerEntry ? readJson(paths.characterFile(playerEntry.character_id)) : null;
  const playerName = character?.meta?.name || req.user.id;

  const { ok, queue } = raiseHand(req.params.id, req.user.id);
  if (!ok) return res.status(409).json({ error: 'Non puoi alzare la mano adesso' });

  broadcast(req.params.id, 'hand_raised', { player_id: req.user.id, player_name: playerName, queue });
  res.json({ ok: true, queue });
});

/**
 * POST /api/sessions/:id/lower-hand
 * Il giocatore ritira la richiesta di parola.
 */
router.post('/:id/lower-hand', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const { queue } = lowerHand(req.params.id, req.user.id);
  broadcast(req.params.id, 'hand_lowered', { player_id: req.user.id, queue });
  res.json({ ok: true, queue });
});

/**
 * POST /api/sessions/:id/pass-turn
 * Il giocatore rilascia il floor senza agire.
 */
router.post('/:id/pass-turn', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (!isMultiplayerSession(session)) return res.status(400).json({ error: 'Solo per sessioni multi-player' });

  const floor = getFloor(session);
  if (floor.state !== 'player' || floor.player_id !== req.user.id) {
    return res.status(409).json({ error: 'Non hai il floor' });
  }

  releaseFloor(req.params.id);
  const updated = readJson(paths.sessionFile(req.params.id));
  broadcast(req.params.id, 'floor_change', { state: 'open', hand_queue: getFloor(updated).hand_queue });
  res.json({ ok: true });
});

/**
 * POST /api/sessions/:id/request-end
 * Giocatore propone di chiudere la sessione — avvia voto.
 */
router.post('/:id/request-end', (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (!isMultiplayerSession(session)) return res.status(400).json({ error: 'Solo per sessioni multi-player' });

  const playerEntry = session.players.find((p) => p.player_id === req.user.id);
  const character = playerEntry ? readJson(paths.characterFile(playerEntry.character_id)) : null;
  const playerName = character?.meta?.name || req.user.id;

  session.continue_votes = [];
  writeJson(paths.sessionFile(req.params.id), session);

  broadcast(req.params.id, 'session_paused', {
    reason: 'richiesta_fine',
    requesting_player: playerName,
    message: `${playerName} propone di chiudere qui la sessione. Volete continuare o chiudere?`,
  });

  res.json({ ok: true });
});

/**
 * POST /api/sessions/:id/start
 * Admin (o primo giocatore) avvia la sessione dalla lobby.
 * Richiede che tutti i giocatori siano connessi.
 */
// POST /api/sessions/:id/start — fallback manuale (normalmente l'auto-start è automatico)
router.post('/:id/start', async (req, res) => {
  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (session.floor?.state !== 'lobby') return res.status(400).json({ error: 'La sessione non è in lobby' });

  res.json({ ok: true });
  triggerSessionStart(req.params.id).catch((err) => {
    console.error('[gm/start] Errore:', err.message);
  });
});

/**
 * POST /api/sessions/:id/continue-vote
 * Voto per continuare o terminare dopo una disconnessione.
 * { vote: 'continue' | 'stop' }
 */
router.post('/:id/continue-vote', (req, res) => {
  const { vote } = req.body;
  if (!['continue', 'stop'].includes(vote)) return res.status(400).json({ error: 'vote deve essere "continue" o "stop"' });

  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  if (!['active', 'paused'].includes(session.status)) return res.status(400).json({ error: 'Sessione non attiva' });

  // Aggiorna voti
  const votes = session.continue_votes || [];
  const existing = votes.findIndex((v) => v.player_id === req.user.id);
  if (existing !== -1) votes[existing] = { player_id: req.user.id, vote };
  else votes.push({ player_id: req.user.id, vote });

  session.continue_votes = votes;
  writeJson(paths.sessionFile(req.params.id), session);

  const connected = getConnectedPlayers(req.params.id);
  const connectedVotes = votes.filter((v) => connected.includes(v.player_id));
  const stopVotes = connectedVotes.filter((v) => v.vote === 'stop').length;
  const continueVotes = connectedVotes.filter((v) => v.vote === 'continue').length;

  broadcast(req.params.id, 'continue_vote', {
    votes_continue: continueVotes,
    votes_stop: stopVotes,
    total_connected: connected.length,
  });

  // Decisione: basta un voto "stop" per fermarsi; tutti "continue" per continuare
  if (stopVotes > 0) {
    const s = readJson(paths.sessionFile(req.params.id));
    s.status = 'ended';
    writeJson(paths.sessionFile(req.params.id), s);
    broadcast(req.params.id, 'session_ended', { reason: 'voto', message: 'La sessione è terminata qui.' });
  } else if (continueVotes === connected.length) {
    session.continue_votes = [];
    writeJson(paths.sessionFile(req.params.id), session);
    broadcast(req.params.id, 'session_resumed', { message: 'La sessione continua!' });
    broadcast(req.params.id, 'floor_change', { state: 'open', hand_queue: [] });
  }

  res.json({ ok: true, votes_continue: continueVotes, votes_stop: stopVotes });
});

/**
 * POST /api/sessions/:id/dice-result
 * Riceve il risultato del tiro dado.
 */
router.post('/:id/dice-result', async (req, res) => {
  const sessionId = req.params.id;
  const { skill, roll, pushed } = req.body;

  const session = readJson(paths.sessionFile(sessionId));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const isMulti = isMultiplayerSession(session);

  // In multi-player, solo il giocatore che doveva tirare può inviare il risultato
  let actingPlayerEntry;
  if (isMulti) {
    const floor = getFloor(session);
    if (floor.state !== 'dice' || floor.dice_player_id !== req.user.id) {
      return res.status(409).json({ error: 'Non è il tuo turno di tirare' });
    }
    actingPlayerEntry = session.players.find((p) => p.player_id === req.user.id);
  } else {
    actingPlayerEntry = session.players[0];
  }

  const character = readJson(paths.characterFile(actingPlayerEntry.character_id));
  const skillValue = character.skills[skill] || character.characteristics[skill] || 0;

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

  // Salva in history
  const entry = diceHistoryEntry(session.turn_count, diceResult);
  appendHistory(sessionId, entry);

  // Applica direttive pending
  if (session.pending_directives?.length) {
    const worldState = readJson(paths.worldStateFile(sessionId));
    const { character: updatedChar, worldState: updatedWS } =
      applyDirectives(session.pending_directives, character, worldState, sessionId, diceResult);
    writeJson(paths.characterFile(actingPlayerEntry.character_id), updatedChar);
    writeJson(paths.worldStateFile(sessionId), updatedWS);
    const freshSession = readJson(paths.sessionFile(sessionId));
    freshSession.pending_directives = [];
    writeJson(paths.sessionFile(sessionId), freshSession);
  }

  // Broadcast risultato a tutti
  broadcast(sessionId, 'dice_result', {
    player_id: isMulti ? req.user.id : null,
    skill,
    ...diceResult,
    canPush: diceResult.outcome === 'failure' && !pushed,
  });

  // Rilascia floor e torna a 'open'
  releaseFloor(sessionId);
  broadcast(sessionId, 'floor_change', { state: 'open', hand_queue: getFloor(readJson(paths.sessionFile(sessionId))).hand_queue });

  res.json({ ...diceResult, canPush: diceResult.outcome === 'failure' && !pushed });
});

/**
 * POST /api/sessions/:id/choice
 * Giocatore sceglie un'opzione da pulsanti suggeriti.
 * In multi-player richiede il floor libero (come un'azione normale).
 */
router.post('/:id/choice', async (req, res) => {
  const { choice } = req.body;
  if (!choice) return res.status(400).json({ error: 'choice mancante' });

  const session = readJson(paths.sessionFile(req.params.id));
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  const isMulti = isMultiplayerSession(session);

  if (isMulti) {
    const floor = getFloor(session);
    if (floor.state !== 'open') return res.status(409).json({ error: 'Il pavimento non è libero', floor_state: floor.state });
    const result = takeFloor(req.params.id, req.user.id);
    if (!result.ok) return res.status(409).json({ error: result.reason });

    const playerEntry = session.players.find((p) => p.player_id === req.user.id);
    const character = playerEntry ? readJson(paths.characterFile(playerEntry.character_id)) : null;
    const playerName = character?.meta?.name || req.user.id;

    session.turn_count++;
    appendHistory(req.params.id, playerHistoryEntry(session.turn_count, choice, { playerId: req.user.id, playerName, type: 'action' }));
    session.last_active = new Date().toISOString();
    writeJson(paths.sessionFile(req.params.id), session);

    broadcast(req.params.id, 'floor_change', { state: 'player', player_id: req.user.id, player_name: playerName });
    broadcast(req.params.id, 'player_action', { player_id: req.user.id, player_name: playerName, content: choice });

    res.json({ turn: session.turn_count, status: 'ok' });
    runGMTurn(req.params.id, req.user.id).catch((err) => {
      console.error('[gm/choice] Errore runGMTurn:', err);
      broadcast(req.params.id, 'game_error', { message: err.message });
      releaseFloor(req.params.id);
    });
    return;
  }

  // Single-player
  session.turn_count++;
  const entry = playerHistoryEntry(session.turn_count, choice);
  appendHistory(req.params.id, entry);
  session.last_active = new Date().toISOString();
  writeJson(paths.sessionFile(req.params.id), session);
  res.json({ turn: session.turn_count, status: 'ok' });
});

export default router;
