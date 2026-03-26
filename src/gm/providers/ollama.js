import { config } from '../../config.js';

export class OllamaProvider {
  constructor(llmConfig) {
    this.baseUrl = config.ollamaUrl;
  }

  /**
   * Streaming chat. Chiama onToken per ogni token ricevuto.
   * @returns {string} testo completo accumulato
   */
  async streamChat(model, messages, onToken, options = {}) {
    const body = {
      model,
      messages,
      stream: true,
      options: { temperature: options.temperature ?? 0.8 },
    };
    if (options.format === 'json') body.format = 'json';

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama error ${response.status}: ${err}`);
    }

    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const token = parsed?.message?.content || '';
          if (token) {
            fullText += token;
            onToken(token);
          }
          if (parsed.done) break;
        } catch {
          // ignora righe non-JSON
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
      options: { temperature: options.temperature ?? 0.5 },
    };
    if (options.format === 'json') body.format = 'json';

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.message?.content || '';
  }

  /**
   * Elenca i modelli disponibili localmente.
   */
  async listModels() {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) throw new Error('Impossibile contattare Ollama');
    const data = await response.json();
    return (data.models || []).map((m) => ({
      id: m.name,
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
    }));
  }
}
