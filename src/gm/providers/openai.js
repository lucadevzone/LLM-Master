import { config } from '../../config.js';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

// Modelli GPT supportati (sottoinsieme ragionevole per uso GM)
const SUPPORTED_MODELS = [
  { id: 'gpt-4o',          name: 'GPT-4o (creativo, potente)' },
  { id: 'gpt-4o-mini',     name: 'GPT-4o Mini (veloce, economico)' },
  { id: 'gpt-4-turbo',     name: 'GPT-4 Turbo' },
  { id: 'gpt-3.5-turbo',   name: 'GPT-3.5 Turbo (economico)' },
];

export class OpenAIProvider {
  constructor(llmConfig) {
    this.apiKey = llmConfig.apiKey || config.openaiApiKey;
    if (!this.apiKey) {
      throw new Error('OpenAI API key non configurata. Imposta OPENAI_API_KEY nel .env o nella room.');
    }
  }

  get #headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Streaming chat via SSE OpenAI.
   * @returns {string} testo completo accumulato
   */
  async streamChat(model, messages, onToken, options = {}) {
    const body = {
      model,
      messages,
      stream: true,
      temperature: options.temperature ?? 0.8,
    };
    if (options.format === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${err}`);
    }

    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // L'ultima riga potrebbe essere incompleta: la teniamo nel buffer
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const token = parsed.choices?.[0]?.delta?.content || '';
          if (token) {
            fullText += token;
            onToken(token);
          }
        } catch {
          // ignora righe malformate
        }
      }
    }

    return fullText;
  }

  /**
   * Chiamata non-streaming (reasoning, summarization).
   * @returns {string} risposta completa
   */
  async chat(model, messages, options = {}) {
    const body = {
      model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.5,
    };
    if (options.format === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Ritorna la lista statica di modelli supportati.
   */
  async listModels() {
    return SUPPORTED_MODELS;
  }
}
