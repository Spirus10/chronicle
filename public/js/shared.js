'use strict';
/* ================================================================
   shared.js — utilities used across all pages
   ================================================================ */

// ── API ──────────────────────────────────────────────────────────
const API = {
  async get(path) {
    const r = await fetch(`/api${path}`);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `POST ${path} → ${r.status}`);
    }
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(`/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `PUT ${path} → ${r.status}`);
    }
    return r.json();
  },
  async del(path) {
    const r = await fetch(`/api${path}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
    return r.json();
  },
};

// ── 5e Tag Renderer ──────────────────────────────────────────────
// Converts {@tag content} notation to readable HTML
function renderTag(tag, content) {
  const t = tag.toLowerCase();
  switch (t) {
    case 'spell':       return `<em>${content}</em>`;
    case 'creature':    return `<em>${content}</em>`;
    case 'item':        return `<em>${content}</em>`;
    case 'damage':      return `<strong>${content}</strong>`;
    case 'dice':        return `<strong>${content}</strong>`;
    case 'hit':         return content.startsWith('+') || content.startsWith('-') ? content : `+${content}`;
    case 'dc':          return `DC ${content}`;
    case 'chance':      return `${content}%`;
    case 'condition':   return `<span class="tag-condition">${content}</span>`;
    case 'skill':       return `<span class="tag-skill">${content}</span>`;
    case 'sense':       return content;
    case 'action':      return content;
    case 'quickref':    return content;
    case 'book':        return content;
    case 'note':        return `<em class="tag-note">${content}</em>`;
    case 'b':
    case 'bold':        return `<strong>${content}</strong>`;
    case 'i':
    case 'italic':      return `<em>${content}</em>`;
    case 'color':       return content;  // strip color; content is the text part
    case 'atk':         return content;
    case 'h':           return '';        // hit modifier inline; skip
    case 'recharge':    return `(Recharge ${content})`;
    case 'filter':
    case 'link':        return content.split('|')[0] || content;
    default:            return content;
  }
}

function renderTagString(text) {
  if (!text || typeof text !== 'string') return text || '';
  // Match {@tag content} with nested braces handled by replacing inner first
  return text.replace(/\{@(\w+) ([^{}]*)\}/g, (_, tag, content) => renderTag(tag, content));
}

