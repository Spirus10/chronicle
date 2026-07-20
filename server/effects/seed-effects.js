/**
 * @fileoverview Effect definition seeding module.
 * Builds and upserts effect definitions for spells, class features, races, feats, and weapons.
 */
'use strict';

const db = require('../db');

const DEFAULT_SCOPE = {
  sources: ['PHB', 'SRD'],
  includeSrd: true,
  allSources: false,
};

const insertEffectDefinition = db.prepare(`
  INSERT INTO effect_definitions (name, source_type, source_id, scope, kind, priority, duration_type, tags_json, effect_json)
  VALUES (@name, @source_type, @source_id, @scope, @kind, @priority, @duration_type, @tags_json, @effect_json)
  ON CONFLICT(source_type, source_id, name) DO UPDATE SET
    scope=excluded.scope,
    kind=excluded.kind,
    priority=excluded.priority,
    duration_type=excluded.duration_type,
    tags_json=excluded.tags_json,
    effect_json=excluded.effect_json
`);

/**
 * Normalizes a source string to uppercase trimmed form.
 * @param {string} value - Source identifier to normalize
 * @returns {string} Uppercase trimmed source string
 */
function normalizeSource(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Checks if a data source is within the allowed scope for seeding.
 * @param {string} source - Source identifier (e.g., 'PHB', 'SRD')
 * @param {Object} data - Data object with optional srd/basicRules flags
 * @param {Object} [scope] - Scope configuration with sources, includeSrd, allSources
 * @returns {boolean} True if source is allowed
 */
function isAllowedSource(source, data, scope) {
  if (scope?.allSources) return true;
  const allowed = new Set((scope?.sources || DEFAULT_SCOPE.sources).map(normalizeSource));
  const src = normalizeSource(source || data?.source);
  if (src && allowed.has(src)) return true;
  if (scope?.includeSrd || DEFAULT_SCOPE.includeSrd) {
    if (data?.srd || data?.basicRules) return true;
  }
  return false;
}

/**
 * Recursively flattens nested entry structures into a flat array of strings.
 * @param {*} value - Entry value (string, array, or object with entries)
 * @param {string[]} out - Output array to collect strings into
 * @returns {void}
 */
function flattenEntries(value, out) {
  if (!value) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(v => flattenEntries(v, out));
    return;
  }
  if (typeof value === 'object') {
    if (value.entries) flattenEntries(value.entries, out);
    Object.values(value).forEach(v => flattenEntries(v, out));
  }
}

/**
 * Collects all string values from nested entry structures.
 * @param {*} entries - Entry data to flatten
 * @returns {string[]} Array of string values
 */
function collectEntryStrings(entries) {
  const texts = [];
  flattenEntries(entries, texts);
  return texts.map(t => String(t));
}

/**
 * Converts nested entry structures to a single space-joined text string.
 * @param {*} entries - Entry data to flatten and join
 * @returns {string} Combined text string
 */
function entriesToText(entries) {
  const texts = [];
  flattenEntries(entries, texts);
  return texts.map(t => String(t).trim()).filter(Boolean).join(' ');
}

/**
 * Extracts the first dice notation (e.g., "2d6") from text.
 * @param {string} text - Text to search for dice notation
 * @returns {string} First dice notation found, or empty string
 */
function extractFirstDice(text) {
  const raw = String(text || '');
  const match = raw.match(/\b\d+d\d+\b/i);
  return match ? match[0] : '';
}

/**
 * Extracts spell names from {@spell ...} tags in text.
 * @param {string} text - Text containing 5e.tools spell tags
 * @returns {string[]} Array of extracted spell names
 */
function extractSpellTagsFromText(text) {
  const names = [];
  if (!text) return names;
  const regex = /\{@spell ([^|}]+)(?:\|[^}]+)?\}/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    names.push(match[1].trim());
  }
  return names;
}

/**
 * Extracts unique spell names from nested entry structures.
 * @param {*} entries - Entry data containing spell tags
 * @returns {string[]} Deduplicated array of spell names
 */
function extractSpellNamesFromEntries(entries) {
  const texts = collectEntryStrings(entries);
  const names = [];
  texts.forEach(text => names.push(...extractSpellTagsFromText(text)));
  return [...new Set(names.filter(Boolean))];
}

