import { Router } from 'express';
import { join } from 'path';
import { existsSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import multer from 'multer';
import { loadAdventure, adventureCard } from '../core/adventure.js';
import { listFiles, ensureDir } from '../persistence/fileStore.js';
import { paths } from '../persistence/paths.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Configura multer per upload in memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(md|yaml|yml)$/i)) cb(null, true);
    else cb(new Error('Solo file .md, .yaml, .yml sono accettati'));
  },
});

// GET /api/adventures — lista avventure disponibili
router.get('/', (req, res) => {
  ensureDir(paths.adventures());
  const files = listFiles(paths.adventures()).filter((f) => f.match(/\.(md|yaml|yml)$/i));

  const adventures = [];
  for (const file of files) {
    try {
      const adventure = loadAdventure(join(paths.adventures(), file));
      adventures.push(adventureCard(adventure));
    } catch (err) {
      console.warn(`[adventures] Errore caricamento ${file}:`, err.message);
    }
  }

  res.json(adventures);
});

// GET /api/adventures/:id — dettaglio avventura
router.get('/:id', (req, res) => {
  ensureDir(paths.adventures());
  const files = listFiles(paths.adventures()).filter((f) => f.match(/\.(md|yaml|yml)$/i));

  for (const file of files) {
    try {
      const adventure = loadAdventure(join(paths.adventures(), file));
      if (adventure.id === req.params.id) return res.json(adventure);
    } catch (_) {}
  }

  res.status(404).json({ error: 'Avventura non trovata' });
});

// POST /api/adventures — upload nuova avventura (solo admin)
router.post('/', requireAdmin, upload.single('adventure'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File mancante' });

  ensureDir(paths.adventures());
  const destPath = join(paths.adventures(), req.file.originalname);

  // Valida prima di salvare
  let adventure;
  try {
    // Scrivi in temp per testare
    const tempPath = destPath + '.tmp';
    writeFileSync(tempPath, req.file.buffer);
    adventure = loadAdventure(tempPath);
    // Valida OK: rinomina
    renameSync(tempPath, destPath);
  } catch (err) {
    return res.status(400).json({ error: `Avventura non valida: ${err.message}` });
  }

  res.status(201).json(adventureCard(adventure));
});

// DELETE /api/adventures/:id — solo admin
router.delete('/:id', requireAdmin, (req, res) => {
  ensureDir(paths.adventures());
  const files = listFiles(paths.adventures()).filter((f) => f.match(/\.(md|yaml|yml)$/i));

  for (const file of files) {
    try {
      const adventure = loadAdventure(join(paths.adventures(), file));
      if (adventure.id === req.params.id) {
        unlinkSync(join(paths.adventures(), file));
        return res.json({ deleted: true });
      }
    } catch (_) {}
  }

  res.status(404).json({ error: 'Avventura non trovata' });
});

export default router;
