import { validateAuthToken, getAdmin, getPlayerById } from '../core/auth.js';

/**
 * Inietta req.user se il token è valido. Non blocca la richiesta.
 */
export function loadUser(req, res, next) {
  const token = req.cookies?.llmmaster_token;
  if (!token) return next();

  const session = validateAuthToken(token);
  if (!session) return next();

  // Carica il profilo utente
  if (session.role === 'admin') {
    req.user = getAdmin();
  } else {
    req.user = getPlayerById(session.userId);
  }
  req.authToken = token;
  next();
}

/**
 * Blocca le richieste non autenticate.
 * - API: risponde 401 JSON
 * - HTML: redirect a /login
 */
export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  res.redirect('/login');
}

/**
 * Blocca le richieste non-admin.
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Accesso riservato all\'admin' });
  }
  res.redirect('/login');
}

/**
 * Blocca le richieste non-player.
 */
export function requirePlayer(req, res, next) {
  if (req.user?.role === 'player') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Accesso riservato ai giocatori' });
  }
  res.redirect('/login');
}