/**
 * Detects at-will, no-slot, and granted spell rules from entry text.
 * @param {*} entries - Entry data to analyze
 * @returns {{atWill: Set<string>, noSlot: Set<string>, grants: Set<string>}} Sets of spell names by rule type
 */
function detectAtWillSpellRules(entries) {
  const texts = collectEntryStrings(entries);
  const results = {
    atWill: new Set(),
    noSlot: new Set(),
    grants: new Set(),
  };
  texts.forEach(text => {
    const lower = String(text || '').toLowerCase();
    const spells = extractSpellTagsFromText(text);
    if (!spells.length) return;
    spells.forEach(name => results.grants.add(name));
    if (lower.includes('at will')) {
      spells.forEach(name => {
        results.atWill.add(name);
        results.noSlot.add(name);
      });
    }
    if (lower.includes('without expending a spell slot')) {
      spells.forEach(name => results.noSlot.add(name));
    }
  });
  return results;
}

/**
 * Extracts damage, dice, condition, scaling, and healing tags from 5e.tools formatted text.
 * @param {string} text - Text containing 5e.tools tags
 * @returns {Object} Extracted tags by category (damage, dice, conditions, scaledamage, scaledice, healing)
 */
function extractTagsFromText(text) {
  const tags = {
    damage: [],
    dice: [],
    conditions: [],
    scaledamage: [],
    scaledice: [],
    healing: [],
  };

  const damageRegex = /\{@damage ([^}]+)\}/gi;
  const diceRegex = /\{@dice ([^}]+)\}/gi;
  const conditionRegex = /\{@condition ([^}]+)\}/gi;
  const scaleRegex = /\{@scaledamage ([^|}]+)\|([^|}]+)\|([^}]+)\}/gi;
  const scaleDiceRegex = /\{@scaledice ([^|}]+)\|([^|}]+)\|([^}]+)\}/gi;
  const healingRegex = /\{@healing ([^}]+)\}/gi;

  let match;
  while ((match = damageRegex.exec(text)) !== null) {
    tags.damage.push(match[1].trim());
  }
  while ((match = diceRegex.exec(text)) !== null) {
    tags.dice.push(match[1].trim());
  }
  while ((match = conditionRegex.exec(text)) !== null) {
    tags.conditions.push(match[1].trim().toLowerCase());
  }
  while ((match = scaleRegex.exec(text)) !== null) {
    tags.scaledamage.push({ base: match[1].trim(), range: match[2].trim(), step: match[3].trim() });
  }
  while ((match = scaleDiceRegex.exec(text)) !== null) {
    tags.scaledice.push({ base: match[1].trim(), range: match[2].trim(), step: match[3].trim() });
  }
  while ((match = healingRegex.exec(text)) !== null) {
    tags.healing.push(match[1].trim());
  }

  return tags;
}

/**
 * Collects all signal tags (damage, dice, conditions, etc.) from nested entries.
 * @param {*} entries - Entry data to analyze
 * @returns {Object} Deduplicated signals by category
 */
function collectEntrySignals(entries) {
  const texts = [];
  flattenEntries(entries, texts);
  const signals = {
    damage: [],
    dice: [],
    conditions: [],
    scaledamage: [],
    scaledice: [],
    healing: [],
  };

  for (const text of texts) {
    const found = extractTagsFromText(text);
    signals.damage.push(...found.damage);
    signals.dice.push(...found.dice);
    signals.conditions.push(...found.conditions);
    signals.scaledamage.push(...found.scaledamage);
    signals.scaledice.push(...found.scaledice);
    signals.healing.push(...found.healing);
  }

  signals.damage = [...new Set(signals.damage)];
  signals.dice = [...new Set(signals.dice)];
  signals.conditions = [...new Set(signals.conditions)];
  signals.healing = [...new Set(signals.healing)];
  return signals;
}

