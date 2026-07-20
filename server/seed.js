'use strict';
/**
 * @fileoverview Seed script for fetching 5e.tools data and storing in SQLite.
 * Run: node server/seed.js
 * Idempotent — safe to re-run; uses INSERT OR REPLACE.
 */

const db = require('./db');
const seedEffectDefinitions = require('./effects/seed-effects');

const BASE = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-2014-src/master/data';
const HOMEBREW_SUBCLASS_URLS = [
  'https://raw.githubusercontent.com/TheGiddyLimit/homebrew/master/subclass/Matthew%20Mercer;%20Oath%20of%20the%20Open%20Sea.json',
];

// Proficiency bonus by level (standard 5e table)
const PROF_BONUS = [0,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6];

// Standard full-caster slot table [level][slot_level] = count
const FULL_CASTER_SLOTS = [
  null, // index 0 unused
  [2,0,0,0,0,0,0,0,0],
  [3,0,0,0,0,0,0,0,0],
  [4,2,0,0,0,0,0,0,0],
  [4,3,0,0,0,0,0,0,0],
  [4,3,2,0,0,0,0,0,0],
  [4,3,3,0,0,0,0,0,0],
  [4,3,3,1,0,0,0,0,0],
  [4,3,3,2,0,0,0,0,0],
  [4,3,3,3,1,0,0,0,0],
  [4,3,3,3,2,0,0,0,0],
  [4,3,3,3,2,1,0,0,0],
  [4,3,3,3,2,1,0,0,0],
  [4,3,3,3,2,1,1,0,0],
  [4,3,3,3,2,1,1,0,0],
  [4,3,3,3,2,1,1,1,0],
  [4,3,3,3,2,1,1,1,0],
  [4,3,3,3,2,1,1,1,1],
  [4,3,3,3,3,1,1,1,1],
  [4,3,3,3,3,2,1,1,1],
  [4,3,3,3,3,2,2,1,1],
];

const HALF_CASTER_SLOTS = [
  null,
  [0,0,0,0,0,0,0,0,0],
  [2,0,0,0,0,0,0,0,0],
  [3,0,0,0,0,0,0,0,0],
  [3,0,0,0,0,0,0,0,0],
  [4,2,0,0,0,0,0,0,0],
  [4,2,0,0,0,0,0,0,0],
  [4,3,0,0,0,0,0,0,0],
  [4,3,0,0,0,0,0,0,0],
  [4,3,2,0,0,0,0,0,0],
  [4,3,2,0,0,0,0,0,0],
  [4,3,3,0,0,0,0,0,0],
  [4,3,3,0,0,0,0,0,0],
  [4,3,3,1,0,0,0,0,0],
  [4,3,3,1,0,0,0,0,0],
  [4,3,3,2,0,0,0,0,0],
  [4,3,3,2,0,0,0,0,0],
  [4,3,3,3,1,0,0,0,0],
  [4,3,3,3,1,0,0,0,0],
  [4,3,3,3,2,0,0,0,0],
  [4,3,3,3,2,0,0,0,0],
];

const THIRD_CASTER_SLOTS = [
  null,
  [0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0],
  [2,0,0,0,0,0,0,0,0],
  [3,0,0,0,0,0,0,0,0],
  [3,0,0,0,0,0,0,0,0],
  [3,0,0,0,0,0,0,0,0],
  [4,2,0,0,0,0,0,0,0],
  [4,2,0,0,0,0,0,0,0],
  [4,2,0,0,0,0,0,0,0],
  [4,3,0,0,0,0,0,0,0],
  [4,3,0,0,0,0,0,0,0],
  [4,3,0,0,0,0,0,0,0],
  [4,3,2,0,0,0,0,0,0],
  [4,3,2,0,0,0,0,0,0],
  [4,3,2,0,0,0,0,0,0],
  [4,3,3,0,0,0,0,0,0],
  [4,3,3,0,0,0,0,0,0],
  [4,3,3,0,0,0,0,0,0],
  [4,3,3,1,0,0,0,0,0],
  [4,3,3,1,0,0,0,0,0],
];

// Pact magic: [level] = {slots, slot_level}
const PACT_MAGIC = [
  null,
  {slots:1,slot_level:1},
  {slots:2,slot_level:1},
  {slots:2,slot_level:2},
  {slots:2,slot_level:2},
  {slots:2,slot_level:3},
  {slots:2,slot_level:3},
  {slots:2,slot_level:4},
  {slots:2,slot_level:4},
  {slots:2,slot_level:5},
  {slots:2,slot_level:5},
  {slots:3,slot_level:5},
  {slots:3,slot_level:5},
  {slots:3,slot_level:5},
  {slots:3,slot_level:5},
  {slots:3,slot_level:5},
  {slots:3,slot_level:5},
  {slots:4,slot_level:5},
  {slots:4,slot_level:5},
  {slots:4,slot_level:5},
  {slots:4,slot_level:5},
];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────

