/**
 * @fileoverview Express server entry point for the Chronicle D&D tracker.
 * Configures middleware, mounts API routes, serves static files, and handles auto-seeding on startup.
 */
'use strict';
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const seedEffectDefinitions = require('./effects/seed-effects');
const { authMiddleware, cleanupExpiredSessions } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(authMiddleware);

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/classes', require('./routes/classes'));
app.use('/api/races', require('./routes/races'));
app.use('/api/spells', require('./routes/spells'));
app.use('/api/feats', require('./routes/feats'));
app.use('/api/backgrounds', require('./routes/backgrounds'));
app.use('/api/optional-features', require('./routes/optional-features'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/dm-tools', require('./routes/dm-tools'));
app.use('/api/characters', require('./routes/characters'));

// Seed status endpoint (cached for 60s)
let statusCache = null;
let statusCacheTime = 0;
const STATUS_CACHE_TTL = 60000;

app.get('/api/status', (req, res) => {
  const now = Date.now();
  if (statusCache && (now - statusCacheTime) < STATUS_CACHE_TTL) {
    return res.json(statusCache);
  }
  const meta = db.prepare('SELECT key, value, updated_at FROM seed_meta').all();
  const counts = {
    classes:     db.prepare('SELECT COUNT(*) as n FROM classes').get().n,
    subclasses:  db.prepare('SELECT COUNT(*) as n FROM subclasses').get().n,
    races:       db.prepare('SELECT COUNT(*) as n FROM races').get().n,
    spells:      db.prepare('SELECT COUNT(*) as n FROM spells').get().n,
    feats:       db.prepare('SELECT COUNT(*) as n FROM feats').get().n,
    backgrounds: db.prepare('SELECT COUNT(*) as n FROM backgrounds').get().n,
    optional_features: db.prepare('SELECT COUNT(*) as n FROM optional_features').get().n,
    characters:  db.prepare('SELECT COUNT(*) as n FROM characters').get().n,
  };
  const seeded = meta.find(m => m.key === 'seeded_at');
  statusCache = { seeded: !!seeded, seed_meta: Object.fromEntries(meta.map(m => [m.key, m.value])), counts };
  statusCacheTime = now;
  res.json(statusCache);
});

// SPA fallback — send index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Auto-seed check on startup
/**
 * Checks if database is seeded and seeds if necessary. Also seeds effect definitions.
 * Called on server startup.
 * @async
 * @returns {Promise<void>}
 */
async function checkAndSeed() {
  cleanupExpiredSessions();
  const seeded = db.prepare("SELECT value FROM seed_meta WHERE key = 'seeded_at'").get();
  if (!seeded) {
    console.log('Database not seeded. Running seed script...');
    try {
      const { main: seedMain } = require('./seed');
      if (typeof seedMain === 'function') await seedMain();
    } catch (err) {
      console.error('Auto-seed failed:', err.message);
    }
  } else {
    const counts = db.prepare('SELECT COUNT(*) as n FROM classes').get().n;
    console.log(`Database already seeded (${counts} classes). Skipping seed.`);
  }

  const effectCount = db.prepare('SELECT COUNT(*) as n FROM effect_definitions').get().n;
  if (effectCount === 0) {
    console.log('Effect definitions missing. Seeding effect definitions...');
    try {
      await seedEffectDefinitions({ allSources: true });
    } catch (err) {
      console.error('Effect definition seed failed:', err.message);
    }
  }
}

app.listen(PORT, async () => {
  console.log(`DND Tracker running at http://localhost:${PORT}`);
  await checkAndSeed();
});