/**
 * Builds a standardized effect object from component parts.
 * @param {Object} params - Effect parameters
 * @param {string} params.name - Effect name
 * @param {string} params.sourceType - Source type (e.g., 'spell', 'class_feature')
 * @param {number} params.sourceId - Source database ID
 * @param {string} params.scope - Effect scope ('actor', 'action', 'roll')
 * @param {string} params.kind - Effect kind ('passive', 'cast', 'modifier', 'attack')
 * @param {number} params.priority - Priority for ordering (higher = first)
 * @param {string} params.durationType - Duration type ('permanent', 'concentration', 'instant', etc.)
 * @param {string[]} [params.tags] - Effect tags
 * @param {string} [params.status] - Curation status ('curated', 'needs_review', 'auto')
 * @param {Object[]} [params.conditions] - Condition objects
 * @param {Object[]} [params.modifiers] - Modifier objects
 * @param {Object} [params.meta] - Additional metadata
 * @returns {Object} Standardized effect object
 */
function buildEffect({ name, sourceType, sourceId, scope, kind, priority, durationType, tags, status, conditions, modifiers, meta }) {
  return {
    name,
    scope,
    kind,
    priority,
    duration: { type: durationType },
    conditions: conditions || [],
    modifiers: modifiers || [],
    tags: tags || [],
    source: { type: sourceType, id: sourceId },
    status: status || 'auto',
    meta: meta || {},
  };
}

// Cantrip scaling sentences ("This spell's damage increases by 1d6 when you
// reach 5th level (2d6)...") describe replacement tiers, not additive dice.
const CANTRIP_SCALING_TEXT = /increases by .{0,60}when you reach/i;

/**
 * Normalizes 5etools scalingLevelDice data into level→dice maps.
 * @param {Object|Object[]} sld - scalingLevelDice entry or array of entries
 * @returns {{label: string|null, map: Object}[]} Normalized scaling maps
 */
function normalizeScalingLevelDice(sld) {
  const list = Array.isArray(sld) ? sld : (sld ? [sld] : []);
  const maps = [];
  for (const entry of list) {
    const scaling = entry?.scaling;
    if (!scaling || typeof scaling !== 'object') continue;
    const map = {};
    for (const [lvl, dice] of Object.entries(scaling)) {
      const n = parseInt(lvl, 10);
      if (Number.isFinite(n) && dice) map[n] = String(dice);
    }
    if (Object.keys(map).length) maps.push({ label: entry.label || null, map });
  }
  return maps;
}

/**
 * Determines the duration type string from a spell's duration data.
 * @param {Object} spell - Spell data with duration array
 * @returns {string} Duration type ('instant', 'permanent', 'special', 'concentration', or 'timed')
 */
function durationTypeFromSpell(spell) {
  const duration = Array.isArray(spell?.duration) ? spell.duration : [];
  const d = duration[0] || {};
  if (d.type === 'instant') return 'instant';
  if (d.type === 'permanent') return 'permanent';
  if (d.type === 'special') return 'special';
  if (d.type === 'timed') return d.concentration ? 'concentration' : 'timed';
  return 'instant';
}

/**
 * Builds an effect definition from a spell's data, extracting damage, healing, conditions, and scaling.
 * @param {Object} spell - Spell data with id, name, entries, level, school, etc.
 * @param {Object} scope - Source scope for filtering
 * @returns {Object} Spell effect definition
 */
