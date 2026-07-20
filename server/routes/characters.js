/**
 * @fileoverview Character API routes.
 * Handles CRUD operations for player characters, state, effects, inventory, and currency.
 */
'use strict';
const express = require('express');
const db = require('../db');
const { collectModifiers } = require('../effects/engine');
const { requireAuth } = require('../auth');
const router = express.Router();

router.use(requireAuth);

// ── Helpers ────────────────────────────────────────────────────

/**
 * Parses character database record and deserializes JSON fields.
 * @param {Object} [row] - Character record from database
 * @returns {Object|null} Parsed character object or null if row is falsy
 */
function parseChar(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    owner_user_id: row.owner_user_id,
    campaign_id: row.campaign_id,
    class_id: row.class_id,
    subclass_id: row.subclass_id,
    race_id: row.race_id,
    background_id: row.background_id,
    level: row.level,
    experience_points: row.experience_points,
    alignment: row.alignment,
    ability_scores: JSON.parse(row.ability_scores_json || '{}'),
    stat_overrides: JSON.parse(row.stat_overrides_json || '{}'),
    skill_proficiencies: JSON.parse(row.skill_proficiencies_json || '{}'),
    spellcasting_type: row.spellcasting_type,
    spellbook: JSON.parse(row.spellbook_json || '[]'),
    spells_known: JSON.parse(row.spells_known_json || '[]'),
    feats: JSON.parse(row.feats_json || '[]'),
    backstory: row.backstory,
    personality_traits: row.personality_traits,
    ideals: row.ideals,
    bonds: row.bonds,
    flaws: row.flaws,
    appearance: row.appearance,
    portrait_url: row.portrait_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Checks if a user owns a character.
 * @param {number} userId - The user ID to check
 * @param {number} characterId - The character ID to verify ownership of
 * @returns {Object|undefined} Character record if owned, undefined if not found
 */
function getOwnedCharacterId(userId, characterId) {
  return db.prepare('SELECT id FROM characters WHERE id = ? AND owner_user_id = ?').get(characterId, userId);
}

/**
 * Middleware helper to verify character ownership and return error if not owned.
 * @param {Object} req - Express request (must have user and params.id)
 * @param {Object} res - Express response (used to send 404 error)
 * @returns {Object|null} Character ID object if owned, null if not found (error already sent)
 */
function requireOwnedCharacter(req, res) {
  const row = getOwnedCharacterId(req.user.id, req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Character not found' });
    return null;
  }
  return row;
}

/**
 * Parses character state database record and deserializes JSON fields.
 * @param {Object} [row] - Character state record from database
 * @returns {Object|null} Parsed character state or null if row is falsy
 */
function parseState(row) {
  if (!row) return null;
  return {
    character_id: row.character_id,
    hp_current: row.hp_current,
    hp_temp: row.hp_temp,
    hp_temp_source: row.hp_temp_source,
    spell_slots_used: JSON.parse(row.spell_slots_used_json || '{}'),
    hit_dice_used: JSON.parse(row.hit_dice_used_json || '[]'),
    prepared_spells: JSON.parse(row.prepared_spells_json || '[]'),
    concentration: row.concentration,
    active_effects: JSON.parse(row.active_effects_json || '[]'),
    conditions: JSON.parse(row.conditions_json || '{}'),
    class_resources: JSON.parse(row.class_resources_json || '{}'),
    combat_active: !!row.combat_active,
    combat_round: row.combat_round,
    death_saves: JSON.parse(row.death_saves_json || '{"successes":0,"failures":0}'),
    log: JSON.parse(row.log_json || '[]'),
    updated_at: row.updated_at,
  };
}

/**
 * Parses effect definition record and deserializes JSON effect data.
 * @param {Object} [row] - Effect definition record from database
 * @returns {Object|null} Parsed effect object or null if row is falsy
 */
function parseEffectRow(row) {
  if (!row) return null;
  const effect = JSON.parse(row.effect_json || '{}');
  return {
    id: row.id,
    name: row.name,
    source_type: row.source_type,
    source_id: row.source_id,
    scope: row.scope,
    kind: row.kind,
    priority: row.priority,
    duration_type: row.duration_type,
    tags: JSON.parse(row.tags_json || '[]'),
    effect,
  };
}

/**
 * Fetches effect definitions by source type and IDs.
 * @param {string} sourceType - Type of effect source (e.g., 'spell', 'class_feature', 'race')
 * @param {number[]} sourceIds - Array of source IDs to fetch
 * @returns {Object[]} Array of parsed effect objects, duplicates removed
 */
function fetchEffectDefinitions(sourceType, sourceIds) {
  const ids = [...new Set((sourceIds || []).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, name, source_type, source_id, scope, kind, priority, duration_type, tags_json, effect_json
    FROM effect_definitions
    WHERE source_type = ? AND source_id IN (${placeholders})
  `).all(sourceType, ...ids);
  return rows.map(parseEffectRow).filter(Boolean);
}

/**
 * Fetches effect definitions by source type and effect names.
 * @param {string} sourceType - Type of effect source
 * @param {string[]} names - Array of effect names to fetch
 * @returns {Object[]} Array of parsed effect objects, duplicates removed
 */
function fetchEffectDefinitionsByName(sourceType, names) {
  const list = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))];
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, name, source_type, source_id, scope, kind, priority, duration_type, tags_json, effect_json
    FROM effect_definitions
    WHERE source_type = ? AND name IN (${placeholders})
  `).all(sourceType, ...list);
  return rows.map(parseEffectRow).filter(Boolean);
}

/**
 * Loads all applicable effect definitions for a character based on class, race, spells, etc.
 * @param {Object} [char] - Parsed character object
 * @returns {Object[]} Array of effect definitions applicable to the character
 */
function loadCharacterEffectDefinitions(char) {
  if (!char) return [];
  const effects = [];

  if (char.class_id) {
    const classFeatureIds = db.prepare(`
      SELECT id FROM class_features
      WHERE class_id = ? AND level <= ? AND is_subclass_feature = 0
    `).all(char.class_id, char.level).map(r => r.id);
    effects.push(...fetchEffectDefinitions('class_feature', classFeatureIds));
  }

  if (char.subclass_id) {
    const subclassFeatureIds = db.prepare(`
      SELECT id FROM class_features
      WHERE subclass_id = ? AND level <= ? AND is_subclass_feature = 1
    `).all(char.subclass_id, char.level).map(r => r.id);
    effects.push(...fetchEffectDefinitions('class_feature', subclassFeatureIds));
  }

  if (char.race_id) {
    effects.push(...fetchEffectDefinitions('race', [char.race_id]));
  }

  const featIds = Array.isArray(char.feats) ? char.feats.map(id => parseInt(id, 10)) : [];
  effects.push(...fetchEffectDefinitions('feat', featIds));

  const spellIds = new Set();
  if (Array.isArray(char.spells_known)) {
    char.spells_known.forEach(id => spellIds.add(parseInt(id, 10)));
  }
  if (Array.isArray(char.spellbook)) {
    char.spellbook.forEach(id => spellIds.add(parseInt(id, 10)));
  }
  effects.push(...fetchEffectDefinitions('spell', [...spellIds]));

  const weaponNames = db.prepare(`
    SELECT name FROM inventory WHERE character_id = ? AND item_type = 'weapon'
  `).all(char.id).map(r => r.name);
  effects.push(...fetchEffectDefinitionsByName('weapon', weaponNames));

  return effects;
}

/**
 * Determines if an effect should be included in results based on filter criteria.
 * Handles toggle-required effects and action-type filtering.
 * @param {Object} [effect] - Effect definition object
 * @param {Object} [filter] - Filter criteria (e.g., {action_type: 'spell'})
 * @param {Object[]} [activeEffects] - List of active effects to check toggles
 * @returns {boolean} True if effect should be included
 */
function shouldIncludeEffect(effect, filter, activeEffects) {
  if (!filter || !effect) return true;
  if (effect.tags && Array.isArray(effect.tags) && effect.tags.includes('requires_toggle')) {
    const activeNames = (activeEffects || []).map(e => String(e?.name || '').toLowerCase());
    if (!activeNames.includes(String(effect.name || '').toLowerCase())) return false;
  }
  if (filter.action_type === 'spell') {
    const sourceType = effect.source?.type;
    if (sourceType === 'spell') return true;
    const conditions = Array.isArray(effect.conditions) ? effect.conditions : [];
    const actionConditionTypes = new Set(['action_name_is', 'spell_name_is', 'action_has_tag']);
    return conditions.some(c => actionConditionTypes.has(c?.type));
  }
  if (filter.action_type === 'weapon') {
    if (effect.source?.type === 'weapon') return false;
  }
  return true;
}

/**
 * Enriches character object with denormalized foreign key data (class names, etc).
 * Attaches human-readable names and related data from lookup tables.
 * @param {Object} [char] - Parsed character object
 * @returns {Object|null} Enriched character object or null if input is falsy
 */
function enrichCharacter(char) {
  if (!char) return null;
  // Attach class/subclass/race/background names for convenience
  if (char.class_id) {
    const cls = db.prepare('SELECT name, hit_die, spellcasting_ability, caster_progression, save_proficiencies FROM classes WHERE id = ?').get(char.class_id);
    if (cls) {
      char.class_name = cls.name;
      char.hit_die = cls.hit_die;
      char.spellcasting_ability = cls.spellcasting_ability;
      char.caster_progression = cls.caster_progression;
      char.class_save_proficiencies = JSON.parse(cls.save_proficiencies || '[]');
    }
  }
  if (char.subclass_id) {
    const sub = db.prepare('SELECT name, short_name, source FROM subclasses WHERE id = ?').get(char.subclass_id);
    if (sub) char.subclass_name = sub.name;
  }
  // Eldritch Knight / Arcane Trickster are third casters even though their
  // base class (Fighter / Rogue) has no spellcasting progression of its own.
  if (!char.caster_progression && char.subclass_name) {
    const subLower = char.subclass_name.toLowerCase();
    if (subLower.includes('eldritch knight') || subLower.includes('arcane trickster')) {
      char.caster_progression = '1/3';
      if (!char.spellcasting_ability) char.spellcasting_ability = 'int';
    }
  }
  if (char.race_id) {
    const race = db.prepare('SELECT name, speed_json, ability_json, darkvision FROM races WHERE id = ?').get(char.race_id);
    if (race) {
      char.race_name = race.name;
      char.race_speed = JSON.parse(race.speed_json || '{}');
      char.race_ability = JSON.parse(race.ability_json || '[]');
      char.race_darkvision = race.darkvision;
    }
  }
  if (char.background_id) {
    const bg = db.prepare('SELECT name FROM backgrounds WHERE id = ?').get(char.background_id);
    if (bg) char.background_name = bg.name;
  }
  return char;
}

/**
 * Finds the highest spell slot level available in a spell slots array.
 * @param {number[]} [spellSlots] - Array of spell slot counts by level (index 0-8)
 * @returns {number} Highest level with available slots (1-9), or 0 if none available
 */
function highestSlotLevel(spellSlots) {
  if (!Array.isArray(spellSlots)) return 0;
  for (let i = spellSlots.length - 1; i >= 0; i--) {
    if ((spellSlots[i] || 0) > 0) return i + 1;
  }
  return 0;
}

/**
 * Gets maximum spell level a character can prepare/know based on caster progression and slots.
 * @param {string} casterProgression - Caster progression type (reserved for future use)
 * @param {number[]} spellSlots - Array of available spell slots by level
 * @returns {number} Maximum selectable spell level (0-9)
 */
function getMaxSelectableSpellLevel(casterProgression, spellSlots) {
  const maxFromSlots = highestSlotLevel(spellSlots);
  if (!maxFromSlots) return 0;
  return maxFromSlots;
}

/**
 * Extracts item name from equipment token (handles string, object, and pipe-delimited formats).
 * @param {string|Object} [token] - Equipment token to parse
 * @returns {string|null} Parsed item name or null if unparseable
 */
function parseItemName(token) {
  if (!token) return null;
  if (typeof token === 'string') {
    return token.split('|')[0].trim();
  }
  if (typeof token === 'object') {
    if (token.displayName) return String(token.displayName).trim();
    if (token.item) return String(token.item).split('|')[0].trim();
  }
  return null;
}

/**
 * Extracts starting equipment and copper pieces from background data.
 * @param {Object} [backgroundRow] - Background record with data_json field
 * @returns {{items: string[], cp: number}} Object with items array and cp count
 */
function backgroundStartingPicks(backgroundRow) {
  if (!backgroundRow) return { items: [], cp: 0 };
  const data = JSON.parse(backgroundRow.data_json || '{}');
  const groups = Array.isArray(data.startingEquipment) ? data.startingEquipment : [];
  if (!groups.length) return { items: [], cp: 0 };

  const first = groups[0] || {};
  const list = Array.isArray(first._) ? first._ : [];
  const items = [];
  let cp = 0;

  for (const entry of list) {
    if (typeof entry === 'object' && entry && entry.value) {
      cp += parseInt(entry.value, 10) || 0;
      continue;
    }
    const name = parseItemName(entry);
    if (!name) continue;
    items.push(name);
  }

  return { items, cp };
}

/**
 * Validates spell selection against class progression limits.
 * Checks cantrip count, leveled spell count, and maximum spell level.
 * @param {number} [classId] - Character's class ID
 * @param {number} [level] - Character's current level
 * @param {number[]} [spellsKnown] - Array of selected spell IDs
 * @returns {string|null} Error message if invalid, null if valid
 */
function validateSpellSelection(classId, level, spellsKnown = []) {
  if (!classId || !Array.isArray(spellsKnown) || spellsKnown.length === 0) return null;

  const cls = db.prepare('SELECT caster_progression FROM classes WHERE id = ?').get(classId);
  if (!cls?.caster_progression) return null;

  const progRow = db.prepare('SELECT spell_slots_json, cantrips_known, spells_known FROM class_progression WHERE class_id = ? AND level = ?').get(classId, level);
  if (!progRow) return null;

  const spellSlots = JSON.parse(progRow.spell_slots_json || '[]');
  const spellIds = [...new Set(
    spellsKnown
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n) && n > 0)
  )];
  if (!spellIds.length) return null;

  const placeholders = spellIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, level FROM spells WHERE id IN (${placeholders})`).all(...spellIds);
  const levelById = new Map(rows.map(r => [r.id, r.level]));

  let cantripCount = 0;
  let leveledCount = 0;
  for (const id of spellIds) {
    const spLevel = levelById.get(id);
    if (spLevel === undefined) continue;
    if (spLevel === 0) cantripCount++;
    else leveledCount++;
  }

  const cantripMax = progRow.cantrips_known ?? 0;
  const knownMax = progRow.spells_known;
  const maxSpellLevel = getMaxSelectableSpellLevel(cls.caster_progression, spellSlots);

  if (cantripCount > cantripMax) {
    return `Too many cantrips selected (${cantripCount}/${cantripMax}).`;
  }
  if (knownMax !== null && knownMax !== undefined && leveledCount > knownMax) {
    return `Too many spells selected (${leveledCount}/${knownMax}).`;
  }
  for (const id of spellIds) {
    const spLevel = levelById.get(id);
    if (spLevel && spLevel > maxSpellLevel) {
      return `Selected spell level exceeds allowed maximum (${maxSpellLevel}).`;
    }
  }

  return null;
}

// ── GET /api/characters ────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.level, c.alignment, c.portrait_url, c.campaign_id,
           c.class_id, c.subclass_id, c.race_id, c.background_id,
           c.experience_points, c.created_at, c.updated_at,
           c.stat_overrides_json,
           cl.name as class_name, cl.hit_die, cl.spellcasting_ability,
           cl.caster_progression, cl.save_proficiencies as save_proficiencies_json,
           sc.name as subclass_name,
           r.name as race_name, r.speed_json, r.ability_json, r.darkvision,
           bg.name as background_name,
           cs.hp_current, cs.hp_temp
    FROM characters c
    LEFT JOIN classes cl ON c.class_id = cl.id
    LEFT JOIN subclasses sc ON c.subclass_id = sc.id
    LEFT JOIN races r ON c.race_id = r.id
    LEFT JOIN backgrounds bg ON c.background_id = bg.id
    LEFT JOIN character_state cs ON c.id = cs.character_id
    WHERE c.owner_user_id = ?
    ORDER BY c.updated_at DESC
  `).all(req.user.id);
  const parsed = rows.map(r => {
    const overrides = JSON.parse(r.stat_overrides_json || '{}');
    const { stat_overrides_json, save_proficiencies_json, speed_json, ability_json, ...rest } = r;
    return {
      ...rest,
      hp_max: overrides.hp_max || null,
      class_save_proficiencies: JSON.parse(save_proficiencies_json || '[]'),
      race_speed: JSON.parse(speed_json || '{}'),
      race_ability: JSON.parse(ability_json || '[]'),
      race_darkvision: r.darkvision,
    };
  });
  res.json(parsed);
});

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function validateLevel(level) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > 20) return null;
  return lvl;
}

