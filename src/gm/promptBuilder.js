import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { characterSummaryForPrompt } from '../core/character.js';
import { readJson, readText, listFiles } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { buildTurnMonitorSection } from './turnMonitor.js';

// ── Regole del custode (lette da file .md) ───────────────────────────────────

function loadCustodeRules(key) {
  const fileMap = {
    // Fasi del ciclo
    avvio: 'avvio.md',
    inizio_sessione: 'inizio_sessione.md',
    impostare_scena: 'impostare_scena.md',
    coinvolgere_pg: 'coinvolgere_pg.md',
    reagire_dichiarazioni: 'reagire_dichiarazioni.md',
    // Regole trasversali
    regole_coc: 'regole_coc.md',
    principi_regia: 'principi_regia.md',
    gestire_gruppi: 'gestire_gruppi.md',
  };
  const filename = fileMap[key];
  if (!filename) return null;
  const filePath = join(process.cwd(), 'custode', filename);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8').trim();
}

// ─── PROMPT FISSO: Identità ───────────────────────────────────────────────────

const GM_IDENTITY = `Sei il Custode (Game Master) di una partita di Call of Cthulhu 7a Edizione.
Conduci la partita esclusivamente in italiano. Sei il narratore, l'arbitro e la voce del mondo.
Non sei un avversario dei giocatori: il tuo ruolo è creare tensione, atmosfera e conseguenze coerenti.
Non rompere mai il quarto muro. Non spiegare le tue scelte meccaniche ai giocatori.
In sessioni con più giocatori, gestisci la parola come un master vero: indirizza la narrazione al personaggio attivo,
ma considera sempre il gruppo — le reazioni degli altri PG, i loro commenti, le interruzioni — nel costruire la scena.`;

const OUTPUT_RULES = `
## REGOLE DI OUTPUT (OBBLIGATORIE)
Rispondi SEMPRE e SOLO con un oggetto JSON valido. Nessun testo fuori dal JSON. Mai.
Struttura obbligatoria:
{
  "narrative": "<testo narrativo per il giocatore>",
  "directives": [<lista di direttive di gioco, può essere vuota []>],
  "ui_hints": {
    "atmosphere_tag": "<aggettivo atmosfera: es. tesa, oscura, silenziosa>",
    "suggested_actions": ["<azione 1>", "<azione 2>", "<azione 3>"]
  }
}

### Tipi di direttiva disponibili:

**Ciclo del custode:**
- NEW_SCENE: { "type": "NEW_SCENE", "title": "<titolo breve>", "time": "<tempo narrativo>", "location": "<luogo>", "characters_present": ["<nome PG/PNG>"], "threats": ["<minaccia>"], "clues": ["<indizio>"] }
- UPDATE_SCENE: { "type": "UPDATE_SCENE", "event": "<evento accaduto>", "add_threat": "<minaccia>", "remove_threat": "<minaccia risolta>", "add_clue": "<indizio>", "add_character": "<nome>", "remove_character": "<nome>", "time": "<nuovo tempo>", "location": "<nuova location>" }
- SET_CYCLE_PHASE: { "type": "SET_CYCLE_PHASE", "phase": "<impostare_scena|coinvolgere_pg|reagire_dichiarazioni>" }
- ASSIGN_TURN: { "type": "ASSIGN_TURN", "character_name": "<nome esatto del PG a cui assegni la parola>" }
- OPEN_FLOOR: { "type": "OPEN_FLOOR" }
- PASS: { "type": "PASS" } — non intervenire: lascia che i giocatori si parlino tra loro. Usa questa direttiva quando la conversazione tra PG è fluente e non richiede il tuo intervento. La narrative deve essere vuota ("").
- WHISPER: { "type": "WHISPER", "character_name": "<nome esatto del PG destinatario>", "message": "<testo visibile solo a quel giocatore>" }

**Gestione gruppi (usa solo se i giocatori si sono divisi):**
- SPLIT_GROUP: { "type": "SPLIT_GROUP", "player_names": ["<nome PG>", ...], "location": "<luogo in cui si trovano>" }
- SWITCH_GROUP: { "type": "SWITCH_GROUP", "group_id": "<id gruppo visibile nel riepilogo>", "transition": "<frase narrativa di transizione, es. Nel frattempo...>" }
- MERGE_GROUP: { "type": "MERGE_GROUP", "group_id": "<id gruppo da riassorbire nel gruppo attivo>", "transition": "<frase narrativa>" }

**PNG:**
- NPC_MOOD: { "type": "NPC_MOOD", "npc": "<nome>", "disposition": "<neutral|friendly|suspicious|hostile|alarmed|afraid>" }
- NPC_REVEAL: { "type": "NPC_REVEAL", "npc": "<nome>", "info": "<cosa ha rivelato>" }

**Narrativa e meccaniche:**
- CLUE_FOUND: { "type": "CLUE_FOUND", "clue": "<nome indizio>", "description": "<descrizione>" }
- FLAG_SET: { "type": "FLAG_SET", "flag": "<nome flag>", "value": <true|false|"stringa"> }
- REQUEST_SKILL_ROLL: { "type": "REQUEST_SKILL_ROLL", "skill": "<nome skill>", "difficulty": "<normal|hard|extreme>", "reason": "<perché>", "on_success": "<narrativa successo>", "on_failure": "<narrativa fallimento>", "on_extreme": "<narrativa estremo>" }
- REQUEST_STAT_ROLL: { "type": "REQUEST_STAT_ROLL", "stat": "<STR|CON|DEX|INT|POW|APP>", "difficulty": "<normal|hard|extreme>", "reason": "<perché>" }
- SANITY_LOSS: { "type": "SANITY_LOSS", "loss_on_success": "<0 o 1>", "loss_on_failure": "<dado es. 1d6>", "reason": "<perché>" }
- HP_LOSS: { "type": "HP_LOSS", "amount": <numero>, "reason": "<perché>" }
- HP_GAIN: { "type": "HP_GAIN", "amount": <numero>, "reason": "<perché>" }
- ITEM_GAIN: { "type": "ITEM_GAIN", "item": "<nome oggetto>", "description": "<descrizione>" }
- ITEM_LOSS: { "type": "ITEM_LOSS", "item": "<nome oggetto>" }
- PUSH_AVAILABLE: { "type": "PUSH_AVAILABLE", "skill": "<nome skill>", "risk": "<cosa rischia il personaggio>" }
- SESSION_END: { "type": "SESSION_END", "outcome": "<vittoria|morte|follia|fuga>" }`;