function buildSpellEffect(spell, scope) {
  const scalingMaps = normalizeScalingLevelDice(spell.scalingLevelDice);

  // Flat damage/dice/healing tokens come from the base entries only.
  // "At Higher Levels" text and cantrip scaling sentences describe
  // replacements keyed to level, never dice added on top of the base roll.
  const allBaseTexts = collectEntryStrings([spell.entries || []]);
  const baseTexts = [];
  const scalingTexts = [];
  for (const text of allBaseTexts) {
    (CANTRIP_SCALING_TEXT.test(text) ? scalingTexts : baseTexts).push(text);
  }
  const entriesSignals = collectEntrySignals(baseTexts);
  const higherSignals = collectEntrySignals([spell.entriesHigherLevel || []]);
  entriesSignals.scaledamage.push(...higherSignals.scaledamage);
  entriesSignals.scaledice.push(...higherSignals.scaledice);

  // Fallback for scaling cantrips missing structured scalingLevelDice data:
  // parse tiers out of the scaling sentence itself.
  if (!scalingMaps.length && scalingTexts.length) {
    const map = {};
    for (const text of scalingTexts) {
      const pairRe = /(\d+)(?:st|nd|rd|th) level \(\{@(?:damage|dice) ([^}]+)\}\)/gi;
      let m;
      while ((m = pairRe.exec(text)) !== null) map[parseInt(m[1], 10)] = m[2].trim();
    }
    if (Object.keys(map).length) {
      if (!map[1] && entriesSignals.damage.length) map[1] = entriesSignals.damage[0];
      scalingMaps.push({ label: null, map });
    }
  }

  // Dice that are really scaling tiers must not also appear as flat adds.
  const scalingDiceValues = new Set();
  for (const { map } of scalingMaps) Object.values(map).forEach(d => scalingDiceValues.add(d));
  entriesSignals.damage = entriesSignals.damage.filter(d => !scalingDiceValues.has(d));

  const damageTypes = Array.isArray(spell.damageInflict) && spell.damageInflict.length ? spell.damageInflict : [];
  const conditions = Array.isArray(spell.conditionInflict) && spell.conditionInflict.length
    ? spell.conditionInflict.map(c => String(c).toLowerCase())
    : entriesSignals.conditions;

  const modifiers = [];

  for (const { map } of scalingMaps) {
    const levels = Object.keys(map).map(Number).sort((a, b) => a - b);
    if (!levels.length) continue;
    modifiers.push({
      kind: 'add_dice',
      target: 'damage',
      value: {
        dice: map[levels[0]],
        scaling: map,
        damage_type: damageTypes.length === 1 ? damageTypes[0] : null,
        damage_types: damageTypes.length > 1 ? damageTypes : undefined,
      },
      tags: ['spell_damage', 'cantrip_scaling'],
    });
  }

  for (const dice of entriesSignals.damage) {
    modifiers.push({
      kind: 'add_dice',
      target: 'damage',
      value: {
        dice,
        damage_type: damageTypes.length === 1 ? damageTypes[0] : null,
        damage_types: damageTypes.length > 1 ? damageTypes : undefined,
      },
      tags: ['spell_damage'],
    });
  }

  for (const dice of entriesSignals.dice) {
    modifiers.push({
      kind: 'add_dice',
      target: 'effect',
      value: { dice },
      tags: ['spell_dice'],
    });
  }

  for (const dice of entriesSignals.healing) {
    modifiers.push({
      kind: 'add_dice',
      target: 'healing',
      value: { dice },
      tags: ['spell_healing'],
    });
  }

  for (const condition of conditions) {
    modifiers.push({
      kind: 'apply_condition',
      target: 'target',
      value: { condition },
      tags: ['spell_condition'],
    });
  }

  if (entriesSignals.scaledamage.length) {
    modifiers.push({
      kind: 'scaling',
      target: 'damage',
      value: entriesSignals.scaledamage,
      tags: ['spell_scaling'],
    });
  }

  if (entriesSignals.scaledice.length) {
    modifiers.push({
      kind: 'scaling',
      target: 'effect',
      value: entriesSignals.scaledice,
      tags: ['spell_scaling_dice'],
    });
  }

  const rulesText = entriesToText([spell.entries || [], spell.entriesHigherLevel || []]);
  const healingText = entriesToText(spell.entries || []);
  const healingHeuristic = /regains/i.test(rulesText) && /hit points?/i.test(rulesText);
  if (healingHeuristic && !entriesSignals.healing.length) {
    const firstDice = extractFirstDice(healingText);
    if (firstDice) {
      modifiers.push({
        kind: 'add_dice',
        target: 'healing',
        value: { dice: firstDice },
        tags: ['spell_healing'],
      });
    }
  }
  if (healingHeuristic && /spellcasting ability modifier/i.test(rulesText)) {
    modifiers.push({
      kind: 'add_ability_mod',
      target: 'healing',
      value: { ability: 'spellcasting' },
      tags: ['spell_healing'],
    });
  }
  if (rulesText) {
    modifiers.push({
      kind: 'rules_text',
      target: 'action',
      value: { text: rulesText },
      tags: ['rules_text'],
    });
  }
  const durationType = durationTypeFromSpell(spell);
  const tags = [
    'source:spell',
    `spell_level:${spell.level}`,
    `school:${spell.school}`,
  ];
  if (spell.ritual) tags.push('ritual');
  if (durationType === 'concentration') tags.push('concentration');

  const onlyRulesText = modifiers.length === 1 && modifiers[0]?.kind === 'rules_text';
  if (onlyRulesText) tags.push('resolution:rules_text');

  const meta = {
    saving_throw: spell.savingThrow || [],
    spell_attack: spell.spellAttack || [],
    damage_types: damageTypes,
    area_tags: spell.areaTags || [],
  };

  return buildEffect({
    name: spell.name,
    sourceType: 'spell',
    sourceId: spell.id,
    scope: 'action',
    kind: 'cast',
    priority: 0,
    durationType,
    tags,
    status: 'curated',
    modifiers,
    conditions: [
      { type: 'action_name_is', params: { name: spell.name } },
    ],
    meta,
  });
}