function validateAbilityScores(scores) {
  if (!scores || typeof scores !== 'object') return 'ability_scores must be an object';
  for (const key of ABILITY_KEYS) {
    const v = Number(scores[key]);
    if (!Number.isInteger(v) || v < 1 || v > 30) {
      return `ability_scores.${key} must be an integer between 1 and 30`;
    }
  }
  return null;
}

// ── POST /api/characters ───────────────────────────────────────
router.post('/', (req, res) => {
  const {
    name, class_id, subclass_id, race_id, background_id,
    experience_points = 0, alignment,
    ability_scores = {str:10,dex:10,con:10,int:10,wis:10,cha:10},
    stat_overrides = {}, skill_proficiencies = {},
    spellcasting_type, spellbook = [], spells_known = [], feats = [],
    backstory = '', personality_traits = '', ideals = '', bonds = '',
    flaws = '', appearance = '', portrait_url,
    hp_max,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  const level = validateLevel(req.body.level ?? 1);
  if (level === null) return res.status(400).json({ error: 'level must be an integer between 1 and 20' });

  const abilityError = validateAbilityScores(ability_scores);
  if (abilityError) return res.status(400).json({ error: abilityError });

  // Determine spellcasting type from class if not provided
  let spellType = spellcasting_type;
  if (!spellType && class_id) {
    const cls = db.prepare('SELECT caster_progression, name FROM classes WHERE id = ?').get(class_id);
    if (cls) {
      if (cls.caster_progression === 'pact') spellType = 'pact';
      else if (cls.caster_progression === 'full') {
        // Prepared casters: wizard, cleric, druid, paladin
        const prepared = ['wizard','cleric','druid','paladin'];
        spellType = prepared.includes(cls.name.toLowerCase()) ? 'prepared' : 'known';
      } else if (cls.caster_progression) {
        spellType = 'prepared';
      }
    }
  }

  // Calculate starting HP from class hit die + CON mod
  let startHp = Number.isFinite(Number(hp_max)) && Number(hp_max) >= 1 ? Math.floor(Number(hp_max)) : null;
  if (!startHp && class_id) {
    const cls = db.prepare('SELECT hit_die FROM classes WHERE id = ?').get(class_id);
    if (cls) {
      const conMod = Math.floor((ability_scores.con - 10) / 2);
      // PHB: each level past 1st grants a minimum of 1 hit point even with a
      // negative CON modifier.
      const perLevel = Math.max(1, Math.floor(cls.hit_die / 2) + 1 + conMod);
      startHp = Math.max(1, cls.hit_die + conMod) + ((level - 1) * perLevel);
    }
  }

  // Store hp_max in stat_overrides so the sheet can reference it
  if (startHp) {
    stat_overrides.hp_max = startHp;
  }

  const spellValidationError = validateSpellSelection(class_id, level, spells_known);
  if (spellValidationError) {
    return res.status(400).json({ error: spellValidationError });
  }

  const insertChar = db.prepare(`
    INSERT INTO characters (name, owner_user_id, class_id, subclass_id, race_id, background_id, level,
      experience_points, alignment, ability_scores_json, stat_overrides_json,
      skill_proficiencies_json, spellcasting_type, spellbook_json, spells_known_json,
      feats_json, backstory, personality_traits, ideals, bonds, flaws, appearance, portrait_url)
    VALUES (@name, @owner_user_id, @class_id, @subclass_id, @race_id, @background_id, @level,
      @experience_points, @alignment, @ability_scores_json, @stat_overrides_json,
      @skill_proficiencies_json, @spellcasting_type, @spellbook_json, @spells_known_json,
      @feats_json, @backstory, @personality_traits, @ideals, @bonds, @flaws, @appearance, @portrait_url)
  `);

  const createCharacter = db.transaction(() => {
    const result = insertChar.run({
      name, owner_user_id: req.user.id, class_id: class_id ?? null, subclass_id: subclass_id ?? null,
      race_id: race_id ?? null, background_id: background_id ?? null,
      level, experience_points, alignment: alignment ?? null,
      ability_scores_json: JSON.stringify(ability_scores),
      stat_overrides_json: JSON.stringify(stat_overrides),
      skill_proficiencies_json: JSON.stringify(skill_proficiencies),
      spellcasting_type: spellType ?? null,
      spellbook_json: JSON.stringify(spellbook),
      spells_known_json: JSON.stringify(spells_known),
      feats_json: JSON.stringify(feats),
      backstory, personality_traits, ideals, bonds, flaws, appearance,
      portrait_url: portrait_url ?? null,
    });

    const charId = result.lastInsertRowid;

    // Create initial state
    db.prepare(`
      INSERT INTO character_state (character_id, hp_current)
      VALUES (?, ?)
    `).run(charId, startHp ?? 1);

    // Create currency row
    db.prepare(`INSERT INTO currency (character_id) VALUES (?)`).run(charId);

    // Seed starting equipment and coins from background data (best effort)
    if (background_id) {
      const bgRow = db.prepare('SELECT data_json FROM backgrounds WHERE id = ?').get(background_id);
      const start = backgroundStartingPicks(bgRow);
      if (start.items.length) {
        const insertInv = db.prepare(`
          INSERT INTO inventory (character_id, name, quantity, item_type, notes, sort_order)
          VALUES (?, ?, 1, 'misc', 'Starting equipment', ?)
        `);
        start.items.forEach((itemName, idx) => insertInv.run(charId, itemName, idx));
      }
      if (start.cp > 0) {
        db.prepare('UPDATE currency SET cp = cp + ? WHERE character_id = ?').run(start.cp, charId);
      }
    }

    return charId;
  });

  const charId = createCharacter();

  const char = enrichCharacter(parseChar(db.prepare('SELECT * FROM characters WHERE id = ?').get(charId)));
  res.status(201).json(char);
});

// ── GET /api/characters/:id ────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id = ? AND owner_user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });
  res.json(enrichCharacter(parseChar(row)));
});

