import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createPlayer, listPlayers, getPlayerById,
  updatePlayer, deletePlayer,
} from '../core/auth.js';

const router = Router();
router.use(requireAdmin);

// GET /api/users — lista giocatori
router.get('/', (req, res) => {
  res.json(listPlayers());
});

// GET /api/users/:id
router.get('/:id', (req, res) => {
  const player = getPlayerById(req.params.id);
  if (!player) return res.status(404).json({ error: 'Giocatore non trovato' });
  const { passwordHash, salt, ...safe } = player;
  res.json(safe);
});

// POST /api/users — crea nuovo giocatore
router.post('/', (req, res) => {
  const { name, email } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'name ed email sono obbligatori' });
  }
  const player = createPlayer({ name: name.trim(), email: email.trim().toLowerCase() });
  // Ritorna l'inviteCode in chiaro (solo alla creazione)
  res.status(201).json({
    id: player.id,
    name: player.name,
    email: player.email,
    inviteCode: player.inviteCode,
    inviteUsed: false,
    created_at: player.created_at,
  });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  const player = getPlayerById(req.params.id);
  if (!player) return res.status(404).json({ error: 'Giocatore non trovato' });
  deletePlayer(req.params.id);
  res.json({ deleted: true });
});

export default router;
