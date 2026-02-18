'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

function normalizeSpellToken(token) {
  if (typeof token !== 'string') return null;
  const raw = token.trim();
  if (!raw) return null;
  if (raw.includes('{@') || raw.includes('=')) return null;
  const base = raw.split('|')[0].split('#')[0].trim().toLowerCase();
  if (!base) return null;
  return base;
}

function collectSpellNames(value, out) {
  if (Array.isArray(value)) {
    value.forEach(v => collectSpellNames(v, out));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(v => collectSpellNames(v, out));
    return;
  }
  const token = normalizeSpellToken(value);
  if (token) out.add(token);
}

function getSubclassExpandedSpellNames(subclassId) {
  const row = db.prepare('SELECT data_json FROM subclasses WHERE id = ?').get(subclassId);
  if (!row) return [];
  const data = JSON.parse(row.data_json || '{}');
  const names = new Set();
  collectSpellNames(data.additionalSpells || [], names);
  return [...names];
}

// GET /api/spells?class=warlock&level=0-5&search=fire&concentration=true&ritual=true
router.get('/', (req, res) => {
  const conditions = [];
  const params = [];

  const classQuery = req.query.class ? String(req.query.class).toLowerCase() : null;
  const subclassId = req.query.subclass_id ? parseInt(req.query.subclass_id, 10) : null;
  const subclassExpanded = subclassId ? getSubclassExpandedSpellNames(subclassId) : [];

  if (classQuery && subclassExpanded.length) {
    const placeholders = subclassExpanded.map(() => '?').join(', ');
    conditions.push(`(class_list LIKE ? OR lower(name) IN (${placeholders}))`);
    params.push(`%"${classQuery}"%`, ...subclassExpanded);
  } else if (classQuery) {
    conditions.push(`class_list LIKE ?`);
    params.push(`%"${classQuery}"%`);
  } else if (subclassExpanded.length) {
    const placeholders = subclassExpanded.map(() => '?').join(', ');
    conditions.push(`lower(name) IN (${placeholders})`);
    params.push(...subclassExpanded);
  }

  // level can be a single number, or a range like "0-5"
  if (req.query.level !== undefined) {
    const levelStr = req.query.level;
    if (levelStr.includes('-')) {
      const [min, max] = levelStr.split('-').map(Number);
      conditions.push(`level >= ? AND level <= ?`);
      params.push(min, max);
    } else {
      conditions.push(`level = ?`);
      params.push(parseInt(levelStr));
    }
  }

  if (req.query.search) {
    conditions.push(`name LIKE ?`);
    params.push(`%${req.query.search}%`);
  }

  if (req.query.concentration === 'true') {
    conditions.push(`concentration = 1`);
  }

  if (req.query.ritual === 'true') {
    conditions.push(`ritual = 1`);
  }

  if (req.query.school) {
    conditions.push(`school = ?`);
    params.push(req.query.school.toUpperCase());
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, name, source, level, school, casting_time, range_text, components_json,
           duration_text, concentration, ritual, damage_types, saving_throws, class_list
    FROM spells ${where} ORDER BY level, name
    LIMIT 500
  `).all(...params);

  res.json(rows.map(r => ({
    ...r,
    components: JSON.parse(r.components_json || '{}'),
    damage_types: JSON.parse(r.damage_types || '[]'),
    saving_throws: JSON.parse(r.saving_throws || '[]'),
    class_list: JSON.parse(r.class_list || '[]'),
    components_json: undefined,
  })));
});

// GET /api/spells/:id — full spell detail
router.get('/:id', (req, res) => {
  const spell = db.prepare(`
    SELECT id, name, source, level, school, casting_time, range_text, components_json,
           duration_text, concentration, ritual, damage_types, saving_throws, class_list, data_json
    FROM spells WHERE id = ?
  `).get(req.params.id);
  if (!spell) return res.status(404).json({ error: 'Spell not found' });

  res.json({
    id: spell.id,
    name: spell.name,
    source: spell.source,
    level: spell.level,
    school: spell.school,
    casting_time: spell.casting_time,
    range_text: spell.range_text,
    duration_text: spell.duration_text,
    concentration: !!spell.concentration,
    ritual: !!spell.ritual,
    components: JSON.parse(spell.components_json || '{}'),
    damage_types: JSON.parse(spell.damage_types || '[]'),
    saving_throws: JSON.parse(spell.saving_throws || '[]'),
    class_list: JSON.parse(spell.class_list || '[]'),
    data: JSON.parse(spell.data_json),
  });
});

module.exports = router;