// ── PUT /api/characters/:id ────────────────────────────────────
router.put('/:id', (req, res) => {
  const rowExisting = db.prepare('SELECT * FROM characters WHERE id = ? AND owner_user_id = ?').get(req.params.id, req.user.id);
  const existing = rowExisting ? parseChar(rowExisting) : null;
  if (!existing) return res.status(404).json({ error: 'Character not found' });

  const fields = [
    'name','class_id','subclass_id','race_id','background_id','level',
    'experience_points','alignment','ability_scores','stat_overrides',
    'skill_proficiencies','spellcasting_type','spellbook','spells_known','feats',
    'backstory','personality_traits','ideals','bonds','flaws','appearance','portrait_url',
  ];

  if (req.body.level !== undefined && validateLevel(req.body.level) === null) {
    return res.status(400).json({ error: 'level must be an integer between 1 and 20' });
  }
  if (req.body.ability_scores !== undefined) {
    const abilityError = validateAbilityScores(req.body.ability_scores);
    if (abilityError) return res.status(400).json({ error: abilityError });
  }

  const updates = [];
  const params = {};

  for (const field of fields) {
    if (req.body[field] === undefined) continue;
    const jsonFields = ['ability_scores','stat_overrides','skill_proficiencies','spellbook','spells_known','feats'];
    if (jsonFields.includes(field)) {
      updates.push(`${field}_json = @${field}`);
      params[field] = JSON.stringify(req.body[field]);
    } else {
      updates.push(`${field} = @${field}`);
      params[field] = req.body[field];
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  const nextClassId = req.body.class_id !== undefined ? req.body.class_id : existing.class_id;
  const nextLevel = req.body.level !== undefined ? req.body.level : existing.level;
  const nextSpellsKnown = req.body.spells_known !== undefined ? req.body.spells_known : existing.spells_known;
  const spellValidationError = validateSpellSelection(nextClassId, nextLevel, nextSpellsKnown);
  if (spellValidationError) {
    return res.status(400).json({ error: spellValidationError });
  }

  updates.push(`updated_at = datetime('now')`);
  params.id = req.params.id;

  db.prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = @id AND owner_user_id = @owner_user_id`).run({ ...params, owner_user_id: req.user.id });

  const row = db.prepare('SELECT * FROM characters WHERE id = ? AND owner_user_id = ?').get(req.params.id, req.user.id);
  res.json(enrichCharacter(parseChar(row)));
});

// ── DELETE /api/characters/:id ────────────────────────────────
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM characters WHERE id = ? AND owner_user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Character not found' });
  db.prepare('DELETE FROM characters WHERE id = ? AND owner_user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ── GET /api/characters/:id/state ────────────────────────────
router.get('/:id/state', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const row = db.prepare('SELECT * FROM character_state WHERE character_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'State not found' });
  res.json(parseState(row));
});

// ── PUT /api/characters/:id/state ────────────────────────────
router.put('/:id/state', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const charId = req.params.id;
  const existing = db.prepare('SELECT character_id FROM character_state WHERE character_id = ?').get(charId);

  const body = req.body;
  const toJson = v => v !== undefined ? JSON.stringify(v) : undefined;

  // 5e bounds: HP never drops below 0 (0 HP means dying, not negative), temp
  // HP is never negative, and death saves cap at 3 successes / 3 failures.
  const clampHp = v => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };
  const clampDeathSaves = ds => {
    if (ds === undefined) return undefined;
    const clampCount = v => Math.min(3, Math.max(0, Math.floor(Number(v) || 0)));
    return {
      successes: clampCount(ds?.successes),
      failures: clampCount(ds?.failures),
    };
  };

  const fields = {
    hp_current: clampHp(body.hp_current),
    hp_temp: clampHp(body.hp_temp),
    hp_temp_source: body.hp_temp_source,
    spell_slots_used_json: toJson(body.spell_slots_used),
    hit_dice_used_json: toJson(body.hit_dice_used),
    prepared_spells_json: toJson(body.prepared_spells),
    concentration: body.concentration,
    active_effects_json: toJson(body.active_effects),
    conditions_json: toJson(body.conditions),
    class_resources_json: toJson(body.class_resources),
    combat_active: body.combat_active !== undefined ? (body.combat_active ? 1 : 0) : undefined,
    combat_round: body.combat_round !== undefined ? Math.max(1, Math.floor(Number(body.combat_round) || 1)) : undefined,
    death_saves_json: toJson(clampDeathSaves(body.death_saves)),
    log_json: toJson(body.log),
  };

  const updates = [];
  const params = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    updates.push(`${k} = @${k}`);
    params[k] = v;
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  updates.push(`updated_at = datetime('now')`);
  params.character_id = charId;

  if (existing) {
    db.prepare(`UPDATE character_state SET ${updates.join(', ')} WHERE character_id = @character_id`).run(params);
  } else {
    // Create if doesn't exist
    db.prepare(`INSERT INTO character_state (character_id, hp_current) VALUES (?, 0)`).run(charId);
    db.prepare(`UPDATE character_state SET ${updates.join(', ')} WHERE character_id = @character_id`).run(params);
  }

  const row = db.prepare('SELECT * FROM character_state WHERE character_id = ?').get(charId);
  res.json(parseState(row));
});

// ── GET /api/characters/:id/effects ───────────────────────────
router.get('/:id/effects', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id = ? AND owner_user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });

  const char = enrichCharacter(parseChar(row));
  const stateRow = db.prepare('SELECT * FROM character_state WHERE character_id = ?').get(req.params.id);
  const state = parseState(stateRow) || { active_effects: [] };

  const effects = loadCharacterEffectDefinitions(char).map(e => e.effect);
  const activeEffects = Array.isArray(state.active_effects) ? state.active_effects : [];

  res.json({
    character_id: char.id,
    effects,
    active_effects: activeEffects,
  });
});

// ── POST /api/characters/:id/effects/resolve ──────────────────
router.post('/:id/effects/resolve', (req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id = ? AND owner_user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Character not found' });

  const char = enrichCharacter(parseChar(row));
  const stateRow = db.prepare('SELECT * FROM character_state WHERE character_id = ?').get(req.params.id);
  const state = parseState(stateRow) || { active_effects: [] };

  const baseContext = req.body?.context || {};
  const actorTags = [];
  if (char.class_name) actorTags.push(`class:${String(char.class_name).toLowerCase()}`);
  if (char.subclass_name) actorTags.push(`subclass:${String(char.subclass_name).toLowerCase()}`);

  const context = {
    ...baseContext,
    actor: {
      ...baseContext.actor,
      id: char.id,
      level: char.level,
      ability_scores: char.ability_scores,
      spellcasting_ability: char.spellcasting_ability,
      tags: [...(baseContext.actor?.tags || []), ...actorTags],
    },
    state: {
      ...baseContext.state,
      concentration: state.concentration,
    },
  };

  const effects = loadCharacterEffectDefinitions(char).map(e => e.effect);
  const activeOverride = Array.isArray(req.body?.active_effects) ? req.body.active_effects : null;
  const activeEffects = activeOverride || (Array.isArray(state.active_effects) ? state.active_effects : []);
  const filter = req.body?.filter || null;
  const combined = [...effects, ...activeEffects].filter(effect => shouldIncludeEffect(effect, filter, activeEffects));

  const { applicable, modifiers } = collectModifiers(combined, context);
  res.json({
    character_id: char.id,
    applicable_effects: applicable,
    modifiers,
  });
});

// ── GET /api/characters/:id/inventory ─────────────────────────
router.get('/:id/inventory', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const rows = db.prepare(`
    SELECT * FROM inventory WHERE character_id = ? ORDER BY sort_order, created_at
  `).all(req.params.id);
  res.json(rows);
});

// ── POST /api/characters/:id/inventory ────────────────────────
router.post('/:id/inventory', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const { name, quantity=1, weight, value_gp, equipped=false, item_type='misc', notes='', weapon_damage = null, weapon_atk_bonus = null } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM inventory WHERE character_id = ?').get(req.params.id);
  const sortOrder = (maxOrder?.m ?? -1) + 1;

  const result = db.prepare(`
    INSERT INTO inventory (character_id, name, quantity, weight, value_gp, equipped, item_type, weapon_damage, weapon_atk_bonus, notes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, name, quantity, weight ?? null, value_gp ?? null, equipped ? 1 : 0, item_type, weapon_damage, weapon_atk_bonus, notes, sortOrder);

  const row = db.prepare('SELECT * FROM inventory WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// ── PUT /api/characters/:id/inventory/:itemId ─────────────────
router.put('/:id/inventory/:itemId', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const existing = db.prepare('SELECT id FROM inventory WHERE id = ? AND character_id = ?').get(req.params.itemId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found' });

  const allowed = ['name','quantity','weight','value_gp','equipped','item_type','weapon_damage','weapon_atk_bonus','notes','sort_order'];
  const updates = [];
  const params = { id: req.params.itemId };

  for (const field of allowed) {
    if (req.body[field] === undefined) continue;
    updates.push(`${field} = @${field}`);
    if (field === 'equipped') {
      params[field] = req.body[field] ? 1 : 0;
    } else if (field === 'weapon_atk_bonus') {
      params[field] = req.body[field] === '' || req.body[field] === null ? null : req.body[field];
    } else {
      params[field] = req.body[field];
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  db.prepare(`UPDATE inventory SET ${updates.join(', ')} WHERE id = @id`).run(params);

  res.json(db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.itemId));
});

// ── DELETE /api/characters/:id/inventory/:itemId ──────────────
router.delete('/:id/inventory/:itemId', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const existing = db.prepare('SELECT id FROM inventory WHERE id = ? AND character_id = ?').get(req.params.itemId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.itemId);
  res.json({ ok: true });
});

// ── GET /api/characters/:id/currency ─────────────────────────
router.get('/:id/currency', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const row = db.prepare('SELECT * FROM currency WHERE character_id = ?').get(req.params.id);
  res.json(row || { character_id: parseInt(req.params.id), cp:0, sp:0, ep:0, gp:0, pp:0 });
});

// ── PUT /api/characters/:id/currency ─────────────────────────
router.put('/:id/currency', (req, res) => {
  if (!requireOwnedCharacter(req, res)) return;
  const charId = req.params.id;
  const { cp=0, sp=0, ep=0, gp=0, pp=0 } = req.body;

  const existing = db.prepare('SELECT character_id FROM currency WHERE character_id = ?').get(charId);
  if (existing) {
    db.prepare('UPDATE currency SET cp=?,sp=?,ep=?,gp=?,pp=? WHERE character_id=?').run(cp,sp,ep,gp,pp,charId);
  } else {
    db.prepare('INSERT INTO currency (character_id,cp,sp,ep,gp,pp) VALUES (?,?,?,?,?,?)').run(charId,cp,sp,ep,gp,pp);
  }

  res.json(db.prepare('SELECT * FROM currency WHERE character_id = ?').get(charId));
});

module.exports = router;