/**
 * Builds an effect definition from a class/optional feature.
 * @param {Object} params - Feature parameters
 * @param {Object} params.row - Database row with id and name
 * @param {Array} params.entries - Feature entry data
 * @param {string[]} params.tags - Initial tags to include
 * @param {string} params.sourceType - Source type ('class_feature' or 'optional_feature')
 * @returns {Object} Feature effect definition
 */
function buildFeatureEffect({ row, entries, tags, sourceType }) {
  const signals = collectEntrySignals(entries);
  const modifiers = [];
  const spellRules = detectAtWillSpellRules(entries);
  const nameLower = String(row.name || '').toLowerCase();

  signals.damage.forEach(dice => {
    modifiers.push({
      kind: 'add_dice',
      target: 'damage',
      value: { dice },
      tags: ['feature_damage'],
    });
  });

  signals.conditions.forEach(condition => {
    modifiers.push({
      kind: 'apply_condition',
      target: 'target',
      value: { condition },
      tags: ['feature_condition'],
    });
  });

  signals.healing.forEach(dice => {
    modifiers.push({
      kind: 'add_dice',
      target: 'healing',
      value: { dice },
      tags: ['feature_healing'],
    });
  });

  if (spellRules.grants.size || spellRules.atWill.size || spellRules.noSlot.size) {
    spellRules.grants.forEach(spell => {
      modifiers.push({
        kind: 'grant_spell',
        target: 'actor',
        value: { spell },
        tags: ['spell_grant'],
      });
    });
    spellRules.atWill.forEach(spell => {
      modifiers.push({
        kind: 'cast_at_will',
        target: 'spell',
        value: { spell },
        tags: ['spell_at_will'],
      });
    });
    spellRules.noSlot.forEach(spell => {
      modifiers.push({
        kind: 'no_slot',
        target: 'spell',
        value: { spell },
        tags: ['spell_no_slot'],
      });
    });
  }

  const rulesText = entriesToText(entries);
  if (rulesText) {
    modifiers.push({
      kind: 'rules_text',
      target: 'actor',
      value: { text: rulesText },
      tags: ['rules_text'],
    });
  } else if (!modifiers.length && row?.name) {
    modifiers.push({
      kind: 'rules_text',
      target: 'actor',
      value: { text: row.name },
      tags: ['rules_text', 'rules_text:placeholder'],
    });
  }

  const curatedNoEffect = new Set([
    'armor of shadows',
  ]);
  if (nameLower === 'sneak attack') tags.push('requires_toggle');
  const onlyRulesText = modifiers.length === 1 && modifiers[0]?.kind === 'rules_text';
  if (onlyRulesText) tags.push('resolution:rules_text');
  const status = modifiers.length || curatedNoEffect.has(String(row.name || '').toLowerCase())
    ? 'curated'
    : 'needs_review';

  return buildEffect({
    name: row.name,
    sourceType,
    sourceId: row.id,
    scope: 'actor',
    kind: 'passive',
    priority: 0,
    durationType: 'permanent',
    tags,
    status,
    modifiers,
  });
}

/**
 * Builds an effect definition from race data (ability bonuses, speed, darkvision, traits).
 * @param {Object} params - Race parameters
 * @param {Object} params.row - Database row with id and name
 * @param {Object} params.data - Parsed race data (ability, speed, darkvision, entries)
 * @returns {Object} Race effect definition
 */
