'use strict';
/* ================================================================
   shared.js — utilities used across all pages
   ================================================================ */

// ── API ──────────────────────────────────────────────────────────
async function apiRequest(path, options = {}) {
  const r = await fetch(`/api${path}`, options);
  if (r.status === 401 && !location.pathname.endsWith('/login.html')) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
    throw new Error('Authentication required');
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `${options.method || 'GET'} ${path} -> ${r.status}`);
  }
  return r.json();
}

const API = {
  async get(path) {
    return apiRequest(path, { method: 'GET' });
  },
  async post(path, body) {
    return apiRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  async put(path, body) {
    return apiRequest(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  async del(path) {
    return apiRequest(path, { method: 'DELETE' });
  },
};

const Auth = {
  me() {
    return API.get('/auth/me');
  },
  login(payload) {
    return API.post('/auth/login', payload);
  },
  register(payload) {
    return API.post('/auth/register', payload);
  },
  logout() {
    return API.post('/auth/logout', {});
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

function tagLabel(content) {
  const raw = String(content || '');
  return raw.split('|')[0]?.trim() || raw.trim();
}

function renderTagMarkdown(tag, content) {
  const t = String(tag || '').toLowerCase();
  const label = tagLabel(content);
  switch (t) {
    case 'i':
    case 'italic':
      return `*${label}*`;
    case 'b':
    case 'bold':
      return `**${label}**`;
    case 'damage':
    case 'dice':
      return `\`${label}\``;
    case 'scaledamage':
    case 'scaledice': {
      const parts = String(content || '').split('|').map(p => p.trim()).filter(Boolean);
      const base = parts[0] || label;
      const range = parts[1] || '';
      const step = parts[2] || '';
      const suffix = range && step && step !== base ? ` (scales ${range}: +${step})` : '';
      return `\`${base}\`${suffix}`;
    }
    case 'dc':
      return `DC ${label}`;
    case 'hit': {
      const hit = label.startsWith('+') || label.startsWith('-') ? label : `+${label}`;
      return `\`${hit}\``;
    }
    case 'chance':
      return `${label}%`;
    case 'condition':
      return `<span class="md-tag md-tag-condition">${label}</span>`;
    case 'status':
      return `<span class="md-tag md-tag-status">${label}</span>`;
    case 'skill':
      return `<span class="md-tag md-tag-skill">${label}</span>`;
    case 'note':
      return `*${label}*`;
    case 'recharge':
      return `(Recharge ${label})`;
    case 'h':
      return '';
    case 'atk':
    case 'action':
    case 'sense':
    case 'quickref':
    case 'book':
    case 'filter':
    case 'link':
    case 'spell':
    case 'creature':
    case 'item':
    case 'race':
    case 'deity':
    case 'language':
    case 'class':
    case 'classfeature':
    case 'optfeature':
    case 'feat':
    case 'background':
    case 'adventure':
    case 'table':
    case 'object':
    case 'deck':
    case 'variantrule':
    case 'itemproperty':
    case 'color':
      return label;
    default:
      return label;
  }
}

function renderTagStringMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(/\{@([A-Za-z]+) ([^{}]*)\}/g, (_, tag, content) => renderTagMarkdown(tag, content));
}

function markdownTableFromEntry(entry) {
  const headers = (entry.colLabels || []).map(h => renderTagStringMarkdown(String(h || '')));
  const rows = (entry.rows || []).map(row => {
    const cells = (row || []).map(cell => {
      if (typeof cell === 'string') return renderTagStringMarkdown(cell);
      if (cell?.roll) {
        const min = cell.roll.min ?? '';
        const max = cell.roll.max ?? '';
        if (min === max) return String(min);
        return `${min}-${max}`;
      }
      return renderTagStringMarkdown(String(cell ?? ''));
    });
    return `| ${cells.join(' | ')} |`;
  });
  if (!headers.length) return rows.join('\n');
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  return [`| ${headers.join(' | ')} |`, divider, ...rows].join('\n');
}

function renderEntryMarkdown(entry, depth = 0) {
  if (typeof entry === 'string') return renderTagStringMarkdown(entry);
  if (!entry || typeof entry !== 'object') return '';

  switch (entry.type) {
    case 'entries': {
      const title = entry.name
        ? `${'#'.repeat(Math.min(6, 3 + depth))} ${renderTagStringMarkdown(String(entry.name))}\n\n`
        : '';
      const body = renderEntriesMarkdown(entry.entries || [], depth + 1);
      return `${title}${body}`.trim();
    }
    case 'list': {
      const items = (entry.items || []).map(item => {
        if (typeof item === 'string') return `- ${renderTagStringMarkdown(item)}`;
        if (item?.type === 'item') {
          const name = item.name ? `**${renderTagStringMarkdown(String(item.name))}.** ` : '';
          const body = renderEntriesMarkdown(item.entries || [], depth + 1).replace(/\n+/g, ' ').trim();
          return `- ${name}${body}`.trim();
        }
        return `- ${renderEntryMarkdown(item, depth + 1).replace(/\n+/g, ' ').trim()}`;
      }).filter(Boolean);
      return items.join('\n');
    }
    case 'table':
      return markdownTableFromEntry(entry);
    case 'inset':
    case 'insetReadaloud': {
      const title = entry.name ? `> **${renderTagStringMarkdown(String(entry.name))}**\n>\n` : '';
      const body = renderEntriesMarkdown(entry.entries || [], depth + 1)
        .split('\n')
        .map(line => line ? `> ${line}` : '>')
        .join('\n');
      return `${title}${body}`.trim();
    }
    case 'abilityDc':
      return `**Spell save DC** = 8 + your proficiency bonus + your ${(entry.attributes || []).join('/') || '?'} modifier`;
    case 'abilityAttackMod':
      return `**Spell attack modifier** = your proficiency bonus + your ${(entry.attributes || []).join('/') || '?'} modifier`;
    case 'refOptionalfeature':
      return `See: ${renderTagStringMarkdown(String(entry.optionalfeature || ''))}`;
    case 'refClassFeature':
      return `See: ${renderTagStringMarkdown(String(entry.classFeature || ''))}`;
    case 'options':
      return renderEntriesMarkdown(entry.entries || [], depth + 1);
    case 'quote': {
      const quoted = (entry.entries || [])
        .map(line => renderTagStringMarkdown(String(line || '')))
        .join(' ')
        .trim();
      const by = entry.by ? `\n>\n> - ${renderTagStringMarkdown(String(entry.by))}` : '';
      return `> ${quoted}${by}`.trim();
    }
    default:
      if (entry.entries) return renderEntriesMarkdown(entry.entries, depth + 1);
      return '';
  }
}

function renderEntriesMarkdown(entries, depth = 0) {
  if (!entries || !Array.isArray(entries)) return '';
  return entries
    .map(entry => renderEntryMarkdown(entry, depth))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  const skillProfs = overrides.skill_proficiencies || char.skill_proficiencies || {};
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
  const classSaves = overrides.save_proficiencies || char.class_save_proficiencies || [];
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
