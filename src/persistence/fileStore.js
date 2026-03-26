import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, appendFileSync } from 'fs';
import { dirname } from 'path';

/**
 * Legge un file JSON. Ritorna defaultValue se non esiste.
 */
export function readJson(filePath, defaultValue = null) {
  if (!existsSync(filePath)) return defaultValue;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Scrive un file JSON in modo atomico (write → rename).
 * Crea le directory intermedie se non esistono.
 */
export function writeJson(filePath, data) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

/**
 * Elenca i file in una directory con una data estensione.
 */
export function listFiles(dirPath, ext = '') {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath).filter(f => !ext || f.endsWith(ext));
}

/**
 * Elenca le subdirectory di una directory.
 */
export function listDirs(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

/**
 * Assicura che una directory esista.
 */
export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

/**
 * Legge un file di testo. Ritorna defaultValue se non esiste.
 */
export function readText(filePath, defaultValue = '') {
  if (!existsSync(filePath)) return defaultValue;
  return readFileSync(filePath, 'utf8');
}

/**
 * Scrive un file di testo (sovrascrive).
 */
export function writeText(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

/**
 * Appende una riga a un file di testo.
 */
export function appendText(filePath, line) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, line + '\n', 'utf8');
}

/**
 * Cancella un file se esiste.
 */
export function deleteFile(filePath) {
  if (existsSync(filePath)) unlinkSync(filePath);
}