function buildRaceEffect({ row, data }) {
  const tags = ['source:race'];
  const modifiers = [];
  const ability = Array.isArray(data.ability) ? data.ability : [];
  if (ability.length) {
    modifiers.push({
      kind: 'ability_bonus',
      target: 'ability_scores',
      value: ability,
      tags: ['race_ability'],
    });
  }

  if (data.speed) {
    modifiers.push({
      kind: 'set_speed',
      target: 'speed',
      value: data.speed,
      tags: ['race_speed'],
    });
  }

  if (data.darkvision) {
    modifiers.push({
      kind: 'grant_sense',
      target: 'senses',
      value: { sense: 'darkvision', range: data.darkvision },
      tags: ['race_sense'],
    });
  }

  const rulesText = entriesToText(data.entries || []);
  if (rulesText) {
    modifiers.push({
      kind: 'rules_text',
      target: 'actor',
      value: { text: rulesText },
      tags: ['rules_text'],
    });
  } else if (!modifiers.length && row?.name) {
    modifiers.push({
      kind: 'rules_text',
      target: 'actor',
      value: { text: row.name },
      tags: ['rules_text', 'rules_text:placeholder'],
    });
  }

  const onlyRulesText = modifiers.length === 1 && modifiers[0]?.kind === 'rules_text';
  if (onlyRulesText) tags.push('resolution:rules_text');

  return buildEffect({
    name: row.name,
    sourceType: 'race',
    sourceId: row.id,
    scope: 'actor',
    kind: 'passive',
    priority: 0,
    durationType: 'permanent',
    tags,
    status: modifiers.length ? 'curated' : 'needs_review',
    modifiers,
  });
}

/**
 * Builds an effect definition from feat data (ability bonuses, rules text).
 * @param {Object} params - Feat parameters
 * @param {Object} params.row - Database row with id and name
 * @param {Object} params.data - Parsed feat data (ability, entries)
 * @returns {Object} Feat effect definition
 */
function buildFeatEffect({ row, data }) {
  const tags = ['source:feat'];
  const modifiers = [];

  const ability = Array.isArray(data.ability) ? data.ability : [];
  if (ability.length) {
    modifiers.push({
      kind: 'ability_bonus',
      target: 'ability_scores',
      value: ability,
      tags: ['feat_ability'],
    });
  }

  const rulesText = entriesToText(data.entries || []);
  if (rulesText) {
    modifiers.push({
      kind: 'rules_text',
      target: 'actor',
      value: { text: rulesText },
      tags: ['rules_text'],
    });
  } else if (!modifiers.length && row?.name) {
    modifiers.push({
      kind: 'rules_text',
      target: 'actor',
      value: { text: row.name },
      tags: ['rules_text', 'rules_text:placeholder'],
    });
  }

  const onlyRulesText = modifiers.length === 1 && modifiers[0]?.kind === 'rules_text';
  if (onlyRulesText) tags.push('resolution:rules_text');

  return buildEffect({
    name: row.name,
    sourceType: 'feat',
    sourceId: row.id,
    scope: 'actor',
    kind: 'passive',
    priority: 0,
    durationType: 'permanent',
    tags,
    status: modifiers.length ? 'curated' : 'needs_review',
    modifiers,
  });
}

/**
 * Builds an effect definition from weapon data (damage dice, category, rules text).
 * @param {Object} params - Weapon parameters
 * @param {Object} params.row - Database row with id, name, category, damage_dice, damage_type
 * @param {Object} params.data - Parsed weapon data (entries)
 * @returns {Object} Weapon effect definition
 */
function buildWeaponEffect({ row, data }) {
  const tags = ['source:weapon'];
  if (row.category) tags.push(`weapon_category:${row.category}`);
  const modifiers = [];
  if (row.damage_dice) {
    modifiers.push({
      kind: 'add_dice',
      target: 'damage',
      value: { dice: row.damage_dice, damage_type: row.damage_type || null },
      tags: ['weapon_damage'],
    });
  }
  const rulesText = entriesToText(data?.entries || []);
  if (rulesText) {
    modifiers.push({
      kind: 'rules_text',
      target: 'action',
      value: { text: rulesText },
      tags: ['rules_text'],
    });
  } else if (!modifiers.length && row?.name) {
    modifiers.push({
      kind: 'rules_text',
      target: 'action',
      value: { text: row.name },
      tags: ['rules_text', 'rules_text:placeholder'],
    });
  }
  const onlyRulesText = modifiers.length === 1 && modifiers[0]?.kind === 'rules_text';
  if (onlyRulesText) tags.push('resolution:rules_text');

  return buildEffect({
    name: row.name,
    sourceType: 'weapon',
    sourceId: row.id,
    scope: 'action',
    kind: 'attack',
    priority: 0,
    durationType: 'instant',
    tags,
    status: 'curated',
    modifiers,
    conditions: [
      { type: 'action_name_is', params: { name: row.name } },
    ],
    meta: { damage_type: row.damage_type || null },
  });
}