// ─── PROMPT FASE 1: Reasoning ────────────────────────────────────────────────

export const REASONING_SYSTEM_PROMPT = `Sei il Custode di Call of Cthulhu. Prima di rispondere al giocatore, analizza la situazione.
Rispondi SOLO con JSON valido, nessun testo aggiuntivo.

Struttura:
{
  "player_intent": "<cosa sta cercando di fare il personaggio>",
  "interpretation": "<come interpreti l'azione, cosa implica>",
  "roll_needed": {
    "required": <true|false>,
    "skill": "<nome skill o null>",
    "difficulty": "<normal|hard|extreme>",
    "why": "<perché questo tiro>"
  },
  "npc_reactions": {
    "<nome_npc>": "<come reagisce e perché>"
  },
  "consequences": {
    "on_success": "<cosa succede se riesce>",
    "on_failure": "<cosa succede se fallisce>",
    "immediate": "<cosa succede comunque, indipendentemente dal tiro>"
  },
  "sanity_check_needed": <true|false>,
  "drama_direction": "<come rendere questa scena più efficace drammaticamente>",
  "pacing": "<veloce|normale|lento — e perché>",
  "atmosphere_note": "<aggettivo o breve nota sull'atmosfera da mantenere>"
}`;

// ─── Helper: carica dati contestuali per fase ─────────────────────────────────

function loadRoomDiary(roomId) {
  if (!roomId) return '';
  return readText(paths.roomDiaryFile(roomId), '').trim();
}

/**
 * Carica le schede PNG presenti nella scena (esclude i PG).
 * @param {string} roomId
 * @param {string[]} sceneCharNames - nomi da currentScene.characters_present
 * @param {string[]} partyNames     - nomi dei PG (da escludere)
 */
