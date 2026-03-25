import { readFileSync } from 'fs';
import matter from 'gray-matter';

/**
 * Carica e parsa un file avventura (.md o .yaml).
 * Formato: frontmatter YAML + body Markdown.
 *
 * Frontmatter obbligatorio: title
 * Frontmatter opzionale: era, tone, players, tags
 */
export function loadAdventure(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const { data: meta, content: body } = matter(raw);

  if (!meta.title) {
    throw new Error(`Avventura non valida: manca il campo "title" nel frontmatter (${filePath})`);
  }

  // Deriva un id dal nome file
  const fileName = filePath.split('/').pop().replace(/\.(md|yaml|yml)$/, '');

  return {
    id: meta.id || fileName,
    title: meta.title,
    era: meta.era || '',
    tone: meta.tone || '',
    players: meta.players || '1-4',
    tags: meta.tags || [],
    fileName,
    // Il body Markdown viene passato verbatim al GM
    content: body.trim(),
  };
}

/**
 * Crea lo stato mondo iniziale da un'avventura.
 * Struttura minimale — verrà arricchita dal GM durante il gioco.
 */
export function initialWorldState(adventure) {
  return {
    adventure_id: adventure.id,
    npcs: {},
    locations: {},
    flags: {},
    active_threats: [],
    clues_found: [],
    current_scene: null,
    notes: [],
  };
}

/**
 * Formatta i metadati dell'avventura per la landing page.
 */
export function adventureCard(adventure) {
  return {
    id: adventure.id,
    title: adventure.title,
    era: adventure.era,
    tone: adventure.tone,
    players: adventure.players,
    tags: adventure.tags,
  };
}
