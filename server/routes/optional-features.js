'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

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
  const level = parseInt(req.query.level, 10) || null;

  const rows = db.prepare(`
    SELECT id, name, source, feature_types_json, prerequisites_json, data_json
    FROM optional_features
    ORDER BY name
  `).all();

  const out = rows.filter(r => {
    const types = JSON.parse(r.feature_types_json || '[]');
    if (type && !types.includes(type)) return false;

    const prereqs = JSON.parse(r.prerequisites_json || '[]');
    const meta = extractClassAndLevel(prereqs);

    if (className && meta.classNames.length && !meta.classNames.includes(className)) return false;
    if (level && meta.minLevel && level < meta.minLevel) return false;

    return true;
  }).map(r => {
    const data = JSON.parse(r.data_json || '{}');
    return {
      id: r.id,
      name: r.name,
      source: r.source,
      feature_types: JSON.parse(r.feature_types_json || '[]'),
      prerequisites: JSON.parse(r.prerequisites_json || '[]'),
      entries: data.entries || [],
      data,
    };
  });

  res.json(out);
});

module.exports = router;
