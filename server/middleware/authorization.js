/**
 * @fileoverview Authorization middleware for resource ownership and membership checks.
 */
'use strict';
const db = require('../db');

/**
 * Express middleware that verifies the authenticated user owns the character.
 * Attaches the character to req.character on success.
 * @param {Object} req - Express request object (requires req.user and req.params.id)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
function requireCharacterOwnership(req, res, next) {
  const char = db.prepare('SELECT id FROM characters WHERE id = ? AND owner_user_id = ?')
    .get(req.params.id, req.user.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  req.character = char;
  next();
}

/**
 * Express middleware that verifies the authenticated user is a member of the campaign.
 * @param {Object} req - Express request object (requires req.user and req.params.id)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
function requireCampaignMembership(req, res, next) {
  const member = db.prepare('SELECT id FROM campaign_members WHERE campaign_id = ? AND player_user_id = ?')
    .get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a campaign member' });
  next();
}

module.exports = { requireCharacterOwnership, requireCampaignMembership };
