import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Carica .env manualmente (no dipendenze esterne)
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: resolve(process.cwd(), process.env.DATA_DIR || './data'),

  // LLM — Ollama
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',

  // LLM — OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || null,

  // Valori di default per nuove room (override nella room stessa)
  defaultProvider: process.env.DEFAULT_PROVIDER || 'ollama',
  defaultCreativeModel: process.env.DEFAULT_CREATIVE_MODEL || 'llama3.1:8b',
  defaultFastModel: process.env.DEFAULT_FAST_MODEL || 'llama3.1:8b',

  // Gestione contesto e summary
  maxHistoryTurns: parseInt(process.env.MAX_HISTORY_TURNS || '20', 10),
  summaryThreshold: parseInt(process.env.SUMMARY_THRESHOLD || '30', 10),

  // Timeout proattivo del GM (millisecondi di silenzio prima che il GM intervenga da solo)
  gmProactiveTimeoutMs: parseInt(process.env.GM_PROACTIVE_TIMEOUT_MS || String(5 * 60 * 1000), 10),
};
