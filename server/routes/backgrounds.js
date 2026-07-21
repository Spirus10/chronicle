/**
 * @fileoverview Background API routes.
 * Provides read-only access to background data.
 */
'use strict';
const express = require('express');
const db = require('../db');
const { parseJSON } = require('../utils/json-parser');
const router = express.Router();

// GET /api/backgrounds
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, source, skill_proficiencies, tool_proficiencies, language_proficiencies
    FROM backgrounds ORDER BY name
  `).all();

  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    source: r.source,
    skill_proficiencies: parseJSON(r.skill_proficiencies, []),
    tool_proficiencies: parseJSON(r.tool_proficiencies, []),
    language_proficiencies: parseJSON(r.language_proficiencies, []),
  })));
});

// GET /api/backgrounds/:id
router.get('/:id', (req, res) => {
  const bg = db.prepare(`
    SELECT id, name, source, skill_proficiencies, tool_proficiencies, language_proficiencies, data_json
    FROM backgrounds WHERE id = ?
  `).get(req.params.id);
  if (!bg) return res.status(404).json({ error: 'Background not found' });

  res.json({
    id: bg.id,
    name: bg.name,
    source: bg.source,
    skill_proficiencies: parseJSON(bg.skill_proficiencies, []),
    tool_proficiencies: parseJSON(bg.tool_proficiencies, []),
    language_proficiencies: parseJSON(bg.language_proficiencies, []),
    data: parseJSON(bg.data_json),
  });
});

module.exports = router;