function castingTimeText(time) {
  if (!time || !time[0]) return null;
  const t = time[0];
  if (t.unit === 'action') return '1 action';
  if (t.unit === 'bonus') return '1 bonus action';
  if (t.unit === 'reaction') return `1 reaction${t.condition ? ', ' + t.condition : ''}`;
  return `${t.number} ${t.unit}`;
}

function rangeText(range) {
  if (!range) return null;
  if (range.type === 'special') return 'Special';
  if (range.type === 'point') {
    const d = range.distance;
    if (!d) return null;
    if (d.type === 'self') return 'Self';
    if (d.type === 'touch') return 'Touch';
    if (d.type === 'sight') return 'Sight';
    if (d.type === 'unlimited') return 'Unlimited';
    return `${d.amount} ${d.type}`;
  }
  if (range.type === 'radius') return `Self (${range.distance?.amount ?? '?'}-ft radius)`;
  if (range.type === 'cone') return `Self (${range.distance?.amount ?? '?'}-ft cone)`;
  if (range.type === 'line') return `Self (${range.distance?.amount ?? '?'}-ft line)`;
  if (range.type === 'cube') return `Self (${range.distance?.amount ?? '?'}-ft cube)`;
  if (range.type === 'sphere') return `${range.distance?.amount ?? '?'}-ft sphere`;
  return null;
}

function durationText(duration) {
  if (!duration || !duration[0]) return null;
  const d = duration[0];
  if (d.type === 'instant') return 'Instantaneous';
  if (d.type === 'permanent') return 'Permanent';
  if (d.type === 'special') return 'Special';
  if (d.type === 'timed') {
    const conc = d.concentration ? 'Concentration, up to ' : '';
    return `${conc}${d.duration?.amount ?? '?'} ${d.duration?.type ?? ''}`;
  }
  return null;
}

function isConcentration(duration) {
  return duration?.some(d => d.concentration) ?? false;
}

function extractClassList(spell) {
  const classes = new Set();
  // From classes array
  if (Array.isArray(spell.classes?.fromClassList)) {
    spell.classes.fromClassList.forEach(c => classes.add(c.name.toLowerCase()));
  }
  if (Array.isArray(spell.classes?.fromClassListVariant)) {
    spell.classes.fromClassListVariant.forEach(c => classes.add(c.name.toLowerCase()));
  }
  // From subclasses
  if (Array.isArray(spell.classes?.fromSubclass)) {
    spell.classes.fromSubclass.forEach(s => classes.add(s.class.name.toLowerCase()));
  }
  return JSON.stringify([...classes]);
}

function getSlotsForProgression(progression, level, className) {
  const cls = (className || '').toLowerCase();
  switch (progression) {
    case 'full': return FULL_CASTER_SLOTS[level] || null;
    case 'half': {
      // Artificer starts slot progression at level 1 (half-caster rounded up).
      if (cls === 'artificer') return FULL_CASTER_SLOTS[Math.ceil(level / 2)] || null;
      return HALF_CASTER_SLOTS[level] || null;
    }
    case '1/3': return THIRD_CASTER_SLOTS[level] || null;
    case 'pact': {
      const p = PACT_MAGIC[level];
      if (!p) return null;
      // Return as sparse array where index = slot_level - 1
      const arr = [0,0,0,0,0,0,0,0,0];
      arr[p.slot_level - 1] = p.slots;
      return arr;
    }
    default: return null;
  }
}

function detectCasterProgression(cls) {
  const name = cls.name?.toLowerCase();
  // Warlock uses pact magic
  if (name === 'warlock') return 'pact';
  // Explicitly check known half and third casters
  const half = ['paladin','ranger','artificer'];
  const third = ['eldritch knight','arcane trickster'];
  if (half.includes(name)) return 'half';
  if (third.some(t => name?.includes(t))) return '1/3';
  // If it has spellcastingAbility, assume full
  if (cls.spellcastingAbility) return 'full';
  return null;
}

