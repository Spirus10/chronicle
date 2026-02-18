'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/feats?search=alert
router.get('/', (req, res) => {
  const conditions = [];
  const params = [];

  if (req.query.search) {
    conditions.push(`name LIKE ?`);
    params.push(`%${req.query.search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, name, source, prerequisites_json, ability_json
    FROM feats ${where} ORDER BY name
  `).all(...params);

  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    source: r.source,
    prerequisites: JSON.parse(r.prerequisites_json || '[]'),
    ability: JSON.parse(r.ability_json || '[]'),
  })));
});

// GET /api/feats/:id
router.get('/:id', (req, res) => {
  const feat = db.prepare(`
    SELECT id, name, source, prerequisites_json, ability_json, data_json
    FROM feats WHERE id = ?
  `).get(req.params.id);
  if (!feat) return res.status(404).json({ error: 'Feat not found' });

  res.json({
    id: feat.id,
    name: feat.name,
    source: feat.source,
    prerequisites: JSON.parse(feat.prerequisites_json || '[]'),
    ability: JSON.parse(feat.ability_json || '[]'),
    data: JSON.parse(feat.data_json),
  });
});

module.exports = router;
