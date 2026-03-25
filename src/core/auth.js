import { randomBytes, pbkdf2Sync } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { readJson, writeJson, ensureDir, listFiles } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';

// ── Password ──────────────────────────────────────────────────────────────────

export function hashPassword(password, salt = null) {
  const s = salt || randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, s, 100000, 64, 'sha256').toString('hex');
  return { hash, salt: s };
}

export function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

export function generateInviteCode() {
  return randomBytes(5).toString('hex').toUpperCase(); // 10 chars
}

// ── Auth sessions (token → cookie) ───────────────────────────────────────────

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

export function createAuthToken(userId, role) {
  const token = randomBytes(32).toString('hex');
  const session = {
    token,
    userId,
    role,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  };
  ensureDir(paths.authSessions());
  writeJson(paths.authSessionFile(token), session);
  return token;
}

export function validateAuthToken(token) {
  if (!token) return null;
  const session = readJson(paths.authSessionFile(token));
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}

export function deleteAuthToken(token) {
  const file = paths.authSessionFile(token);
  if (existsSync(file)) unlinkSync(file);
}

// ── Admin account ─────────────────────────────────────────────────────────────

export function seedAdminIfNeeded(adminPassword) {
  ensureDir(paths.usersDir());
  const adminFile = paths.adminFile();
  if (readJson(adminFile)) return;

  const { hash, salt } = hashPassword(adminPassword);
  writeJson(adminFile, {
    id: 'admin',
    username: 'admin',
    role: 'admin',
    passwordHash: hash,
    salt,
    created_at: new Date().toISOString(),
  });
  console.log('[auth] Account admin creato. Password:', adminPassword);
}

export function getAdmin() {
  return readJson(paths.adminFile());
}

// ── Player accounts ───────────────────────────────────────────────────────────

export function createPlayer({ name, email }) {
  ensureDir(paths.playersDir());
  const id = uuidv4();
  const inviteCode = generateInviteCode();
  const player = {
    id,
    name,
    email,
    role: 'player',
    inviteCode,
    inviteUsed: false,
    passwordHash: null,
    salt: null,
    created_at: new Date().toISOString(),
  };
  writeJson(paths.playerFile(id), player);
  return player;
}

export function getPlayerById(id) {
  return readJson(paths.playerFile(id));
}

export function getPlayerByEmail(email) {
  const files = listFiles(paths.playersDir(), '.json');
  for (const f of files) {
    const p = readJson(paths.playerFile(f.replace('.json', '')));
    if (p?.email === email) return p;
  }
  return null;
}

export function getPlayerByInviteCode(code) {
  const files = listFiles(paths.playersDir(), '.json');
  for (const f of files) {
    const p = readJson(paths.playerFile(f.replace('.json', '')));
    if (p?.inviteCode === code.toUpperCase()) return p;
  }
  return null;
}

export function listPlayers() {
  const files = listFiles(paths.playersDir(), '.json');
  return files
    .map((f) => readJson(paths.playerFile(f.replace('.json', ''))))
    .filter(Boolean)
    .map(({ passwordHash, salt, ...safe }) => safe);
}

export function updatePlayer(id, updates) {
  const player = readJson(paths.playerFile(id));
  if (!player) return null;
  const updated = { ...player, ...updates };
  writeJson(paths.playerFile(id), updated);
  return updated;
}

export function deletePlayer(id) {
  const file = paths.playerFile(id);
  if (existsSync(file)) unlinkSync(file);
}
