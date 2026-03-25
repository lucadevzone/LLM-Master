import { config } from '../config.js';

/**
 * Chiama Ollama in modalità streaming.
 * Chiama il callback `onToken` per ogni token ricevuto.
 * Ritorna il testo completo accumulato.
 *
 * @param {string} model
 * @param {Array}  messages  - array di { role, content }
 * @param {function} onToken - chiamato per ogni token (stringa)
 * @param {object} options   - { format: 'json' | undefined, temperature }
 */
export async function streamChat(model, messages, onToken, options = {}) {
  const body = {
    model,
    messages,
    stream: true,
    options: {
      temperature: options.temperature ?? 0.8,
    },
  };
  if (options.format === 'json') body.format = 'json';

  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
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
    // Ollama può mandare più righe JSON per chunk
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
        // ignora righe non-JSON (raro)
      }
    }
  }

  return fullText;
}

/**
 * Chiamata non-streaming (per fase reasoning, summarization, ecc.).
 * @returns {string} risposta completa
 */
export async function chat(model, messages, options = {}) {
  const body = {
    model,
    messages,
    stream: false,
    options: { temperature: options.temperature ?? 0.5 },
  };
  if (options.format === 'json') body.format = 'json';

  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
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
 * Elenca i modelli disponibili su Ollama.
 */
export async function listModels() {
  const response = await fetch(`${config.ollamaUrl}/api/tags`);
  if (!response.ok) throw new Error('Impossibile contattare Ollama');
  const data = await response.json();
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    modified_at: m.modified_at,
  }));
}
