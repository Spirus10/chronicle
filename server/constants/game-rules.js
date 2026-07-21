/**
 * @fileoverview Game rule constants for D&D 5e mechanics.
 * Defines ability scores, spell schools, and level bounds.
 */
'use strict';

const ABILITY_NAMES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_FULL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SPELL_SCHOOLS = ['ABJURATION', 'CONJURATION', 'DIVINATION', 'ENCHANTMENT', 'EVOCATION', 'ILLUSION', 'NECROMANCY', 'TRANSMUTATION'];
const MAX_LEVEL = 20;
const MIN_LEVEL = 1;

module.exports = { ABILITY_NAMES, ABILITY_FULL, SPELL_SCHOOLS, MAX_LEVEL, MIN_LEVEL };
