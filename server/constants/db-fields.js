/**
 * @fileoverview Database field name mappings for JSON columns.
 * Maps camelCase property names to their snake_case database column equivalents.
 */
'use strict';

const JSON_FIELDS = {
  spellSlots: 'spell_slots_json',
  activeEffects: 'active_effects_json',
  saveProficiencies: 'save_proficiencies_json',
  speed: 'speed_json',
  ability: 'ability_json',
  traitTags: 'trait_tags',
  featureTypes: 'feature_types_json',
  startingProficiencies: 'starting_proficiencies_json',
  languageProfs: 'language_proficiencies_json',
  toolProfs: 'tool_proficiencies_json',
  skillProfs: 'skill_proficiencies_json',
  entries: 'entries_json',
  additionalSpells: 'additional_spells_json',
};

module.exports = { JSON_FIELDS };
