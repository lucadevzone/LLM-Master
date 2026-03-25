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
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  defaultModel: process.env.DEFAULT_MODEL || 'llama3.1:8b',
  fastModel: process.env.FAST_MODEL || 'llama3.1:8b',
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: resolve(process.cwd(), process.env.DATA_DIR || './data'),
  maxHistoryTurns: parseInt(process.env.MAX_HISTORY_TURNS || '20', 10),
  summaryThreshold: parseInt(process.env.SUMMARY_THRESHOLD || '30', 10),
};
