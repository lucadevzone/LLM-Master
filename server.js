import express from 'express';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './src/config.js';
import { ensureDir } from './src/persistence/fileStore.js';
import { paths } from './src/persistence/paths.js';
import { seedAdminIfNeeded } from './src/core/auth.js';
import { loadUser } from './src/middleware/auth.js';

import authRouter from './src/api/auth.js';
import usersRouter from './src/api/users.js';
import roomsRouter from './src/api/rooms.js';
import sessionsRouter from './src/api/sessions.js';
import charactersRouter from './src/api/characters.js';
import adventuresRouter from './src/api/adventures.js';
import gmRouter from './src/api/gm.js';
import adminRouter from './src/api/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(loadUser);   // inietta req.user da cookie (non-blocking)

// ── Inizializza directory dati ────────────────────────────────────────────────
ensureDir(paths.sessions());
ensureDir(paths.characters());
ensureDir(paths.adventures());
ensureDir(paths.roomsDir());
ensureDir(paths.usersDir());
ensureDir(paths.playersDir());
ensureDir(paths.authSessions());

// ── Seed admin ────────────────────────────────────────────────────────────────
seedAdminIfNeeded(process.env.ADMIN_PASSWORD || 'admin123');

// ── Route specifiche per pagine HTML ──────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.user) {
    return res.redirect(req.user.role === 'admin' ? '/admin' : '/lobby');
  }
  res.sendFile(join(__dirname, 'frontend', 'login.html'));
});

app.get('/admin', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.redirect('/login');
  res.sendFile(join(__dirname, 'frontend', 'admin.html'));
});

app.get('/lobby', (req, res) => {
  if (!req.user || req.user.role !== 'player') return res.redirect('/login');
  res.sendFile(join(__dirname, 'frontend', 'lobby.html'));
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions', gmRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/adventures', adventuresRouter);
app.use('/api', adminRouter);

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role === 'admin') return res.redirect('/admin');
  // Player con sessione attiva: serve la schermata di gioco
  if (req.query.session) return res.sendFile(join(__dirname, 'frontend', 'index.html'));
  return res.redirect('/lobby');
});

// ── Serve frontend statico ────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'frontend')));

// ── Fallback SPA (solo per il gioco) ─────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint non trovato' });
  }
  // Il gioco richiede auth — lato client controlla e reindirizza
  res.sendFile(join(__dirname, 'frontend', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server] Errore:', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`\n🎲 LLM-Master avviato su http://localhost:${config.port}`);
  console.log(`   Provider default: ${config.defaultProvider}`);
  console.log(`   Modello creativo: ${config.defaultCreativeModel}`);
  console.log(`   Modello veloce:   ${config.defaultFastModel}`);
  console.log(`   Dati in:          ${config.dataDir}\n`);
});
