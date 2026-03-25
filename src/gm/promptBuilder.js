import { characterSummaryForPrompt } from '../core/character.js';

// ─── PROMPT FISSO: Identità e istruzioni output ─────────────────────────────

const GM_IDENTITY = `Sei il Custode (Game Master) di una partita di Call of Cthulhu 7a Edizione.
Conduci la partita esclusivamente in italiano. Sei il narratore, l'arbitro e la voce del mondo.
Non sei un avversario del giocatore: il tuo ruolo è creare tensione, atmosfera e conseguenze coerenti.
Non rompere mai il quarto muro. Non spiegare le tue scelte meccaniche al giocatore.`;

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
- SET_SCENE: { "type": "SET_SCENE", "scene": "<descrizione breve scena attuale>" }
- NPC_MOOD: { "type": "NPC_MOOD", "npc": "<nome>", "disposition": "<neutral|friendly|suspicious|hostile|alarmed|afraid>" }
- NPC_REVEAL: { "type": "NPC_REVEAL", "npc": "<nome>", "info": "<cosa ha rivelato>" }
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

// ─── PROMPT FISSO: Meccaniche CoC ────────────────────────────────────────────

const COC_MECHANICS = `
## MECCANICHE CALL OF CTHULHU 7a EDIZIONE

### Tiri di dado (d100)
Quando il personaggio tenta qualcosa con esito incerto, usa REQUEST_SKILL_ROLL o REQUEST_STAT_ROLL.
NON risolvere mai tu stesso i tiri: emetti la direttiva e aspetta il risultato dal sistema.

Scala di successo (roll d100, successo se roll ≤ valore):
- Successo Estremo: roll ≤ valore/5
- Successo Difficile: roll ≤ valore/2
- Successo Normale: roll ≤ valore
- Fallimento: roll > valore
- Fumble: 96-100 (o 96+ se skill < 50)

### Push (Spingere il tiro)
Dopo un fallimento, se narrativamente giustificato, usa PUSH_AVAILABLE.
Il giocatore può ritentare ma a costo: descrivere cosa rischia.

### Sanità
SANITY_LOSS causa una perdita automatica di SAN nel sistema.
Usa "loss_on_success" per successo al tiro SAN (minore), "loss_on_failure" per fallimento (maggiore).
Esempio: visione di un cadavere → loss_on_success: "0", loss_on_failure: "1d4"
Esempio: rituale blasfemo → loss_on_success: "1", loss_on_failure: "1d6+1"

### Quando richiedere un tiro
- Azione con esito incerto E conseguenze interessanti in caso di fallimento
- NON richiedere tiri per azioni banali o automaticamente riuscite
- NON richiedere tiri multipli per la stessa azione`;

// ─── PRINCIPI DI REGIA ───────────────────────────────────────────────────────

const GM_PRINCIPLES = `
## PRINCIPI DI REGIA
1. "Sì, e..." — Le azioni del personaggio hanno sempre conseguenze. Mai "non puoi".
2. Mostrare, non dire — "Le tue mani tremano" non "Sei spaventato".
3. I PNG hanno vita propria — Agiscono secondo le loro motivazioni, anche fuori scena.
4. Ritmo e respiro — Ogni scena ha tensione, climax, risoluzione. Non affrettare.
5. Coerenza totale — Ricorda tutto. Se il PG ha mentito, il PNG lo ricorda.
6. Semina per il futuro — Ogni risposta pianta un seme per dopo.
7. Il mistero prima della risposta — Per CoC: mai tutto chiaro, sempre qualcosa di inesplicabile.
8. Conseguenze, non punizioni — Il tuo scopo è drammaticamente coerente, non sconfiggere il giocatore.
9. Proporzione — Un'azione piccola ha effetti piccoli. Non tutto deve essere drammatico.
10. L'orrore cosmico è incomprensibile — Non rendere mai il Mito accessibile o razionalizzabile.`;

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

// ─── Assembla il prompt completo per la Fase 2 (Narrazione) ─────────────────

/**
 * Costruisce il system prompt completo del GM per la fase di narrazione.
 *
 * @param {Object} params
 * @param {Object} params.adventure    - avventura caricata
 * @param {Object} params.session      - sessione corrente
 * @param {Object} params.character    - scheda personaggio
 * @param {Object} params.worldState   - stato del mondo
 * @param {Object} params.context      - { summary, recentHistory }
 * @param {Object} params.reasoning    - output della fase 1 (può essere null)
 */
export function buildGMSystemPrompt({ adventure, session, character, worldState, context, reasoning }) {
  const parts = [
    GM_IDENTITY,
    OUTPUT_RULES,
    COC_MECHANICS,
    GM_PRINCIPLES,
    buildAdventureSection(adventure),
    buildWorldStateSection(worldState),
    characterSummaryForPrompt(character),
  ];

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
      messages.push({ role: 'user', content: entry.content });
    } else if (entry.role === 'system') {
      // Risultati dadi: iniettati come sistema
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

function buildWorldStateSection(worldState) {
  const lines = ['## STATO ATTUALE DEL MONDO'];

  if (worldState.current_scene) {
    lines.push(`**Scena corrente**: ${worldState.current_scene}`);
  }

  // PNG
  const npcs = Object.entries(worldState.npcs || {});
  if (npcs.length) {
    lines.push('\n**PNG e stato attuale**:');
    for (const [id, npc] of npcs) {
      const status = npc.alive === false ? ' (MORTO)' : '';
      lines.push(`- ${npc.name || id}${status}: disposizione=${npc.disposition || '?'}, luogo=${npc.location || '?'}`);
      if (npc.knowledge_revealed?.length) {
        lines.push(`  Ha rivelato: ${npc.knowledge_revealed.join(', ')}`);
      }
    }
  }

  // Indizi trovati
  if (worldState.clues_found?.length) {
    lines.push(`\n**Indizi scoperti**: ${worldState.clues_found.join(', ')}`);
  }

  // Flag attivi
  const flags = Object.entries(worldState.flags || {}).filter(([, v]) => v);
  if (flags.length) {
    lines.push('\n**Situazione corrente**:');
    for (const [k, v] of flags) {
      lines.push(`- ${k}: ${v}`);
    }
  }

  // Note del GM
  if (worldState.notes?.length) {
    lines.push('\n**Note**:');
    for (const n of worldState.notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
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
