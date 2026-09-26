'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/weapons — weapon reference data (category, damage, properties)
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, source, category, damage_dice, damage_type, properties_json, data_json
    FROM weapons ORDER BY name
  `).all();
  res.json(rows.map(r => {
    const data = JSON.parse(r.data_json || '{}');
    return {
      id: r.id,
      name: r.name,
      source: r.source,
      category: r.category,
      damage_dice: r.damage_dice,
      damage_type: r.damage_type,
      properties: JSON.parse(r.properties_json || '[]'),
      ranged: data.type === 'R',
      range: data.range || null,
      versatile_dice: data.dmg2 || null,
      weight: data.weight ?? null,
      value_gp: data.value != null ? data.value / 100 : null,
    };
  }));
});

module.exports = router;
