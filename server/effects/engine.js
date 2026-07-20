/**
 * @fileoverview Effect engine for computing and applying character modifiers.
 * Evaluates effect conditions against context and collects applicable modifiers.
 */
'use strict';

/**
 * Normalizes an effect object to ensure all fields have default values.
 * @param {Object} [effect] - Raw effect definition
 * @returns {Object|null} Normalized effect object or null if input is invalid
 */
function normalizeEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  return {
    name: effect.name || 'Unnamed Effect',
    scope: effect.scope || 'actor',
    kind: effect.kind || 'passive',
    priority: Number.isInteger(effect.priority) ? effect.priority : 0,
    duration: effect.duration || { type: 'permanent' },
    conditions: Array.isArray(effect.conditions) ? effect.conditions : [],
    modifiers: Array.isArray(effect.modifiers) ? effect.modifiers : [],
    tags: Array.isArray(effect.tags) ? effect.tags : [],
    source: effect.source || null,
  };
}

/**
 * Normalizes a context object to ensure all fields have default values.
 * @param {Object} [context] - Raw context with actor, action, roll, target, state
 * @returns {Object} Normalized context object
 */
function normalizeContext(context) {
  return {
    actor: context?.actor || {},
    action: context?.action || {},
    roll: context?.roll || {},
    target: context?.target || {},
    state: context?.state || {},
  };
}

/**
 * Checks if a container object has a specific tag (case-insensitive).
 * @param {Object} container - Object with optional tags array
 * @param {string} tag - Tag to search for
 * @returns {boolean} True if tag is present
 */
function hasTag(container, tag) {
  const tags = Array.isArray(container?.tags) ? container.tags : [];
  return tags.map(t => String(t).toLowerCase()).includes(String(tag).toLowerCase());
}

/**
 * Normalizes a name string to lowercase trimmed form for comparison.
 * @param {string} value - Name to normalize
 * @returns {string} Lowercase trimmed name
 */
function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Evaluates whether a single condition matches the given context.
 * Supports action_name_is, spell_name_is, roll_type_is, target_has_condition, and more.
 * @param {Object} [condition] - Condition object with type and params
 * @param {Object} [context] - Context object with actor, action, roll, target, state
 * @returns {boolean} True if condition matches or is invalid/empty
 */
function conditionMatches(condition, context) {
  if (!condition || typeof condition !== 'object') return true;

  const type = String(condition.type || '').trim();
  const params = condition.params || {};
  const ctx = normalizeContext(context);

  switch (type) {
    case 'action_name_is':
      return normalizeName(ctx.action.name) === normalizeName(params.name);
    case 'spell_name_is':
      return normalizeName(ctx.action.name) === normalizeName(params.name);
    case 'roll_type_is':
      return normalizeName(ctx.roll.type) === normalizeName(params.type);
    case 'target_has_condition': {
      const conditions = ctx.target.conditions || {};
      const key = normalizeName(params.condition);
      if (!key) return false;
      if (params.source === 'actor') {
        const sourceId = ctx.actor?.id;
        const entry = conditions[key];
        if (entry && typeof entry === 'object') return entry.source_id === sourceId;
      }
      return !!conditions[key];
    }
    case 'actor_level_at_least':
      return (ctx.actor.level || 0) >= (params.level || 0);
    case 'actor_has_tag':
      return hasTag(ctx.actor, params.tag);
    case 'action_has_tag':
      return hasTag(ctx.action, params.tag);
    case 'target_has_tag':
      return hasTag(ctx.target, params.tag);
    case 'is_concentrating':
      return !!ctx.state.concentration;
    default:
      // Unknown condition types fail closed: a gated effect must never
      // silently degrade to "always applies" because of a typo or a
      // condition kind this engine version doesn't know yet.
      return false;
  }
}

/**
 * Determines if an effect applies given a context by checking all its conditions.
 * @param {Object} effect - Effect definition with conditions array
 * @param {Object} [context] - Context to evaluate conditions against
 * @returns {boolean} True if all conditions match
 */
function effectApplies(effect, context) {
  const normalized = normalizeEffect(effect);
  if (!normalized) return false;
  if (!normalized.conditions.length) return true;
  return normalized.conditions.every(condition => conditionMatches(condition, context));
}

/**
 * Sorts effects array by priority in descending order.
 * @param {Object[]} effects - Array of effect objects
 * @returns {Object[]} New array sorted by priority (highest first)
 */
function sortByPriority(effects) {
  return [...effects].sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

// A modifier may carry value.scaling — a map of minimum character level to
// dice (cantrip scaling: 1d6 at 1, 2d6 at 5, 3d6 at 11, 4d6 at 17). The tiers
// replace one another; resolve to the highest tier the actor qualifies for.
function resolveScaledValue(mod, actorLevel) {
  const scaling = mod?.value?.scaling;
  if (!scaling || typeof scaling !== 'object') return mod.value;
  let best = null;
  for (const key of Object.keys(scaling)) {
    const lvl = Number(key);
    if (Number.isFinite(lvl) && lvl <= actorLevel && (best === null || lvl > best)) best = lvl;
  }
  if (best === null) return mod.value;
  return { ...mod.value, dice: String(scaling[best]) };
}

/**
 * Collects all applicable modifiers from a list of effects given a context.
 * Filters effects by conditions, sorts by priority, and handles exclusive tags.
 * Deduplicates same-named effects and resolves level-scaled dice values.
 * @param {Object[]} effects - Array of effect definitions
 * @param {Object} [context] - Context to evaluate conditions against
 * @returns {{applicable: Object[], modifiers: Object[]}} Applicable effects and their modifiers
 */
function collectModifiers(effects, context) {
  const applicable = effects.filter(e => effectApplies(e, context));
  const sorted = sortByPriority(applicable);
  const actorLevel = Number(normalizeContext(context).actor.level) || 1;
  const modifiers = [];
  const seenExclusive = new Set();
  const seenNames = new Set();

  for (const effect of sorted) {
    // 5e: the effects of the same spell/feature cast or applied more than
    // once don't combine — only the most potent (highest priority here)
    // instance applies. PHB "Combining Magical Effects".
    const nameKey = normalizeName(effect.name);
    if (nameKey) {
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
    }
    for (const mod of (effect.modifiers || [])) {
      const modTags = Array.isArray(mod.tags) ? mod.tags : [];
      const exclusiveTag = modTags.find(t => String(t).startsWith('exclusive:'));
      if (exclusiveTag) {
        if (seenExclusive.has(exclusiveTag)) continue;
        seenExclusive.add(exclusiveTag);
      }
      modifiers.push({
        ...mod,
        value: resolveScaledValue(mod, actorLevel),
        source_effect: effect.name,
        priority: effect.priority,
      });
    }
  }

  return { applicable, modifiers };
}

module.exports = {
  normalizeEffect,
  normalizeContext,
  effectApplies,
  collectModifiers,
};
