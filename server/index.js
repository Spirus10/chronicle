'use strict';
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/classes', require('./routes/classes'));
app.use('/api/races', require('./routes/races'));
app.use('/api/spells', require('./routes/spells'));
app.use('/api/feats', require('./routes/feats'));
app.use('/api/backgrounds', require('./routes/backgrounds'));
app.use('/api/optional-features', require('./routes/optional-features'));
app.use('/api/characters', require('./routes/characters'));

// Seed status endpoint
app.get('/api/status', (req, res) => {
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
  res.json({ seeded: !!seeded, seed_meta: Object.fromEntries(meta.map(m => [m.key, m.value])), counts });
});

// SPA fallback — send index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Auto-seed check on startup
async function checkAndSeed() {
  const seeded = db.prepare("SELECT value FROM seed_meta WHERE key = 'seeded_at'").get();
  if (!seeded) {
    console.log('Database not seeded. Running seed script...');
    try {
      // Run seed in-process
      require('./seed');
      // seed.js calls main() which is async; we just let it run
    } catch (err) {
      console.error('Auto-seed failed:', err.message);
    }
  } else {
    const counts = db.prepare('SELECT COUNT(*) as n FROM classes').get().n;
    console.log(`Database already seeded (${counts} classes). Skipping seed.`);
  }
}

app.listen(PORT, async () => {
  console.log(`DND Tracker running at http://localhost:${PORT}`);
  await checkAndSeed();
});
