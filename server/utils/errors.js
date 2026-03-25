/**
 * @fileoverview Error response utility for standardized API error formatting.
 */
'use strict';

/**
 * Creates a standardized error response object.
 * @param {number} code - HTTP status code
 * @param {string} message - Error message
 * @returns {{error: string, code: number}} Error response object
 */
function errorResponse(code, message) {
  return { error: message, code };
}

module.exports = { errorResponse };
