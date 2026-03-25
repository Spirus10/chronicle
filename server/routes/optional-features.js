/**
 * @fileoverview Optional feature API routes.
 * Provides filterable access to optional features (e.g., Eldritch Invocations, Fighting Styles).
 */
'use strict';
const express = require('express');
const db = require('../db');
const { parseJSON } = require('../utils/json-parser');
const { MAX_LEVEL, MIN_LEVEL } = require('../constants/game-rules');
const router = express.Router();

/**
 * Extracts minimum level and class name requirements from prerequisite data.
 * @param {Object[]} [prereqs] - Array of prerequisite objects
 * @returns {{minLevel: number|null, classNames: string[]}} Extracted level and class requirements
 */
function extractClassAndLevel(prereqs) {
  let minLevel = null;
  let classNames = [];
  for (const p of (prereqs || [])) {
    if (p?.level?.level) {
      const lvl = parseInt(p.level.level, 10);
      if (Number.isInteger(lvl)) minLevel = minLevel === null ? lvl : Math.max(minLevel, lvl);
    }
    if (p?.level?.class?.name) classNames.push(String(p.level.class.name).toLowerCase());
  }
  return { minLevel, classNames: [...new Set(classNames)] };
}

// GET /api/optional-features?featureType=EI&class=warlock&level=5
router.get('/', (req, res) => {
  const type = String(req.query.featureType || '').trim();
  const className = String(req.query.class || '').toLowerCase().trim();
  const parsedLevel = parseInt(req.query.level, 10);
  const level = (!isNaN(parsedLevel) && parsedLevel >= MIN_LEVEL && parsedLevel <= MAX_LEVEL)
    ? parsedLevel : null;

  const rows = db.prepare(`
    SELECT id, name, source, feature_types_json, prerequisites_json, data_json
    FROM optional_features
    ORDER BY name
  `).all();

  const out = rows.filter(r => {
    const types = parseJSON(r.feature_types_json, []);
    if (type && !types.includes(type)) return false;

    const prereqs = parseJSON(r.prerequisites_json, []);
    const meta = extractClassAndLevel(prereqs);

    if (className && meta.classNames.length && !meta.classNames.includes(className)) return false;
    if (level && meta.minLevel && level < meta.minLevel) return false;

    return true;
  }).map(r => {
    const data = parseJSON(r.data_json);
    return {
      id: r.id,
      name: r.name,
      source: r.source,
      feature_types: parseJSON(r.feature_types_json, []),
      prerequisites: parseJSON(r.prerequisites_json, []),
      entries: data.entries || [],
      data,
    };
  });

  res.json(out);
});

module.exports = router;
