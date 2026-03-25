/**
 * @fileoverview JSON parsing utility with safe fallback handling.
 */
'use strict';

/**
 * Safely parses a JSON string with a fallback default value.
 * @param {string|null|undefined} str - JSON string to parse
 * @param {*} fallback - Value to return if parsing fails or input is falsy
 * @returns {*} Parsed value or fallback
 */
function parseJSON(str, fallback = {}) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

module.exports = { parseJSON };
