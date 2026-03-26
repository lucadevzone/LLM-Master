import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { config } from '../config.js';

// ── Session directory resolver ────────────────────────────────────────────────
// Le sessioni vivono dentro la cartella della stanza: data/rooms/{roomId}/sessions/{sessionId}/

const sessionDirCache = new Map();

export function registerSessionDir(sessionId, dirPath) {
  sessionDirCache.set(sessionId, dirPath);
}

function resolveSessionDir(sessionId) {
  if (sessionDirCache.has(sessionId)) return sessionDirCache.get(sessionId);

  const roomsDir = join(config.dataDir, 'rooms');
  if (existsSync(roomsDir)) {
    for (const roomId of readdirSync(roomsDir)) {
      const candidate = join(roomsDir, roomId, 'sessions', sessionId);
      if (existsSync(candidate)) {
        sessionDirCache.set(sessionId, candidate);
        return candidate;
      }
    }
  }

  return join(config.dataDir, 'sessions', sessionId);
}

// ── Character file resolver ───────────────────────────────────────────────────
// I personaggi vivono dentro la cartella della stanza: data/rooms/{roomId}/characters/{charId}.json
// Cache in memoria: charId → percorso assoluto del file

const characterFileCache = new Map();

export function registerCharacterFile(charId, filePath) {
  characterFileCache.set(charId, filePath);
}

function resolveCharacterFile(charId) {
  if (characterFileCache.has(charId)) return characterFileCache.get(charId);

  const roomsDir = join(config.dataDir, 'rooms');
  if (existsSync(roomsDir)) {
    for (const roomId of readdirSync(roomsDir)) {
      const candidate = join(roomsDir, roomId, 'characters', `${charId}.json`);
      if (existsSync(candidate)) {
        characterFileCache.set(charId, candidate);
        return candidate;
      }
    }
  }

  // Fallback: posizione globale legacy
  return join(config.dataDir, 'characters', `${charId}.json`);
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export const paths = {
  // Sessioni (risolte dinamicamente)
  sessions: () => join(config.dataDir, 'sessions'),
  session: (id) => resolveSessionDir(id),
  sessionFile: (id) => join(resolveSessionDir(id), 'session.json'),
  historyFile: (id) => join(resolveSessionDir(id), 'history.json'),
  summaryFile: (id) => join(resolveSessionDir(id), 'summary.json'),
  worldStateFile: (id) => join(resolveSessionDir(id), 'world_state.json'),

  // Personaggi (risolti dinamicamente)
  characters: () => join(config.dataDir, 'characters'),
  characterFile: (id) => resolveCharacterFile(id),
  roomCharactersDir: (roomId) => join(config.dataDir, 'rooms', roomId, 'characters'),
  roomCharacterFile: (roomId, charId) => join(config.dataDir, 'rooms', roomId, 'characters', `${charId}.json`),

  adventures: () => join(config.dataDir, 'adventures'),
  adventureFile: (name) => join(config.dataDir, 'adventures', name),

  // Auth
  authSessions: () => join(config.dataDir, 'auth', 'sessions'),
  authSessionFile: (token) => join(config.dataDir, 'auth', 'sessions', `${token}.json`),

  // Users
  usersDir: () => join(config.dataDir, 'users'),
  adminFile: () => join(config.dataDir, 'users', 'admin.json'),
  playersDir: () => join(config.dataDir, 'users', 'players'),
  playerFile: (id) => join(config.dataDir, 'users', 'players', `${id}.json`),

  // Rooms (struttura a cartella)
  roomsDir: () => join(config.dataDir, 'rooms'),
  roomDir: (id) => join(config.dataDir, 'rooms', id),
  roomFile: (id) => join(config.dataDir, 'rooms', id, 'room.json'),
  roomDiaryFile: (id) => join(config.dataDir, 'rooms', id, 'diary.txt'),
  roomNpcsDir: (id) => join(config.dataDir, 'rooms', id, 'npcs'),
  roomNpcFile: (roomId, npcId) => join(config.dataDir, 'rooms', roomId, 'npcs', `${npcId}.json`),

  // Sessioni dentro la stanza
  roomSessionsDir: (roomId) => join(config.dataDir, 'rooms', roomId, 'sessions'),
  roomSessionDir: (roomId, sessionId) => join(config.dataDir, 'rooms', roomId, 'sessions', sessionId),

  // Scene (dentro la sessione)
  scenesDir: (sessionId) => join(resolveSessionDir(sessionId), 'scenes'),
  sceneFile: (sessionId, index) => join(resolveSessionDir(sessionId), 'scenes', `${String(index).padStart(3, '0')}.json`),
};