function loadSceneNPCs(roomId, sceneCharNames, partyNames) {
  if (!roomId || !sceneCharNames?.length) return [];
  const partySet = new Set((partyNames || []).map((n) => n.toLowerCase()));
  const npcNames = sceneCharNames.filter((n) => !partySet.has(n.toLowerCase()));
  if (!npcNames.length) return [];

  const npcsDir = paths.roomNpcsDir(roomId);
  const files = listFiles(npcsDir, '.json');
  const result = [];

  for (const file of files) {
    const npc = readJson(join(npcsDir, file));
    if (!npc) continue;
    if (npcNames.some((n) => n.toLowerCase() === (npc.name || '').toLowerCase())) {
      result.push(npc);
    }
  }
  return result;
}

function buildDiarySection(diary) {
  if (!diary) return null;
  return `## DIARIO DI STANZA\n${diary}`;
}

function buildNPCsSection(npcs) {
  if (!npcs?.length) return null;
  const lines = ['## SCHEDE PNG PRESENTI NELLA SCENA'];
  for (const npc of npcs) {
    lines.push(`\n### ${npc.name}${npc.role ? ` (${npc.role})` : ''}`);
    if (npc.description) lines.push(npc.description);
    if (npc.stats && Object.keys(npc.stats).length) {
      const statLine = Object.entries(npc.stats).map(([k, v]) => `${k}: ${v}`).join(' | ');
      lines.push(`Stats: ${statLine}`);
    }
    if (npc.knowledge?.length) {
      lines.push(`Sa: ${npc.knowledge.join('; ')}`);
    }
    if (npc.events?.length) {
      lines.push('Ultimi eventi:');
      for (const e of npc.events.slice(-3)) lines.push(`  • ${e.text || e}`);
    }
  }
  return lines.join('\n');
}

/**
 * Sezione con tutti i personaggi del gruppo in dettaglio completo.
 * Usata in coinvolgere_pg e reagire_dichiarazioni.
 */
function buildAllCharactersDetailedSection(characters, floorContext) {
  const lines = ['## SCHEDE COMPLETE DEL GRUPPO'];

  for (const char of characters) {
    const { meta } = char;
    const isActing = floorContext?.actingPlayerName === meta.name;
    if (isActing) lines.push(`\n★ **${meta.name}** (ha la parola)`);
    else lines.push(`\n**${meta.name}**`);
    lines.push(characterSummaryForPrompt(char));
  }

  if (floorContext?.actingPlayerName) {
    lines.push(`\n★ = personaggio attivo: **${floorContext.actingPlayerName}**`);
  }

  return lines.join('\n');
}

// ─── Assembla il prompt completo per la Fase 2 (Narrazione) ─────────────────

/**
 * Costruisce il system prompt completo del GM per la fase di narrazione.
 *
 * @param {Object} params
 * @param {Object} params.adventure        - avventura caricata
 * @param {Object} params.session          - sessione corrente
 * @param {Object} params.character        - scheda del personaggio attivo (retrocompat single-player)
 * @param {Object[]} [params.characters]   - tutti i personaggi del gruppo (multi-player)
 * @param {Object} params.worldState       - stato del mondo
 * @param {Object} params.context          - { summary, recentHistory }
 * @param {Object} params.reasoning        - output della fase 1 (può essere null)
 * @param {Object} [params.floorContext]   - { actingPlayerName, handQueue: [name,...] }
 * @param {string} [params.sessionId]      - id sessione (per leggere la scena corrente)
 * @param {string} [params.roomId]         - id stanza (per diary e PNG)
 */
