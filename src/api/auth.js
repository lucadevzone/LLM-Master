import { Router } from 'express';
import {
  verifyPassword, createAuthToken, deleteAuthToken,
  getAdmin, getPlayerByEmail, getPlayerByInviteCode,
  updatePlayer, updateAdmin, hashPassword,
} from '../core/auth.js';

const router = Router();
const COOKIE_NAME = 'llmmaster_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, email, password } = req.body;

  // Login admin (usa username)
  if (username) {
    const admin = getAdmin();
    if (!admin || admin.username !== username) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    if (!verifyPassword(password, admin.passwordHash, admin.salt)) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    const token = createAuthToken('admin', 'admin');
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    return res.json({ role: 'admin', redirect: '/admin' });
  }

  // Login player (usa email)
  if (email) {
    const player = getPlayerByEmail(email);
    if (!player || !player.inviteUsed || !player.passwordHash) {
      return res.status(401).json({ error: 'Credenziali non valide o account non attivato' });
    }
    if (!verifyPassword(password, player.passwordHash, player.salt)) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    const token = createAuthToken(player.id, 'player');
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    return res.json({ role: 'player', redirect: '/lobby' });
  }

  res.status(400).json({ error: 'Fornire username (admin) o email (player)' });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (req.authToken) deleteAuthToken(req.authToken);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
  const { passwordHash, salt, ...safe } = req.user;
  res.json(safe);
});

// GET /api/auth/invite/:code — verifica codice invito
router.get('/invite/:code', (req, res) => {
  const player = getPlayerByInviteCode(req.params.code);
  if (!player) return res.status(404).json({ error: 'Codice invito non valido' });
  if (player.inviteUsed) return res.status(400).json({ error: 'Codice già utilizzato' });
  res.json({ name: player.name, email: player.email });
});

// POST /api/auth/invite/:code — attiva account con password
router.post('/invite/:code', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password di almeno 6 caratteri' });
  }

  const player = getPlayerByInviteCode(req.params.code);
  if (!player) return res.status(404).json({ error: 'Codice invito non valido' });
  if (player.inviteUsed) return res.status(400).json({ error: 'Codice già utilizzato' });

  const { hash, salt } = hashPassword(password);
  updatePlayer(player.id, {
    passwordHash: hash,
    salt,
    inviteUsed: true,
    inviteCode: null, // invalida il codice
  });

  // Login automatico dopo attivazione
  const token = createAuthToken(player.id, 'player');
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, redirect: '/lobby' });
});

// POST /api/auth/change-password — cambia la propria password (utente autenticato)
router.post('/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });

  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password e new_password sono obbligatori' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'La nuova password deve essere di almeno 6 caratteri' });
  }

  // Verifica password attuale
  if (!verifyPassword(current_password, req.user.passwordHash, req.user.salt)) {
    return res.status(403).json({ error: 'Password attuale non corretta' });
  }

  const { hash, salt } = hashPassword(new_password);
  if (req.user.role === 'admin') {
    updateAdmin({ passwordHash: hash, salt });
  } else {
    updatePlayer(req.user.id, { passwordHash: hash, salt });
  }

  res.json({ ok: true });
});

export default router;
