/**
 * Parsing della risposta strutturata JSON del GM.
 * Robusto: non si rompe se il JSON è malformato.
 */

/**
 * Parsa la risposta completa del GM.
 * @param {string} rawText - testo grezzo dall'LLM
 * @returns {{ narrative: string, directives: Array, ui_hints: Object, parseError: boolean }}
 */
export function parseGMResponse(rawText) {
  // Tentativo 1: parse diretto
  try {
    const parsed = JSON.parse(rawText.trim());
    return normalizeResponse(parsed);
  } catch (_) {}

  // Tentativo 2: estrai JSON da eventuali wrapper markdown (```json ... ```)
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      return normalizeResponse(parsed);
    } catch (_) {}
  }

  // Tentativo 3: trova il primo oggetto JSON nel testo
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return normalizeResponse(parsed);
    } catch (_) {}
  }

  // Fallback: tratta tutto come narrativa, senza direttive
  console.warn('[responseParser] Impossibile parsare JSON GM, uso fallback narrativo');
  return {
    narrative: rawText.trim() || '(nessuna risposta dal master)',
    directives: [],
    ui_hints: { atmosphere_tag: 'misteriosa', suggested_actions: [] },
    parseError: true,
  };
}

/**
 * Parsa la risposta del reasoning (fase 1).
 * @returns {Object|null}
 */
export function parseReasoningResponse(rawText) {
  try {
    const parsed = JSON.parse(rawText.trim());
    return parsed;
  } catch (_) {}

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_) {}
  }

  console.warn('[responseParser] Reasoning non parsabile, fase 1 saltata');
  return null;
}

/**
 * Normalizza e valida la struttura della risposta GM.
 */
function normalizeResponse(parsed) {
  return {
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative : String(parsed.narrative || ''),
    directives: Array.isArray(parsed.directives) ? parsed.directives.filter(isValidDirective) : [],
    ui_hints: {
      atmosphere_tag: parsed.ui_hints?.atmosphere_tag || 'neutra',
      suggested_actions: Array.isArray(parsed.ui_hints?.suggested_actions)
        ? parsed.ui_hints.suggested_actions.slice(0, 4)
        : [],
    },
    parseError: false,
  };
}

/**
 * Verifica che una direttiva abbia almeno il campo `type`.
 */
function isValidDirective(d) {
  return d && typeof d.type === 'string';
}

/**
 * Estrae le direttive che richiedono un tiro dado (per mostrare il pulsante).
 */
export function extractDiceRequests(directives) {
  return directives.filter((d) =>
    d.type === 'REQUEST_SKILL_ROLL' || d.type === 'REQUEST_STAT_ROLL'
  );
}

/**
 * Separa le direttive in: "applica subito" vs "applica dopo il tiro".
 */
export function splitDirectives(directives) {
  const immediate = [];
  const afterDice = [];
  let foundDiceRequest = false;

  for (const d of directives) {
    if (d.type === 'REQUEST_SKILL_ROLL' || d.type === 'REQUEST_STAT_ROLL') {
      foundDiceRequest = true;
      immediate.push(d); // la richiesta stessa è immediata (mostra UI)
    } else if (foundDiceRequest) {
      afterDice.push(d); // sanity loss, item gain, ecc. attesi dopo il tiro
    } else {
      immediate.push(d);
    }
  }

  return { immediate, afterDice };
}
