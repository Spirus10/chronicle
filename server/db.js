/**
 * @fileoverview Database initialization and migration module.
 * Sets up SQLite database connection, applies schema migrations, and exports the database instance.
 */
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tracker.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

/**
 * Initializes database schema and applies migrations.
 * Creates all necessary tables for game data, users, campaigns, and character state.
 * Handles schema upgrades for backward compatibility.
 * @returns {void}
 */
function migrate() {
  db.exec(`
    -- ── SEEDED GAME DATA ──────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS classes (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      name                 TEXT NOT NULL,
      source               TEXT NOT NULL,
      hit_die              INTEGER NOT NULL,
      spellcasting_ability TEXT,
      caster_progression   TEXT,
      save_proficiencies   TEXT,
      data_json            TEXT NOT NULL,
      UNIQUE(name, source)
    );

    CREATE TABLE IF NOT EXISTS subclasses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id   INTEGER NOT NULL REFERENCES classes(id),
      name       TEXT NOT NULL,
      short_name TEXT NOT NULL,
      source     TEXT NOT NULL,
      data_json  TEXT NOT NULL,
      UNIQUE(class_id, name, source)
    );

    CREATE TABLE IF NOT EXISTS class_features (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id            INTEGER NOT NULL REFERENCES classes(id),
      subclass_id         INTEGER REFERENCES subclasses(id),
      level               INTEGER NOT NULL,
      name                TEXT NOT NULL,
      entries_json        TEXT NOT NULL,
      is_subclass_feature INTEGER NOT NULL DEFAULT 0,
      header              INTEGER NOT NULL DEFAULT 1
    );

    -- Denormalized progression table: one row per class+level
    CREATE TABLE IF NOT EXISTS class_progression (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id             INTEGER NOT NULL REFERENCES classes(id),
      level                INTEGER NOT NULL,
      proficiency_bonus    INTEGER NOT NULL,
      spell_slots_json     TEXT,
      cantrips_known       INTEGER,
      spells_known         INTEGER,
      class_specific_json  TEXT,
      UNIQUE(class_id, level)
    );

    CREATE TABLE IF NOT EXISTS races (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      source         TEXT NOT NULL,
      parent_race_id INTEGER REFERENCES races(id),
      speed_json     TEXT,
      ability_json   TEXT,
      darkvision     INTEGER NOT NULL DEFAULT 0,
      trait_tags     TEXT,
      data_json      TEXT NOT NULL,
      UNIQUE(name, source)
    );

    CREATE TABLE IF NOT EXISTS spells (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      source          TEXT NOT NULL,
      level           INTEGER NOT NULL,
      school          TEXT NOT NULL,
      casting_time    TEXT,
      range_text      TEXT,
      components_json TEXT,
      duration_text   TEXT,
      concentration   INTEGER NOT NULL DEFAULT 0,
      ritual          INTEGER NOT NULL DEFAULT 0,
      damage_types    TEXT,
      saving_throws   TEXT,
      class_list      TEXT,
      data_json       TEXT NOT NULL,
      UNIQUE(name, source)
    );

    CREATE TABLE IF NOT EXISTS feats (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      source            TEXT NOT NULL,
      prerequisites_json TEXT,
      ability_json      TEXT,
      data_json         TEXT NOT NULL,
      UNIQUE(name, source)
    );

    CREATE TABLE IF NOT EXISTS backgrounds (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT NOT NULL,
      source                TEXT NOT NULL,
      skill_proficiencies   TEXT,
      tool_proficiencies    TEXT,
      language_proficiencies TEXT,
      data_json             TEXT NOT NULL,
      UNIQUE(name, source)
    );

    CREATE TABLE IF NOT EXISTS optional_features (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      source             TEXT NOT NULL,
      feature_types_json TEXT NOT NULL,
      prerequisites_json TEXT,
      data_json          TEXT NOT NULL,
      UNIQUE(name, source)
    );

    -- ── EFFECT DEFINITIONS ───────────────────────────────────────

    CREATE TABLE IF NOT EXISTS effect_definitions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      source_type   TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      scope         TEXT NOT NULL,
      kind          TEXT NOT NULL,
      priority      INTEGER NOT NULL DEFAULT 0,
      duration_type TEXT NOT NULL,
      tags_json     TEXT NOT NULL DEFAULT '[]',
      effect_json   TEXT NOT NULL,
      UNIQUE(source_type, source_id, name)
    );

    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role         TEXT NOT NULL CHECK(role IN ('dm', 'player')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash    TEXT NOT NULL UNIQUE,
      expires_at    TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      join_code     TEXT NOT NULL UNIQUE,
      dm_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campaign_members (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      player_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(campaign_id, player_user_id)
    );

    -- ── USER DATA ─────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS characters (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      name                   TEXT NOT NULL,
      owner_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      campaign_id            INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
      class_id               INTEGER REFERENCES classes(id),
      subclass_id            INTEGER REFERENCES subclasses(id),
      race_id                INTEGER REFERENCES races(id),
      background_id          INTEGER REFERENCES backgrounds(id),
      level                  INTEGER NOT NULL DEFAULT 1,
      experience_points      INTEGER NOT NULL DEFAULT 0,
      alignment              TEXT,
      ability_scores_json    TEXT NOT NULL DEFAULT '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
      stat_overrides_json    TEXT NOT NULL DEFAULT '{}',
      skill_proficiencies_json TEXT NOT NULL DEFAULT '{}',
      spellcasting_type      TEXT,
      spellbook_json         TEXT NOT NULL DEFAULT '[]',
      spells_known_json      TEXT NOT NULL DEFAULT '[]',
      feats_json             TEXT NOT NULL DEFAULT '[]',
      backstory              TEXT NOT NULL DEFAULT '',
      personality_traits     TEXT NOT NULL DEFAULT '',
      ideals                 TEXT NOT NULL DEFAULT '',
      bonds                  TEXT NOT NULL DEFAULT '',
      flaws                  TEXT NOT NULL DEFAULT '',
      appearance             TEXT NOT NULL DEFAULT '',
      portrait_url           TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Future multiclass support
    CREATE TABLE IF NOT EXISTS character_classes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      class_id     INTEGER NOT NULL REFERENCES classes(id),
      subclass_id  INTEGER REFERENCES subclasses(id),
      level        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_state (
      character_id          INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      hp_current            INTEGER NOT NULL DEFAULT 0,
      hp_temp               INTEGER NOT NULL DEFAULT 0,
      hp_temp_source        TEXT,
      spell_slots_used_json TEXT NOT NULL DEFAULT '{}',
      hit_dice_used_json    TEXT NOT NULL DEFAULT '[]',
      prepared_spells_json  TEXT NOT NULL DEFAULT '[]',
      concentration         TEXT,
      active_effects_json   TEXT NOT NULL DEFAULT '[]',
      conditions_json       TEXT NOT NULL DEFAULT '{}',
      class_resources_json  TEXT NOT NULL DEFAULT '{}',
      combat_active         INTEGER NOT NULL DEFAULT 0,
      combat_round          INTEGER NOT NULL DEFAULT 0,
      death_saves_json      TEXT NOT NULL DEFAULT '{"successes":0,"failures":0}',
      log_json              TEXT NOT NULL DEFAULT '[]',
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      quantity     INTEGER NOT NULL DEFAULT 1,
      weight       REAL,
      value_gp     REAL,
      equipped     INTEGER NOT NULL DEFAULT 0,
      item_type    TEXT NOT NULL DEFAULT 'misc',
      weapon_damage TEXT,
      weapon_atk_bonus INTEGER,
      notes        TEXT NOT NULL DEFAULT '',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weapons (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      source       TEXT NOT NULL,
      category     TEXT,
      damage_dice  TEXT,
      damage_type  TEXT,
      properties_json TEXT,
      data_json    TEXT NOT NULL,
      UNIQUE(name, source)
    );

    CREATE TABLE IF NOT EXISTS currency (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      cp           INTEGER NOT NULL DEFAULT 0,
      sp           INTEGER NOT NULL DEFAULT 0,
      ep           INTEGER NOT NULL DEFAULT 0,
      gp           INTEGER NOT NULL DEFAULT 0,
      pp           INTEGER NOT NULL DEFAULT 0
    );

    -- Seed metadata flag
    CREATE TABLE IF NOT EXISTS seed_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Indexes on foreign key columns for query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_campaign_members_campaign_id ON campaign_members(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_members_player_user_id ON campaign_members(player_user_id);
    CREATE INDEX IF NOT EXISTS idx_character_state_character_id ON character_state(character_id);
    CREATE INDEX IF NOT EXISTS idx_characters_owner_user_id ON characters(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_characters_campaign_id ON characters(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_character_id ON inventory(character_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_spells_name ON spells(name);
  `);

  const inventoryCols = db.prepare('PRAGMA table_info(inventory)').all().map(c => c.name);
  if (!inventoryCols.includes('weapon_damage')) {
    db.exec('ALTER TABLE inventory ADD COLUMN weapon_damage TEXT');
  }
  if (!inventoryCols.includes('weapon_atk_bonus')) {
    db.exec('ALTER TABLE inventory ADD COLUMN weapon_atk_bonus INTEGER');
  }

  const characterCols = db.prepare('PRAGMA table_info(characters)').all().map(c => c.name);
  if (!characterCols.includes('owner_user_id')) {
    db.exec('ALTER TABLE characters ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  }
  if (!characterCols.includes('campaign_id')) {
    db.exec('ALTER TABLE characters ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL');
  }

  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (userCols.length && !userCols.includes('username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  }
}

migrate();

module.exports = db;
