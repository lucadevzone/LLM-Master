import { join } from 'path';
import { config } from '../config.js';

export const paths = {
  sessions: () => join(config.dataDir, 'sessions'),
  session: (id) => join(config.dataDir, 'sessions', id),
  sessionFile: (id) => join(config.dataDir, 'sessions', id, 'session.json'),
  historyFile: (id) => join(config.dataDir, 'sessions', id, 'history.json'),
  summaryFile: (id) => join(config.dataDir, 'sessions', id, 'summary.json'),
  worldStateFile: (id) => join(config.dataDir, 'sessions', id, 'world_state.json'),

  characters: () => join(config.dataDir, 'characters'),
  characterFile: (id) => join(config.dataDir, 'characters', `${id}.json`),

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

  // Rooms
  roomsDir: () => join(config.dataDir, 'rooms'),
  roomFile: (id) => join(config.dataDir, 'rooms', `${id}.json`),
};
