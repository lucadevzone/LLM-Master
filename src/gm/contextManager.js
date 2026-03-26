import { config } from '../config.js';
import { readJson, writeJson } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { createClient } from './llmClient.js';
import { buildSummaryPrompt } from './promptBuilder.js';

/**
 * Legge l'history e costruisce il contesto per il prompt GM.
 * Se l'history è lunga, usa il riepilogo + ultimi N turni.
 *
 * @param {string} sessionId
 * @returns {{ summary: string|null, recentHistory: Array }}
 */
export function buildContext(sessionId) {
  const history = readJson(paths.historyFile(sessionId), []);
  const summaryData = readJson(paths.summaryFile(sessionId), null);

  const maxTurns = config.maxHistoryTurns;

  if (history.length <= maxTurns) {
    return { summary: summaryData?.summary || null, recentHistory: history };
  }

  // History lunga: prendi solo gli ultimi maxTurns
  const recentHistory = history.slice(-maxTurns);
  return { summary: summaryData?.summary || null, recentHistory };
}

/**
 * Verifica se è necessario generare un nuovo riepilogo e lo fa.
 * Chiamato dopo ogni turno GM.
 *
 * @param {string} sessionId
 * @param {number} turnCount
 * @param {object} llmConfig - { provider, creativeModel, fastModel }
 */
export async function maybeGenerateSummary(sessionId, turnCount, llmConfig) {
  const threshold = config.summaryThreshold;
  const maxTurns = config.maxHistoryTurns;

  // Genera summary solo se abbiamo abbastanza turni "vecchi"
  if (turnCount < threshold) return;

  const history = readJson(paths.historyFile(sessionId), []);
  const summaryData = readJson(paths.summaryFile(sessionId), { last_updated_turn: 0 });
  const lastSummarizedTurn = summaryData.last_updated_turn || 0;

  // Quanti turni "non riassunti" ci sono?
  const unsummarizedCount = turnCount - lastSummarizedTurn;
  if (unsummarizedCount < threshold) return;

  // Riassumi i turni che non entreranno nella history recente
  const cutoff = history.length - maxTurns;
  if (cutoff <= 0) return;

  const toSummarize = history.slice(0, cutoff);
  if (!toSummarize.length) return;

  console.log(`[contextManager] Generando riepilogo per sessione ${sessionId} (${toSummarize.length} turni)...`);

  try {
    const summaryPrompt = buildSummaryPrompt(toSummarize);
    const client = createClient(llmConfig);
    const summaryText = await client.chat(llmConfig.fastModel, [
      { role: 'user', content: summaryPrompt },
    ], { temperature: 0.3 });

    writeJson(paths.summaryFile(sessionId), {
      last_updated_turn: turnCount,
      summary: summaryText.trim(),
      turns_summarized: toSummarize.length,
    });
  } catch (err) {
    console.error('[contextManager] Errore generazione summary:', err.message);
  }
}

/**
 * Aggiunge un'entry all'history della sessione.
 */
export function appendHistory(sessionId, entry) {
  const history = readJson(paths.historyFile(sessionId), []);
  history.push(entry);
  writeJson(paths.historyFile(sessionId), history);
}
