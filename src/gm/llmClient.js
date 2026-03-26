import { config } from '../config.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAIProvider } from './providers/openai.js';

/**
 * Factory: crea il client LLM giusto in base alla configurazione della room/sessione.
 *
 * @param {object} llmConfig
 * @param {string} llmConfig.provider      - 'ollama' | 'openai'
 * @param {string} llmConfig.creativeModel - modello pesante (narrazione)
 * @param {string} llmConfig.fastModel     - modello leggero (reasoning, summary)
 * @param {string} [llmConfig.apiKey]      - override chiave API (opzionale, default da .env)
 *
 * @returns {OllamaProvider | OpenAIProvider}
 */
export function createClient(llmConfig) {
  if (!llmConfig?.provider) {
    throw new Error('llmConfig.provider non specificato');
  }

  switch (llmConfig.provider) {
    case 'ollama':
      return new OllamaProvider(llmConfig);
    case 'openai':
      return new OpenAIProvider(llmConfig);
    default:
      throw new Error(`Provider LLM non supportato: "${llmConfig.provider}". Valori validi: "ollama", "openai"`);
  }
}

/**
 * Configurazione LLM di default (usata se una room non specifica la propria).
 * Letta da .env tramite config.js.
 */
export function defaultLlmConfig() {
  return {
    provider: config.defaultProvider || 'ollama',
    creativeModel: config.defaultCreativeModel || 'llama3.1:8b',
    fastModel: config.defaultFastModel || 'llama3.1:8b',
  };
}