/**
 * Inserts or updates an effect definition in the database.
 * @param {Object} effect - Effect object to upsert
 * @returns {void}
 */
function upsertEffect(effect) {
  insertEffectDefinition.run({
    name: effect.name,
    source_type: effect.source.type,
    source_id: effect.source.id,
    scope: effect.scope,
    kind: effect.kind,
    priority: effect.priority,
    duration_type: effect.duration.type,
    tags_json: JSON.stringify(effect.tags || []),
    effect_json: JSON.stringify(effect),
  });
}

/**
 * Seeds effect definitions for class features and optional features.
 * @param {Object} scope - Source scope configuration
 * @returns {void}
 */
function seedClassFeatureEffects(scope) {
  const classFeatures = db.prepare(`
    SELECT cf.id, cf.name, cf.level, cf.class_id, cf.subclass_id, cf.is_subclass_feature, cf.entries_json,
           c.source AS class_source, c.data_json AS class_data,
           s.source AS subclass_source, s.data_json AS subclass_data
    FROM class_features cf
    LEFT JOIN classes c ON c.id = cf.class_id
    LEFT JOIN subclasses s ON s.id = cf.subclass_id
  `).all();

  for (const feat of classFeatures) {
    const classData = feat.class_data ? JSON.parse(feat.class_data) : null;
    const subclassData = feat.subclass_data ? JSON.parse(feat.subclass_data) : null;
    const allowed = isAllowedSource(feat.class_source, classData, scope)
      || (feat.subclass_id ? isAllowedSource(feat.subclass_source, subclassData, scope) : false);
    if (!allowed) continue;

    const tags = [
      'source:class_feature',
      `class_id:${feat.class_id}`,
      `level:${feat.level}`,
    ];
    if (feat.is_subclass_feature && feat.subclass_id) {
      tags.push(`subclass_id:${feat.subclass_id}`);
    }

    const entries = JSON.parse(feat.entries_json || '[]');
    const effect = buildFeatureEffect({ row: feat, entries, tags, sourceType: 'class_feature' });
    upsertEffect(effect);
  }

  const optionalFeatures = db.prepare(`
    SELECT id, name, source, feature_types_json, data_json
    FROM optional_features
  `).all();

  for (const feat of optionalFeatures) {
    const data = JSON.parse(feat.data_json || '{}');
    if (!isAllowedSource(feat.source, data, scope)) continue;
    const featureTypes = JSON.parse(feat.feature_types_json || '[]');
    const tags = ['source:optional_feature', ...featureTypes.map(t => `feature_type:${t}`)];
    const entries = data.entries || [];
    const effect = buildFeatureEffect({ row: feat, entries, tags, sourceType: 'optional_feature' });
    upsertEffect(effect);
  }

  const agonizing = db.prepare(`
    SELECT id, name, source, data_json
    FROM optional_features
    WHERE lower(name) = 'agonizing blast'
    LIMIT 1
  `).get();

  if (agonizing) {
    const data = JSON.parse(agonizing.data_json || '{}');
    if (isAllowedSource(agonizing.source, data, scope)) {
      const effect = {
        name: 'Agonizing Blast',
        scope: 'roll',
        kind: 'modifier',
        priority: 10,
        duration: { type: 'permanent' },
        conditions: [
          { type: 'action_name_is', params: { name: 'eldritch blast' } },
          { type: 'roll_type_is', params: { type: 'damage' } },
        ],
        modifiers: [
          {
            kind: 'add_ability_mod',
            target: 'damage',
            value: { ability: 'spellcasting' },
            tags: ['exclusive:damage_formula', 'agonizing_blast'],
          },
        ],
        tags: ['source:optional_feature', 'feature_type:EI'],
        source: { type: 'optional_feature', id: agonizing.id },
        status: 'curated',
      };
      upsertEffect(effect);
    }
  }
}