export function buildGMSystemPrompt({ adventure, session, character, characters, worldState, context, reasoning, floorContext, sessionId, roomId }) {
  // In multi-player usa characters[], altrimenti fallback su character singolo
  const party = characters?.length ? characters : (character ? [character] : []);
  const isMultiplayer = party.length > 1;
  const partyNames = party.map((c) => c.meta?.name).filter(Boolean);
  const phase = worldState.cycle_phase;

  // Flags per sezioni contestuali per fase
  const needsWorldState = phase !== 'avvio';
  const needsDiary = phase === 'inizio_sessione' || phase === 'impostare_scena';
  const needsNPCs = phase === 'impostare_scena' || phase === 'coinvolgere_pg' || phase === 'reagire_dichiarazioni';
  const needsAllCharsDetailed = phase === 'avvio' || phase === 'coinvolgere_pg' || phase === 'reagire_dichiarazioni';

  // Leggi la scena corrente dal file
  const currentScene = needsWorldState && sessionId && worldState.current_scene_index > 0
    ? readJson(paths.sceneFile(sessionId, worldState.current_scene_index))
    : null;

  // Regole della fase corrente del ciclo
  const cycleRules = loadCustodeRules(phase);

  const cocRules = loadCustodeRules('regole_coc');
  const gmPrinciples = loadCustodeRules('principi_regia');
  const hasMultipleGroups = (worldState.groups?.length ?? 0) > 1;
  const groupRules = hasMultipleGroups ? loadCustodeRules('gestire_gruppi') : null;

  const parts = [
    GM_IDENTITY,
    OUTPUT_RULES,
  ];

  if (cocRules) parts.push(cocRules);
  if (gmPrinciples) parts.push(gmPrinciples);

  parts.push(buildAdventureSection(adventure));

  // Stato del mondo (non incluso per avvio)
  if (needsWorldState) {
    parts.push(buildWorldStateSection(worldState, currentScene));
  }

  // Diario (solo per inizio_sessione e impostare_scena)
  if (needsDiary) {
    const diary = loadRoomDiary(roomId);
    if (diary) parts.push(buildDiarySection(diary));
  }

  // PNG (per impostare_scena, coinvolgere_pg, reagire_dichiarazioni)
  if (needsNPCs) {
    const sceneCharNames = currentScene?.characters_present || [];
    const npcs = loadSceneNPCs(roomId, sceneCharNames, partyNames);
    if (npcs.length) parts.push(buildNPCsSection(npcs));
  }

  // Personaggi: dettaglio completo per avvio/coinvolgere_pg/reagire_dichiarazioni
  if (isMultiplayer) {
    if (needsAllCharsDetailed) {
      parts.push(buildAllCharactersDetailedSection(party, floorContext));
    } else {
      parts.push(buildPartySection(party, floorContext));
    }
  } else {
    parts.push(characterSummaryForPrompt(party[0] || character));
  }

  if (floorContext && isMultiplayer) {
    parts.push(buildFloorContextSection(floorContext));
  }

  // Monitor coinvolgimento (solo multiplayer, solo quando ci sono dati)
  if (isMultiplayer) {
    const turnSection = buildTurnMonitorSection(worldState, partyNames);
    if (turnSection) parts.push(turnSection);
  }

  if (cycleRules) {
    parts.push(buildCycleRulesSection(phase, cycleRules));
  }

  if (groupRules) {
    parts.push(`## REGOLE: GESTIONE GRUPPI\n\n${groupRules}`);
  }

  if (reasoning) {
    parts.push(buildReasoningSection(reasoning));
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Costruisce il messaggio di contesto (history) per la conversazione.
 * Ritorna un array di messaggi {role, content} da passare a Ollama.
 */
export function buildConversationMessages({ context, playerAction, diceResult }) {
  const messages = [];

  // Summary dei turni vecchi (se presente)
  if (context.summary) {
    messages.push({
      role: 'system',
      content: `[RIEPILOGO SESSIONE PRECEDENTE]\n${context.summary}`,
    });
  }

  // History recente
  for (const entry of context.recentHistory) {
    if (entry.role === 'gm') {
      messages.push({ role: 'assistant', content: entry.content });
    } else if (entry.role === 'player') {
      // In multi-player prefissa con nome e tipo (commento/interruzione)
      let content = entry.content;
      if (entry.player_name) {
        const typeLabel = entry.message_type === 'comment' ? '[commento]'
          : entry.message_type === 'interrupt' ? '[interruzione]'
          : '';
        content = `${entry.player_name}${typeLabel ? ' ' + typeLabel : ''}: ${content}`;
      }
      messages.push({ role: 'user', content });
    } else if (entry.role === 'system') {
      messages.push({ role: 'system', content: entry.content });
    }
  }

  // Azione corrente del giocatore
  if (diceResult) {
    // Stiamo rispondendo a un risultato dado
    messages.push({
      role: 'system',
      content: `[RISULTATO TIRO]\n${diceResult.content}\nEsito: ${diceResult.dice_result.label} (${diceResult.dice_result.roll}/${diceResult.dice_result.skillValue})`,
    });
  } else if (playerAction) {
    messages.push({ role: 'user', content: playerAction });
  }

  return messages;
}

// ─── Sezioni variabili ────────────────────────────────────────────────────────

function buildAdventureSection(adventure) {
  return `## AVVENTURA: ${adventure.title}
Era: ${adventure.era} | Tono: ${adventure.tone} | Giocatori: ${adventure.players}

${adventure.content}`;
}

function buildWorldStateSection(worldState, currentScene) {
  const lines = ['## STATO ATTUALE DEL MONDO'];

  // Fase del ciclo
  const phaseLabel = {
    impostare_scena: 'Impostare la scena',
    coinvolgere_pg: 'Coinvolgere i PG',
    reagire_dichiarazioni: 'Reagire alle dichiarazioni',
  }[worldState.cycle_phase] || worldState.cycle_phase;
  lines.push(`**Fase ciclo**: ${phaseLabel}`);

  // Gruppi (solo quando il party è diviso)
  if (worldState.groups?.length > 1) {
    const now = Date.now();
    lines.push('\n**Gruppi:**');
    for (const g of worldState.groups) {
      const isActive = g.id === worldState.active_group_id;
      const prefix = isActive ? '→ [ATTIVO]' : '         ';
      const names = g.character_names?.join(', ') || '?';
      const loc = g.sub_location || '?';
      const waitMs = g.last_active_at ? now - new Date(g.last_active_at).getTime() : null;
      const waitLabel = waitMs !== null ? `${Math.round(waitMs / 60000)} min fa` : 'mai';
      const warning = !isActive && waitMs !== null && waitMs > 5 * 60 * 1000 ? ' ⚠ in attesa' : '';
      lines.push(`${prefix} ${g.id} — ${names} — ${loc} (${waitLabel})${warning}`);
    }
  }

  // Scena corrente (dal file)
  if (currentScene) {
    lines.push(`\n**Scena ${currentScene.index}: ${currentScene.title}**`);
    if (currentScene.time) lines.push(`- Tempo: ${currentScene.time}`);
    if (currentScene.location) lines.push(`- Luogo: ${currentScene.location}`);
    if (currentScene.characters_present?.length) lines.push(`- Presenti: ${currentScene.characters_present.join(', ')}`);
    if (currentScene.threats?.length) lines.push(`- Minacce: ${currentScene.threats.join(', ')}`);
    if (currentScene.clues?.length) lines.push(`- Indizi disponibili: ${currentScene.clues.join(', ')}`);
    if (currentScene.events?.length) {
      lines.push('- Ultimi eventi nella scena:');
      for (const e of currentScene.events.slice(-5)) lines.push(`  • ${e.text}`);
    }
  } else {
    lines.push('\n*(Nessuna scena aperta — usa NEW_SCENE per aprire la prima scena)*');
  }

  // PNG globali
  const npcs = Object.entries(worldState.npcs || {});
  if (npcs.length) {
    lines.push('\n**PNG noti**:');
    for (const [id, npc] of npcs) {
      const status = npc.alive === false ? ' (MORTO)' : '';
      lines.push(`- ${npc.name || id}${status}: disposizione=${npc.disposition || '?'}`);
      if (npc.knowledge_revealed?.length) lines.push(`  Ha rivelato: ${npc.knowledge_revealed.join(', ')}`);
    }
  }

  // Indizi trovati globalmente
  if (worldState.clues_found?.length) {
    lines.push(`\n**Indizi scoperti**: ${worldState.clues_found.join(', ')}`);
  }

  // Flag attivi
  const flags = Object.entries(worldState.flags || {}).filter(([, v]) => v);
  if (flags.length) {
    lines.push('\n**Situazione corrente**:');
    for (const [k, v] of flags) lines.push(`- ${k}: ${v}`);
  }

  // Note del GM
  if (worldState.notes?.length) {
    lines.push('\n**Note**:');
    for (const n of worldState.notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}

function buildCycleRulesSection(phase, rules) {
  const phaseLabel = {
    impostare_scena: 'IMPOSTARE LA SCENA',
    coinvolgere_pg: 'COINVOLGERE I PG',
    reagire_dichiarazioni: 'REAGIRE ALLE DICHIARAZIONI',
  }[phase] || phase.toUpperCase();
  return `## REGOLE DI FASE: ${phaseLabel}\n\n${rules}`;
}

function buildReasoningSection(reasoning) {
  return `## ANALISI PRE-RISPOSTA (TUO RAGIONAMENTO INTERNO)
Usa questa analisi come guida per la tua risposta narrativa.

Intenzione giocatore: ${reasoning.player_intent}
Interpretazione: ${reasoning.interpretation}
Tiro richiesto: ${reasoning.roll_needed?.required ? `${reasoning.roll_needed.skill} (${reasoning.roll_needed.difficulty}) — ${reasoning.roll_needed.why}` : 'no'}
Direzione drammatica: ${reasoning.drama_direction}
Ritmo: ${reasoning.pacing}
Atmosfera: ${reasoning.atmosphere_note}

Conseguenze immediate: ${reasoning.consequences?.immediate || 'nessuna'}`;
}

// ─── Sezioni multi-player ─────────────────────────────────────────────────────

/**
 * Sezione che descrive il gruppo al completo.
 * Il personaggio attivo è marcato con ★.
 * @param {Object[]} characters - tutti i personaggi
 * @param {Object} [floorContext] - { actingPlayerName }
 */
function buildPartySection(characters, floorContext) {
  const lines = ['## GRUPPO DEI PERSONAGGI'];

  for (const char of characters) {
    const { meta, derived } = char;
    const isActing = floorContext?.actingPlayerName === meta.name;
    const marker = isActing ? '★ ' : '  ';
    lines.push(
      `${marker}**${meta.name}** (${meta.occupation}) — ` +
      `PS ${derived.hp_current}/${derived.hp_max} | SAN ${derived.sanity_current}/${derived.sanity_max}`
    );
  }

  if (floorContext?.actingPlayerName) {
    lines.push(`\n★ = personaggio che ha la parola in questo turno: **${floorContext.actingPlayerName}**`);
  }

  // Scheda completa solo per il personaggio attivo (risparmia token)
  const acting = floorContext?.actingPlayerName
    ? characters.find((c) => c.meta.name === floorContext.actingPlayerName)
    : characters[0];

  if (acting) {
    lines.push('');
    lines.push(characterSummaryForPrompt(acting));
  }

  return lines.join('\n');
}

/**
 * Contesto del floor per il GM: chi vuole parlare, commenti pendenti.
 * @param {Object} floorContext
 * @param {string} floorContext.actingPlayerName
 * @param {string[]} [floorContext.handQueue]   - nomi di chi ha alzato la mano
 * @param {string[]} [floorContext.pendingComments] - commenti/interruzioni arrivati
 */
function buildFloorContextSection(floorContext) {
  const lines = ['## GESTIONE PAROLA (FLOOR)'];

  if (floorContext.actingPlayerName) {
    lines.push(`**Ha la parola**: ${floorContext.actingPlayerName}`);
  }

  if (floorContext.handQueue?.length) {
    lines.push(`**Vuole intervenire**: ${floorContext.handQueue.join(', ')} — considerali nella tua narrazione quando appropriato.`);
  }

  if (floorContext.pendingComments?.length) {
    lines.push('\n**Commenti/interruzioni ricevute durante questa azione**:');
    for (const c of floorContext.pendingComments) {
      lines.push(`- ${c.player_name}: "${c.content}"`);
    }
    lines.push('Puoi incorporarli narrativamente se sono coerenti con la scena.');
  }

  return lines.join('\n');
}

// ─── Prompt per riassunto contesto ────────────────────────────────────────────

export function buildSummaryPrompt(historyToSummarize) {
  const lines = historyToSummarize
    .filter((e) => e.role !== 'system' || e.dice_result)
    .map((e) => {
      if (e.role === 'gm') return `GM: ${e.content.substring(0, 300)}...`;
      if (e.role === 'player') return `Giocatore: ${e.content}`;
      if (e.dice_result) return `[Tiro ${e.dice_result.skillName}: ${e.dice_result.label}]`;
      return '';
    })
    .filter(Boolean);

  return `Produci un riepilogo factuale e conciso (max 200 parole) in italiano di questa sessione di Call of Cthulhu.
Includi: cosa ha fatto il personaggio, chi ha incontrato, cosa ha scoperto, come è cambiato lo stato emotivo/fisico.
Non usare tono narrativo. Sii preciso e informativo.

SESSIONE:
${lines.join('\n')}

RIEPILOGO:`;
}
