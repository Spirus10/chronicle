/**
 * @fileoverview Shared regular expression patterns used across the application.
 */
'use strict';

const JOIN_CODE_PATTERN = /^[A-Z0-9]+$/;
const TAG_PATTERN = /\{@\w+[^}]*\}/g;

module.exports = { JOIN_CODE_PATTERN, TAG_PATTERN };
