'use strict';

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

function normalizeContext(context) {
  return {
    actor: context?.actor || {},
    action: context?.action || {},
    roll: context?.roll || {},
    target: context?.target || {},
    state: context?.state || {},
  };
}

function hasTag(container, tag) {
  const tags = Array.isArray(container?.tags) ? container.tags : [];
  return tags.map(t => String(t).toLowerCase()).includes(String(tag).toLowerCase());
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

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
      return true;
  }
}

function effectApplies(effect, context) {
  const normalized = normalizeEffect(effect);
  if (!normalized) return false;
  if (!normalized.conditions.length) return true;
  return normalized.conditions.every(condition => conditionMatches(condition, context));
}

function sortByPriority(effects) {
  return [...effects].sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

function collectModifiers(effects, context) {
  const applicable = effects.filter(e => effectApplies(e, context));
  const sorted = sortByPriority(applicable);
  const modifiers = [];
  const seenExclusive = new Set();

  for (const effect of sorted) {
    for (const mod of (effect.modifiers || [])) {
      const modTags = Array.isArray(mod.tags) ? mod.tags : [];
      const exclusiveTag = modTags.find(t => String(t).startsWith('exclusive:'));
      if (exclusiveTag) {
        if (seenExclusive.has(exclusiveTag)) continue;
        seenExclusive.add(exclusiveTag);
      }
      modifiers.push({ ...mod, source_effect: effect.name, priority: effect.priority });
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
