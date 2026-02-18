'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/classes — list all classes
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, source, hit_die, spellcasting_ability, caster_progression, save_proficiencies
    FROM classes ORDER BY name
  `).all();
  res.json(rows.map(r => ({
    ...r,
    save_proficiencies: JSON.parse(r.save_proficiencies || '[]'),
  })));
});

// GET /api/classes/:id — class detail + subclasses
router.get('/:id', (req, res) => {
  const cls = db.prepare(`
    SELECT id, name, source, hit_die, spellcasting_ability, caster_progression, save_proficiencies, data_json
    FROM classes WHERE id = ?
  `).get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const subclasses = db.prepare(`
    SELECT id, name, short_name, source FROM subclasses WHERE class_id = ? ORDER BY name
  `).all(cls.id);

  res.json({
    ...cls,
    save_proficiencies: JSON.parse(cls.save_proficiencies || '[]'),
    data_json: undefined,
    data: JSON.parse(cls.data_json),
    subclasses,
  });
});

// GET /api/classes/:id/progression — full level 1-20 table
router.get('/:id/progression', (req, res) => {
  const rows = db.prepare(`
    SELECT level, proficiency_bonus, spell_slots_json, cantrips_known, spells_known, class_specific_json
    FROM class_progression WHERE class_id = ? ORDER BY level
  `).all(req.params.id);

  res.json(rows.map(r => ({
    level: r.level,
    proficiency_bonus: r.proficiency_bonus,
    spell_slots: r.spell_slots_json ? JSON.parse(r.spell_slots_json) : null,
    cantrips_known: r.cantrips_known,
    spells_known: r.spells_known,
    class_specific: r.class_specific_json ? JSON.parse(r.class_specific_json) : null,
  })));
});

// GET /api/classes/:id/features?level=5 — base class features up to level N
router.get('/:id/features', (req, res) => {
  const maxLevel = parseInt(req.query.level) || 20;
  const rows = db.prepare(`
    SELECT id, level, name, entries_json, header
    FROM class_features
    WHERE class_id = ? AND is_subclass_feature = 0 AND level <= ?
    ORDER BY level, id
  `).all(req.params.id, maxLevel);

  res.json(rows.map(r => ({
    id: r.id,
    level: r.level,
    name: r.name,
    header: r.header,
    entries: JSON.parse(r.entries_json),
  })));
});

// GET /api/classes/:classId/subclasses/:id — subclass detail
router.get('/:classId/subclasses/:subId', (req, res) => {
  const sub = db.prepare(`
    SELECT id, class_id, name, short_name, source, data_json
    FROM subclasses WHERE id = ? AND class_id = ?
  `).get(req.params.subId, req.params.classId);
  if (!sub) return res.status(404).json({ error: 'Subclass not found' });

  res.json({
    ...sub,
    data_json: undefined,
    data: JSON.parse(sub.data_json),
  });
});

// GET /api/classes/:classId/subclasses/:subId/features?level=5
router.get('/:classId/subclasses/:subId/features', (req, res) => {
  const maxLevel = parseInt(req.query.level) || 20;
  const rows = db.prepare(`
    SELECT id, level, name, entries_json, header
    FROM class_features
    WHERE subclass_id = ? AND is_subclass_feature = 1 AND level <= ?
    ORDER BY level, id
  `).all(req.params.subId, maxLevel);

  res.json(rows.map(r => ({
    id: r.id,
    level: r.level,
    name: r.name,
    header: r.header,
    entries: JSON.parse(r.entries_json),
  })));
});

module.exports = router;