// Render a 5e.tools entries array to HTML
function renderEntries(entries, depth = 0) {
  if (!entries || !Array.isArray(entries)) return '';
  return entries.map(entry => {
    if (typeof entry === 'string') {
      return `<p>${renderTagString(entry)}</p>`;
    }
    if (typeof entry !== 'object') return '';

    switch (entry.type) {
      case 'entries': {
        const hTag = depth === 0 ? 'h4' : 'h5';
        const title = entry.name ? `<${hTag} class="entry-title">${renderTagString(entry.name)}</${hTag}>` : '';
        return title + renderEntries(entry.entries, depth + 1);
      }
      case 'list': {
        const items = (entry.items || []).map(item => {
          if (typeof item === 'string') return `<li>${renderTagString(item)}</li>`;
          if (item.type === 'item') {
            const name = item.name ? `<strong>${renderTagString(item.name)}.</strong> ` : '';
            return `<li>${name}${renderEntries(item.entries || [], depth + 1)}</li>`;
          }
          return `<li>${renderEntries([item], depth + 1)}</li>`;
        }).join('');
        return `<ul class="entry-list">${items}</ul>`;
      }
      case 'table': {
        const caption = entry.caption ? `<caption>${renderTagString(entry.caption)}</caption>` : '';
        const headers = (entry.colLabels || []).map(h => `<th>${renderTagString(h)}</th>`).join('');
        const rows = (entry.rows || []).map(row => {
          const cells = row.map(cell => {
            const text = typeof cell === 'string' ? cell : (cell.roll ? `${cell.roll.min}–${cell.roll.max}` : JSON.stringify(cell));
            return `<td>${renderTagString(text)}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('');
        return `<table class="entry-table">${caption}<thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
      }
      case 'inset':
      case 'insetReadaloud': {
        const title = entry.name ? `<strong>${renderTagString(entry.name)}</strong><br>` : '';
        return `<blockquote class="entry-inset">${title}${renderEntries(entry.entries || [], depth + 1)}</blockquote>`;
      }
      case 'abilityDc': {
        return `<p><strong>Spell save DC</strong> = 8 + your proficiency bonus + your ${entry.attributes?.join('/') ?? '?'} modifier</p>`;
      }
      case 'abilityAttackMod': {
        return `<p><strong>Spell attack modifier</strong> = your proficiency bonus + your ${entry.attributes?.join('/') ?? '?'} modifier</p>`;
      }
      case 'refOptionalfeature':
        return `<p class="ref-feature">See: ${entry.optionalfeature}</p>`;
      case 'refClassFeature':
        return `<p class="ref-feature">See: ${entry.classFeature}</p>`;
      case 'options': {
        return renderEntries(entry.entries || [], depth + 1);
      }
      case 'quote':
        return `<blockquote class="entry-quote"><p>${renderTagString(entry.entries?.join(' ') || '')}</p>${entry.by ? `<footer>— ${entry.by}</footer>` : ''}</blockquote>`;
      default:
        if (entry.entries) return renderEntries(entry.entries, depth + 1);
        return '';
    }
  }).join('');
}

// ── Ability Score Utilities ───────────────────────────────────────
function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

function modStr(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

const ABILITY_NAMES = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
const ABILITY_FULL  = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' };

const SKILLS = [
  { key:'athletics',      ability:'str', name:'Athletics' },
  { key:'acrobatics',     ability:'dex', name:'Acrobatics' },
  { key:'sleight_of_hand',ability:'dex', name:'Sleight of Hand' },
  { key:'stealth',        ability:'dex', name:'Stealth' },
  { key:'arcana',         ability:'int', name:'Arcana' },
  { key:'history',        ability:'int', name:'History' },
  { key:'investigation',  ability:'int', name:'Investigation' },
  { key:'nature',         ability:'int', name:'Nature' },
  { key:'religion',       ability:'int', name:'Religion' },
  { key:'animal_handling',ability:'wis', name:'Animal Handling' },
  { key:'insight',        ability:'wis', name:'Insight' },
  { key:'medicine',       ability:'wis', name:'Medicine' },
  { key:'perception',     ability:'wis', name:'Perception' },
  { key:'survival',       ability:'wis', name:'Survival' },
  { key:'deception',      ability:'cha', name:'Deception' },
  { key:'intimidation',   ability:'cha', name:'Intimidation' },
  { key:'performance',    ability:'cha', name:'Performance' },
  { key:'persuasion',     ability:'cha', name:'Persuasion' },
];

const PROFICIENCY_BONUS = [0, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];

function profBonus(level) {
  return PROFICIENCY_BONUS[Math.max(1, Math.min(20, level))];
}

// Calculate all derived stats for a character
function calcStats(char) {
  const scores = char.ability_scores || {str:10,dex:10,con:10,int:10,wis:10,cha:10};
  const overrides = char.stat_overrides || {};
  const skillProfs = char.skill_proficiencies || {};
  const pb = profBonus(char.level || 1);

  const mods = {};
  for (const ab of Object.keys(scores)) mods[ab] = abilityMod(scores[ab]);

  // AC: default 10 + DEX (unarmored), override if set
  const ac = overrides.ac ?? (10 + mods.dex);

  // Initiative
  const initiative = overrides.initiative ?? mods.dex;

  // Speed (from race or override)
  const speed = overrides.speed ?? (char.race_speed?.walk ?? 30);

  // Spellcasting ability modifier
  const spellAbility = char.spellcasting_ability;
  const spellMod = spellAbility ? mods[spellAbility] : 0;
  const spellDC = overrides.spell_dc ?? (8 + pb + spellMod);
  const spellAtk = overrides.spell_atk ?? (pb + spellMod);

  // Saving throws
  const saves = {};
  const classSaves = char.class_save_proficiencies || [];
  for (const ab of Object.keys(scores)) {
    const key = `save_${ab}`;
    if (overrides[key] !== undefined) {
      saves[ab] = overrides[key];
    } else {
      saves[ab] = mods[ab] + (classSaves.includes(ab) ? pb : 0);
    }
  }

  // Skills
  const skills = {};
  for (const sk of SKILLS) {
    const key = `skill_${sk.key}`;
    if (overrides[key] !== undefined) {
      skills[sk.key] = overrides[key];
    } else {
      const prof = skillProfs[sk.key];
      let bonus = mods[sk.ability];
      if (prof === 'proficient') bonus += pb;
      else if (prof === 'expertise') bonus += pb * 2;
      skills[sk.key] = bonus;
    }
  }

  const passivePerception = overrides.passive_perception ?? (10 + skills.perception);

  return { ac, initiative, speed, spellDC, spellAtk, spellMod, pb, mods, saves, skills, passivePerception };
}

// ── School labels ────────────────────────────────────────────────
const SCHOOL_NAMES = {
  A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment',
  I: 'Illusion', N: 'Necromancy', T: 'Transmutation', V: 'Evocation',
};

// ── Ordinals ─────────────────────────────────────────────────────
function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

// ── Debounce ─────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Toast notifications ───────────────────────────────────────────
function toast(msg, type = 'info', duration = 2500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const colors = { info: '#50a0dc', success: '#40cc80', error: '#cc4040', warn: '#e8c170' };
  const el = document.createElement('div');
  el.style.cssText = `padding:10px 16px;border-radius:6px;font-size:12px;font-family:'Crimson Text','Georgia',serif;letter-spacing:0.5px;color:#c8bfa9;background:rgba(20,18,15,0.97);border:1px solid ${colors[type]||colors.info};box-shadow:0 4px 16px rgba(0,0,0,0.5);transition:opacity 0.3s;max-width:280px;`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── Alignment options ─────────────────────────────────────────────
const ALIGNMENTS = [
  'Lawful Good', 'Neutral Good', 'Chaotic Good',
  'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil', 'Unaligned',
];

// ── Item types ────────────────────────────────────────────────────
const ITEM_TYPES = ['misc', 'weapon', 'armor', 'consumable', 'tool', 'treasure', 'magic'];
