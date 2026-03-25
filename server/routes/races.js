/**
 * @fileoverview Race API routes.
 * Provides read-only access to race and subrace data.
 */
'use strict';
const express = require('express');
const db = require('../db');
const { parseJSON } = require('../utils/json-parser');
const router = express.Router();

// GET /api/races — list all (base races + subraces)
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, source, parent_race_id, speed_json, ability_json, darkvision, trait_tags
    FROM races ORDER BY name, source
  `).all();
  res.json(rows.map(r => ({
    ...r,
    speed: parseJSON(r.speed_json),
    ability: parseJSON(r.ability_json, []),
    trait_tags: parseJSON(r.trait_tags, []),
    speed_json: undefined,
    ability_json: undefined,
  })));
});

// GET /api/races/:id — race detail with full data
router.get('/:id', (req, res) => {
  const race = db.prepare(`
    SELECT id, name, source, parent_race_id, speed_json, ability_json, darkvision, trait_tags, data_json
    FROM races WHERE id = ?
  `).get(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race not found' });

  // Include subraces if this is a base race
  const subraces = race.parent_race_id === null
    ? db.prepare('SELECT id, name, source FROM races WHERE parent_race_id = ? ORDER BY name').all(race.id)
    : [];

  res.json({
    id: race.id,
    name: race.name,
    source: race.source,
    parent_race_id: race.parent_race_id,
    darkvision: race.darkvision,
    speed: parseJSON(race.speed_json),
    ability: parseJSON(race.ability_json, []),
    trait_tags: parseJSON(race.trait_tags, []),
    data: parseJSON(race.data_json),
    subraces,
  });
});

module.exports = router;