/**
 * Seeds effect definitions for feats.
 * @param {Object} scope - Source scope configuration
 * @returns {void}
 */
function seedFeatEffects(scope) {
  const feats = db.prepare(`
    SELECT id, name, source, data_json
    FROM feats
  `).all();

  for (const feat of feats) {
    const data = JSON.parse(feat.data_json || '{}');
    if (!isAllowedSource(feat.source, data, scope)) continue;
    const effect = buildFeatEffect({ row: feat, data });
    upsertEffect(effect);
  }
}

/**
 * Seeds effect definitions for spells, including special handling for Hex.
 * @param {Object} scope - Source scope configuration
 * @returns {void}
 */
function seedSpellEffects(scope) {
  const spells = db.prepare(`
    SELECT id, name, source, data_json
    FROM spells
  `).all();

  for (const spellRow of spells) {
    const data = JSON.parse(spellRow.data_json || '{}');
    if (!isAllowedSource(spellRow.source, data, scope)) continue;
    const spell = { id: spellRow.id, ...data };
    const effect = buildSpellEffect(spell, scope);
    upsertEffect(effect);
  }

  const hex = db.prepare(`
    SELECT id, name, source, data_json
    FROM spells
    WHERE lower(name) = 'hex'
    LIMIT 1
  `).get();

  if (hex) {
    const data = JSON.parse(hex.data_json || '{}');
    if (isAllowedSource(hex.source, data, scope)) {
      const effect = {
        name: 'Hex',
        scope: 'roll',
        kind: 'modifier',
        priority: 5,
        duration: { type: 'concentration' },
        conditions: [
          { type: 'target_has_condition', params: { condition: 'hexed', source: 'actor' } },
          { type: 'roll_type_is', params: { type: 'damage' } },
          // RAW: Hex adds 1d6 only when the caster hits the target with an
          // attack — never on save-based damage like Fireball.
          { type: 'action_has_tag', params: { tag: 'attack' } },
        ],
        modifiers: [
          {
            kind: 'add_dice',
            target: 'damage',
            value: { dice: '1d6', damage_type: 'necrotic' },
            tags: ['hex_damage'],
          },
        ],
        tags: ['source:spell'],
        source: { type: 'spell', id: hex.id },
        status: 'curated',
      };
      upsertEffect(effect);
    }
  }
}

/**
 * Seeds effect definitions for races.
 * @param {Object} scope - Source scope configuration
 * @returns {void}
 */
function seedRaceEffects(scope) {
  const races = db.prepare(`
    SELECT id, name, source, data_json
    FROM races
  `).all();

  for (const race of races) {
    const data = JSON.parse(race.data_json || '{}');
    if (!isAllowedSource(race.source, data, scope)) continue;
    const effect = buildRaceEffect({ row: race, data });
    upsertEffect(effect);
  }
}

/**
 * Seeds effect definitions for weapons.
 * @param {Object} scope - Source scope configuration
 * @returns {void}
 */
function seedWeaponEffects(scope) {
  const weapons = db.prepare(`
    SELECT id, name, source, category, damage_dice, damage_type, data_json
    FROM weapons
  `).all();

  for (const weapon of weapons) {
    const data = JSON.parse(weapon.data_json || '{}');
    if (!isAllowedSource(weapon.source, data, scope)) continue;
    const effect = buildWeaponEffect({ row: weapon, data });
    upsertEffect(effect);
  }
}

/**
 * Main entry point for seeding all effect definitions.
 * Seeds class features, feats, spells, races, and weapons.
 * @param {Object} [options] - Seeding options
 * @param {string[]} [options.sources] - Allowed source books
 * @param {boolean} [options.includeSrd] - Include SRD content
 * @param {boolean} [options.allSources] - Include all sources
 * @returns {void}
 */
function seedEffectDefinitions(options = {}) {
  const scope = {
    sources: options.sources || DEFAULT_SCOPE.sources,
    includeSrd: options.includeSrd ?? DEFAULT_SCOPE.includeSrd,
    allSources: options.allSources ?? DEFAULT_SCOPE.allSources,
  };

  seedClassFeatureEffects(scope);
  seedFeatEffects(scope);
  seedSpellEffects(scope);
  seedRaceEffects(scope);
  seedWeaponEffects(scope);
}

module.exports = seedEffectDefinitions;