function extractCantripProgression(cls) {
  // Find cantripProgression array in classTableGroups or on class itself
  if (Array.isArray(cls.cantripProgression)) return cls.cantripProgression;
  for (const grp of (cls.classTableGroups || [])) {
    if (grp.title?.toLowerCase().includes('cantrip')) {
      return grp.rowsArray?.[0] ?? null;
    }
  }
  return null;
}

function extractSpellsKnownProgression(cls) {
  if (Array.isArray(cls.spellsKnownProgression)) return cls.spellsKnownProgression;
  if (Array.isArray(cls.spellsKnownProgressionFixed)) return cls.spellsKnownProgressionFixed;
  return null;
}

function cloneJSON(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

function normalizeSpeed(speed) {
  if (speed == null) return { walk: 30 };
  if (typeof speed === 'number') return { walk: speed };
  if (typeof speed === 'object') return speed;
  return { walk: 30 };
}

function applyEntriesMod(entries, mod) {
  let result = Array.isArray(entries) ? cloneJSON(entries) : [];
  if (!mod) return result;
  const ops = Array.isArray(mod) ? mod : [mod];
  for (const op of ops) {
    const mode = op?.mode;
    const items = op?.items === undefined ? [] : (Array.isArray(op.items) ? op.items : [op.items]);
    if (mode === 'replaceArr') {
      const replaceName = op?.replace;
      if (!replaceName) continue;
      const idx = result.findIndex(e => e?.name === replaceName);
      if (idx === -1) result.push(...items);
      else result.splice(idx, 1, ...items);
      continue;
    }
    if (mode === 'appendArr') {
      result.push(...items);
      continue;
    }
    if (mode === 'removeArr') {
      const names = op?.names ? (Array.isArray(op.names) ? op.names : [op.names]) : [];
      if (!names.length) continue;
      result = result.filter(e => !names.includes(e?.name));
    }
  }
  return result;
}

function buildRaceKey(race) {
  return `${race?.name ?? ''}|${race?.source ?? ''}`;
}

function buildSubraceKey(race) {
  return `${race?.name ?? ''}|${race?.source ?? ''}|${race?.raceName ?? ''}|${race?.raceSource ?? ''}`;
}

function resolveRaceCopy(race, raceMap, cache) {
  const key = buildRaceKey(race);
  if (cache.has(key)) return cloneJSON(cache.get(key));

  if (!race?._copy) {
    const result = cloneJSON(race);
    if (result) delete result._copy;
    cache.set(key, result);
    return cloneJSON(result);
  }

  const copyKey = buildRaceKey(race._copy);
  const base = raceMap.get(copyKey);
  if (!base) {
    console.warn(`  Warning: race copy base not found: ${copyKey}`);
    const result = cloneJSON(race);
    if (result) delete result._copy;
    cache.set(key, result);
    return cloneJSON(result);
  }

  const baseResolved = resolveRaceCopy(base, raceMap, cache);
  const result = cloneJSON(baseResolved);
  if (race._copy._mod?.entries) {
    result.entries = applyEntriesMod(result.entries, race._copy._mod.entries);
  }
  for (const [k, v] of Object.entries(race)) {
    if (k === '_copy') continue;
    result[k] = cloneJSON(v);
  }
  delete result._copy;
  cache.set(key, result);
  return cloneJSON(result);
}

function resolveSubraceCopy(race, subraceMap, cache) {
  const key = buildSubraceKey(race);
  if (cache.has(key)) return cloneJSON(cache.get(key));

  if (!race?._copy) {
    const result = cloneJSON(race);
    if (result) delete result._copy;
    cache.set(key, result);
    return cloneJSON(result);
  }

  const copyKey = buildSubraceKey(race._copy);
  const base = subraceMap.get(copyKey);
  if (!base) {
    console.warn(`  Warning: subrace copy base not found: ${copyKey}`);
    const result = cloneJSON(race);
    if (result) delete result._copy;
    cache.set(key, result);
    return cloneJSON(result);
  }

  const baseResolved = resolveSubraceCopy(base, subraceMap, cache);
  const result = cloneJSON(baseResolved);
  if (race._copy._mod?.entries) {
    result.entries = applyEntriesMod(result.entries, race._copy._mod.entries);
  }
  for (const [k, v] of Object.entries(race)) {
    if (k === '_copy') continue;
    result[k] = cloneJSON(v);
  }
  delete result._copy;
  cache.set(key, result);
  return cloneJSON(result);
}


function buildClassSpecific(cls, level) {
  const specific = {};
  const name = cls.name?.toLowerCase();

  // Walk classTableGroups for class-specific columns
  for (const grp of (cls.classTableGroups || [])) {
    const title = grp.title?.toLowerCase() ?? '';
    if (title.includes('cantrip') || title.includes('spell')) continue;
    const rows = grp.rowsArray ?? grp.rows ?? [];
    const levelRow = rows[level - 1];
    if (levelRow === undefined) continue;
    // Normalize title to a key
    const key = grp.title?.replace(/\s+/g, '_').toLowerCase() ?? 'extra';
    specific[key] = Array.isArray(levelRow) ? levelRow[0] : levelRow;
  }
  return Object.keys(specific).length ? JSON.stringify(specific) : null;
}

// ── Seeding functions ─────────────────────────────────────────────

const insertClass = db.prepare(`
  INSERT INTO classes (name, source, hit_die, spellcasting_ability, caster_progression, save_proficiencies, data_json)
  VALUES (@name, @source, @hit_die, @spellcasting_ability, @caster_progression, @save_proficiencies, @data_json)
  ON CONFLICT(name, source) DO UPDATE SET
    hit_die=excluded.hit_die,
    spellcasting_ability=excluded.spellcasting_ability,
    caster_progression=excluded.caster_progression,
    save_proficiencies=excluded.save_proficiencies,
    data_json=excluded.data_json
`);

const insertSubclass = db.prepare(`
  INSERT INTO subclasses (class_id, name, short_name, source, data_json)
  VALUES (@class_id, @name, @short_name, @source, @data_json)
  ON CONFLICT(class_id, name, source) DO UPDATE SET
    short_name=excluded.short_name,
    data_json=excluded.data_json
`);

const insertFeature = db.prepare(`
  INSERT INTO class_features (class_id, subclass_id, level, name, entries_json, is_subclass_feature, header)
  VALUES (@class_id, @subclass_id, @level, @name, @entries_json, @is_subclass_feature, @header)
`);

const insertProgression = db.prepare(`
  INSERT OR REPLACE INTO class_progression (class_id, level, proficiency_bonus, spell_slots_json, cantrips_known, spells_known, class_specific_json)
  VALUES (@class_id, @level, @proficiency_bonus, @spell_slots_json, @cantrips_known, @spells_known, @class_specific_json)
`);

const insertRace = db.prepare(`
  INSERT INTO races (name, source, parent_race_id, speed_json, ability_json, darkvision, trait_tags, data_json)
  VALUES (@name, @source, @parent_race_id, @speed_json, @ability_json, @darkvision, @trait_tags, @data_json)
  ON CONFLICT(name, source) DO UPDATE SET
    parent_race_id=excluded.parent_race_id,
    speed_json=excluded.speed_json,
    ability_json=excluded.ability_json,
    darkvision=excluded.darkvision,
    trait_tags=excluded.trait_tags,
    data_json=excluded.data_json
`);

const insertSpell = db.prepare(`
  INSERT INTO spells (name, source, level, school, casting_time, range_text, components_json, duration_text, concentration, ritual, damage_types, saving_throws, class_list, data_json)
  VALUES (@name, @source, @level, @school, @casting_time, @range_text, @components_json, @duration_text, @concentration, @ritual, @damage_types, @saving_throws, @class_list, @data_json)
  ON CONFLICT(name, source) DO UPDATE SET
    level=excluded.level,
    school=excluded.school,
    casting_time=excluded.casting_time,
    range_text=excluded.range_text,
    components_json=excluded.components_json,
    duration_text=excluded.duration_text,
    concentration=excluded.concentration,
    ritual=excluded.ritual,
    damage_types=excluded.damage_types,
    saving_throws=excluded.saving_throws,
    class_list=excluded.class_list,
    data_json=excluded.data_json
`);

const insertWeapon = db.prepare(`
  INSERT INTO weapons (name, source, category, damage_dice, damage_type, properties_json, data_json)
  VALUES (@name, @source, @category, @damage_dice, @damage_type, @properties_json, @data_json)
  ON CONFLICT(name, source) DO UPDATE SET
    category=excluded.category,
    damage_dice=excluded.damage_dice,
    damage_type=excluded.damage_type,
    properties_json=excluded.properties_json,
    data_json=excluded.data_json
`);

const insertFeat = db.prepare(`
  INSERT INTO feats (name, source, prerequisites_json, ability_json, data_json)
  VALUES (@name, @source, @prerequisites_json, @ability_json, @data_json)
  ON CONFLICT(name, source) DO UPDATE SET
    prerequisites_json=excluded.prerequisites_json,
    ability_json=excluded.ability_json,
    data_json=excluded.data_json
`);

const insertBackground = db.prepare(`
  INSERT INTO backgrounds (name, source, skill_proficiencies, tool_proficiencies, language_proficiencies, data_json)
  VALUES (@name, @source, @skill_proficiencies, @tool_proficiencies, @language_proficiencies, @data_json)
  ON CONFLICT(name, source) DO UPDATE SET
    skill_proficiencies=excluded.skill_proficiencies,
    tool_proficiencies=excluded.tool_proficiencies,
    language_proficiencies=excluded.language_proficiencies,
    data_json=excluded.data_json
`);

const insertOptionalFeature = db.prepare(`
  INSERT INTO optional_features (name, source, feature_types_json, prerequisites_json, data_json)
  VALUES (@name, @source, @feature_types_json, @prerequisites_json, @data_json)
  ON CONFLICT(name, source) DO UPDATE SET
    feature_types_json=excluded.feature_types_json,
    prerequisites_json=excluded.prerequisites_json,
    data_json=excluded.data_json
`);


const setSeedMeta = db.prepare(`
  INSERT OR REPLACE INTO seed_meta (key, value, updated_at) VALUES (@key, @value, datetime('now'))
`);

async function seedClasses() {
  console.log('Seeding classes...');
  const index = await fetchJSON(`${BASE}/class/index.json`);

  for (const [className, fileName] of Object.entries(index)) {
    try {
      console.log(`  Fetching class: ${className}`);
      const data = await fetchJSON(`${BASE}/class/${fileName}`);

      for (const cls of (data.class || [])) {
        const progression = detectCasterProgression(cls);
        const saves = JSON.stringify(cls.proficiency || []);

        // Clear old features first (idempotent re-seed)
        const existingClass = db.prepare('SELECT id FROM classes WHERE name = ? AND source = ?').get(cls.name, cls.source);
        if (existingClass) {
          db.prepare('DELETE FROM class_features WHERE class_id = ? AND is_subclass_feature = 0').run(existingClass.id);
          db.prepare('DELETE FROM class_progression WHERE class_id = ?').run(existingClass.id);
        }

        insertClass.run({
          name: cls.name,
          source: cls.source,
          hit_die: cls.hd?.faces ?? 8,
          spellcasting_ability: cls.spellcastingAbility ?? null,
          caster_progression: progression,
          save_proficiencies: saves,
          data_json: JSON.stringify(cls),
        });

        const classRow = db.prepare('SELECT id FROM classes WHERE name = ? AND source = ?').get(cls.name, cls.source);
        const classId = classRow.id;

        // Build progression rows
        const cantripProg = extractCantripProgression(cls);
        const spellsKnownProg = extractSpellsKnownProgression(cls);

        for (let level = 1; level <= 20; level++) {
          const slots = getSlotsForProgression(progression, level, cls.name);
          insertProgression.run({
            class_id: classId,
            level,
            proficiency_bonus: PROF_BONUS[level],
            spell_slots_json: slots ? JSON.stringify(slots) : null,
            cantrips_known: cantripProg ? (cantripProg[level - 1] ?? null) : null,
            spells_known: spellsKnownProg ? (spellsKnownProg[level - 1] ?? null) : null,
            class_specific_json: buildClassSpecific(cls, level),
          });
        }

        // Insert base class features
        for (const feat of (data.classFeature || [])) {
          if (feat.className !== cls.name) continue;
          insertFeature.run({
            class_id: classId,
            subclass_id: null,
            level: feat.level,
            name: feat.name,
            entries_json: JSON.stringify(feat.entries || []),
            is_subclass_feature: 0,
            header: feat.header ?? 1,
          });
        }

        // Insert subclasses and their features
        for (const sub of (data.subclass || [])) {
          if (sub.className !== cls.name) continue;

          const existingSub = db.prepare('SELECT id FROM subclasses WHERE class_id = ? AND name = ? AND source = ?').get(classId, sub.name, sub.source);
          if (existingSub) {
            db.prepare('DELETE FROM class_features WHERE subclass_id = ?').run(existingSub.id);
          }

          insertSubclass.run({
            class_id: classId,
            name: sub.name,
            short_name: sub.shortName,
            source: sub.source,
            data_json: JSON.stringify(sub),
          });

          const subRow = db.prepare('SELECT id FROM subclasses WHERE class_id = ? AND name = ? AND source = ?').get(classId, sub.name, sub.source);
          const subId = subRow.id;

          for (const feat of (data.subclassFeature || [])) {
            if (feat.className !== cls.name) continue;
            if (feat.subclassShortName !== sub.shortName) continue;

            insertFeature.run({
              class_id: classId,
              subclass_id: subId,
              level: feat.level,
              name: feat.name,
              entries_json: JSON.stringify(feat.entries || []),
              is_subclass_feature: 1,
              header: feat.header ?? 1,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`  Warning: failed to seed class ${className}: ${err.message}`);
    }
  }
}

async function seedRaces() {
  console.log('Seeding races...');
  try {
    const data = await fetchJSON(`${BASE}/races.json`);
    const raceList = data.race || [];
    const subraceList = data.subrace || [];

    // Resolve base races (including _copy) and expand _versions
    const baseRacesRaw = raceList.filter(r => !r.raceName);
    const baseRaceMap = new Map(baseRacesRaw.map(r => [buildRaceKey(r), r]));
    const baseRaceCache = new Map();
    const baseRacesResolved = [];

    for (const race of baseRacesRaw) {
      const resolved = resolveRaceCopy(race, baseRaceMap, baseRaceCache);
      if (resolved) baseRacesResolved.push(resolved);

      for (const version of (race._versions || [])) {
        if (version._abstract) continue;
        const baseClone = cloneJSON(resolved);
        const modEntries = version._mod?.entries;
        const entries = applyEntriesMod(baseClone.entries, modEntries);
        const merged = { ...baseClone, ...cloneJSON(version), entries };
        delete merged._mod;
        delete merged._abstract;
        delete merged._versions;
        baseRacesResolved.push(merged);
      }
    }

    const baseRacesByName = new Map();
    for (const race of baseRacesResolved) {
      if (race?.name && !baseRacesByName.has(race.name)) baseRacesByName.set(race.name, race);
      const speed = normalizeSpeed(race.speed);
      insertRace.run({
        name: race.name,
        source: race.source,
        parent_race_id: null,
        speed_json: JSON.stringify(speed),
        ability_json: JSON.stringify(race.ability || []),
        darkvision: race.darkvision ?? 0,
        trait_tags: JSON.stringify(race.traitTags || []),
        data_json: JSON.stringify(race),
      });
    }

    // 5etools subrace `ability` arrays hold only the subrace's additional
    // increase; the base race's increases still apply and must be combined
    // (Hill Dwarf = +2 CON from Dwarf plus +1 WIS from Hill).
    function mergeSubraceAbility(parentAbility, subAbility) {
      const parent = Array.isArray(parentAbility) ? parentAbility : [];
      const sub = Array.isArray(subAbility) ? subAbility : [];
      if (!parent.length) return sub;
      if (!sub.length) return parent;
      const numeric = {};
      const extras = [];
      for (const entry of [...parent, ...sub]) {
        if (!entry || typeof entry !== 'object') continue;
        for (const [key, val] of Object.entries(entry)) {
          if (typeof val === 'number') numeric[key] = (numeric[key] || 0) + val;
          else extras.push({ [key]: val });
        }
      }
      const merged = [];
      if (Object.keys(numeric).length) merged.push(numeric);
      merged.push(...extras);
      return merged;
    }

    // Resolve subraces (including _copy), and inherit base fields for summary columns
    const subracesRaw = [...subraceList, ...raceList.filter(r => r.raceName)];
    const subraceMap = new Map(subracesRaw.map(r => [buildSubraceKey(r), r]));
    const subraceCache = new Map();
    const subracesResolved = subracesRaw.map(r => resolveSubraceCopy(r, subraceMap, subraceCache));

    for (const race of subracesResolved) {
      const parentRow = db.prepare('SELECT id FROM races WHERE name = ? AND parent_race_id IS NULL').get(race.raceName);
      const parentRace = baseRacesByName.get(race.raceName);
      const speed = normalizeSpeed(race.speed ?? parentRace?.speed);
      const ability = mergeSubraceAbility(parentRace?.ability, race.ability);
      const darkvision = race.darkvision ?? parentRace?.darkvision ?? 0;
      const traitTags = race.traitTags ?? parentRace?.traitTags ?? [];

      insertRace.run({
        name: `${race.raceName} (${race.name})`,
        source: race.source,
        parent_race_id: parentRow?.id ?? null,
        speed_json: JSON.stringify(speed),
        ability_json: JSON.stringify(ability),
        darkvision,
        trait_tags: JSON.stringify(traitTags),
        data_json: JSON.stringify(race),
      });
    }
  } catch (err) {
    console.warn(`  Warning: failed to seed races: ${err.message}`);
  }
}

async function seedSpells() {
  console.log('Seeding spells...');
  try {
    // Load the class-spell association map from sources.json
    // Format: { "PHB": { "Hex": { "class": [{name, source}], "subclass": [...] } } }
    let spellSources = {};
    try {
      spellSources = await fetchJSON(`${BASE}/spells/sources.json`);
    } catch (err) {
      console.warn('  Warning: could not load spell sources.json:', err.message);
    }

    // Build a flat lookup: "SpellName|SOURCE" -> Set of class names (lowercase)
    const spellClassMap = {};
    for (const [bookSource, spells] of Object.entries(spellSources)) {
      for (const [spellName, assoc] of Object.entries(spells)) {
        const key = `${spellName}|${bookSource}`;
        const classes = new Set();
        for (const cls of (assoc.class || [])) {
          classes.add(cls.name.toLowerCase());
        }
        for (const cls of (assoc.classVariant || [])) {
          if (cls?.name) classes.add(cls.name.toLowerCase());
        }
        // Also include subclass parent classes
        for (const sub of (assoc.subclass || [])) {
          if (sub.class?.name) classes.add(sub.class.name.toLowerCase());
        }
        for (const sub of (assoc.subclassVariant || [])) {
          if (sub.class?.name) classes.add(sub.class.name.toLowerCase());
        }
        spellClassMap[key] = classes;
      }
    }

    const index = await fetchJSON(`${BASE}/spells/index.json`);
    for (const [source, fileName] of Object.entries(index)) {
      try {
        console.log(`  Fetching spells: ${source}`);
        const data = await fetchJSON(`${BASE}/spells/${fileName}`);
        for (const spell of (data.spell || [])) {
          if (spell._copy) continue;

          // Look up class list from sources.json first, fall back to inline data
          const key = `${spell.name}|${spell.source}`;
          let classList;
          if (spellClassMap[key] && spellClassMap[key].size > 0) {
            classList = JSON.stringify([...spellClassMap[key]]);
          } else {
            classList = extractClassList(spell);
          }

          insertSpell.run({
            name: spell.name,
            source: spell.source,
            level: spell.level,
            school: spell.school,
            casting_time: castingTimeText(spell.time),
            range_text: rangeText(spell.range),
            components_json: JSON.stringify(spell.components || {}),
            duration_text: durationText(spell.duration),
            concentration: isConcentration(spell.duration) ? 1 : 0,
            ritual: spell.ritual ? 1 : 0,
            damage_types: JSON.stringify(spell.damageInflict || []),
            saving_throws: JSON.stringify(spell.savingThrow || []),
            class_list: classList,
            data_json: JSON.stringify(spell),
          });
        }
      } catch (err) {
        console.warn(`  Warning: failed to seed spells from ${source}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`  Warning: failed to seed spells: ${err.message}`);
  }
}

async function seedWeapons() {
  console.log('Seeding weapons...');
  try {
    const data = await fetchJSON(`${BASE}/items.json`);
    for (const item of (data.item || [])) {
      if (item._copy) continue;
      const isWeapon = !!(item.weaponCategory || item.type === 'M' || item.type === 'R' || item.weapon);
      if (!isWeapon) continue;
      const damageDice = item.dmg1 || item.dmg2 || null;
      if (!damageDice) continue;
      const category = item.weaponCategory || (item.type === 'M' ? 'melee' : item.type === 'R' ? 'ranged' : null);
      insertWeapon.run({
        name: item.name,
        source: item.source,
        category,
        damage_dice: damageDice,
        damage_type: item.dmgType || null,
        properties_json: JSON.stringify(item.property || []),
        data_json: JSON.stringify(item),
      });
    }
  } catch (err) {
    console.warn(`  Warning: failed to seed weapons: ${err.message}`);
  }
}

async function seedFeats() {
  console.log('Seeding feats...');
  try {
    const data = await fetchJSON(`${BASE}/feats.json`);
    for (const feat of (data.feat || [])) {
      if (feat._copy) continue;
      insertFeat.run({
        name: feat.name,
        source: feat.source,
        prerequisites_json: JSON.stringify(feat.prerequisite || []),
        ability_json: JSON.stringify(feat.ability || []),
        data_json: JSON.stringify(feat),
      });
    }
  } catch (err) {
    console.warn(`  Warning: failed to seed feats: ${err.message}`);
  }
}

async function seedBackgrounds() {
  console.log('Seeding backgrounds...');
  try {
    const data = await fetchJSON(`${BASE}/backgrounds.json`);
    for (const bg of (data.background || [])) {
      if (bg._copy) continue;
      insertBackground.run({
        name: bg.name,
        source: bg.source,
        skill_proficiencies: JSON.stringify(bg.skillProficiencies || []),
        tool_proficiencies: JSON.stringify(bg.toolProficiencies || []),
        language_proficiencies: JSON.stringify(bg.languageProficiencies || []),
        data_json: JSON.stringify(bg),
      });
    }
  } catch (err) {
    console.warn(`  Warning: failed to seed backgrounds: ${err.message}`);
  }
}

async function seedOptionalFeatures() {
  console.log('Seeding optional features...');
  try {
    const data = await fetchJSON(`${BASE}/optionalfeatures.json`);
    for (const feat of (data.optionalfeature || [])) {
      if (feat._copy) continue;
      insertOptionalFeature.run({
        name: feat.name,
        source: feat.source,
        feature_types_json: JSON.stringify(feat.featureType || []),
        prerequisites_json: JSON.stringify(feat.prerequisite || []),
        data_json: JSON.stringify(feat),
      });
    }
  } catch (err) {
    console.warn(`  Warning: failed to seed optional features: ${err.message}`);
  }
}


async function seedHomebrewSubclasses() {
  console.log('Seeding homebrew subclasses...');
  for (const url of HOMEBREW_SUBCLASS_URLS) {
    try {
      const data = await fetchJSON(url);
      for (const sub of (data.subclass || [])) {
        const cls = db.prepare('SELECT id FROM classes WHERE name = ?').get(sub.className);
        if (!cls) continue;

        insertSubclass.run({
          class_id: cls.id,
          name: sub.name,
          short_name: sub.shortName,
          source: sub.source,
          data_json: JSON.stringify(sub),
        });

        const subRow = db.prepare('SELECT id FROM subclasses WHERE class_id = ? AND name = ? AND source = ?').get(cls.id, sub.name, sub.source);
        if (!subRow) continue;

        db.prepare('DELETE FROM class_features WHERE subclass_id = ?').run(subRow.id);

        for (const feat of (data.subclassFeature || [])) {
          if (feat.className !== sub.className) continue;
          if (feat.subclassShortName !== sub.shortName) continue;
          insertFeature.run({
            class_id: cls.id,
            subclass_id: subRow.id,
            level: feat.level,
            name: feat.name,
            entries_json: JSON.stringify(feat.entries || []),
            is_subclass_feature: 1,
            header: feat.header ?? 1,
          });
        }
      }
    } catch (err) {
      console.warn(`  Warning: failed to seed homebrew subclasses from ${url}: ${err.message}`);
    }
  }
}

/**
 * Main seed function that fetches all 5e.tools data and populates the database.
 * Seeds classes, races, spells, feats, backgrounds, optional features, weapons, and effects.
 * @async
 * @returns {Promise<void>}
 */
async function main() {
  console.log('Starting 5e.tools data seed...');
  const start = Date.now();

  await seedClasses();
  await seedRaces();
  await seedSpells();
  await seedWeapons();
  await seedFeats();
  await seedBackgrounds();
  await seedOptionalFeatures();
  await seedHomebrewSubclasses();
  await seedEffectDefinitions({ allSources: true });

  setSeedMeta.run({ key: 'seeded_at', value: new Date().toISOString() });
  setSeedMeta.run({ key: 'source', value: 'github:5etools-mirror-3/5etools-2014-src' });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nSeed complete in ${elapsed}s`);
  console.log(`  Classes:     ${db.prepare('SELECT COUNT(*) as n FROM classes').get().n}`);
  console.log(`  Subclasses:  ${db.prepare('SELECT COUNT(*) as n FROM subclasses').get().n}`);
  console.log(`  Features:    ${db.prepare('SELECT COUNT(*) as n FROM class_features').get().n}`);
  console.log(`  Races:       ${db.prepare('SELECT COUNT(*) as n FROM races').get().n}`);
  console.log(`  Spells:      ${db.prepare('SELECT COUNT(*) as n FROM spells').get().n}`);
  console.log(`  Weapons:     ${db.prepare('SELECT COUNT(*) as n FROM weapons').get().n}`);
  console.log(`  Feats:       ${db.prepare('SELECT COUNT(*) as n FROM feats').get().n}`);
  console.log(`  Backgrounds: ${db.prepare('SELECT COUNT(*) as n FROM backgrounds').get().n}`);
  console.log(`  Optional:    ${db.prepare('SELECT COUNT(*) as n FROM optional_features').get().n}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
