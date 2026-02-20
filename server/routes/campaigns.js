'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.use(requireAuth);

function randomJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function createJoinCode() {
  for (let i = 0; i < 10; i++) {
    const code = randomJoinCode();
    const existing = db.prepare('SELECT id FROM campaigns WHERE join_code = ?').get(code);
    if (!existing) return code;
  }
  return `${randomJoinCode()}${Date.now().toString(36).toUpperCase()}`;
}

router.post('/', requireRole('dm'), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!name) return res.status(400).json({ error: 'Campaign name is required' });
  if (name.length > 120) return res.status(400).json({ error: 'Campaign name must be 120 characters or fewer' });
  if (description.length > 4000) return res.status(400).json({ error: 'Campaign description is too long' });

  const joinCode = createJoinCode();
  const result = db.prepare(`
    INSERT INTO campaigns (name, description, join_code, dm_user_id)
    VALUES (?, ?, ?, ?)
  `).run(name, description, joinCode, req.user.id);

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(campaign);
});

router.get('/mine', requireRole('dm'), (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, (
      SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id = c.id
    ) as player_count
    FROM campaigns c
    WHERE c.dm_user_id = ?
    ORDER BY c.updated_at DESC
  `).all(req.user.id);
  res.json(rows);
});

router.get('/joined', (req, res) => {
  if (req.user.role === 'dm') return res.json([]);
  const rows = db.prepare(`
    SELECT c.*, u.username as dm_username
    FROM campaign_members m
    JOIN campaigns c ON c.id = m.campaign_id
    JOIN users u ON u.id = c.dm_user_id
    WHERE m.player_user_id = ?
    ORDER BY m.joined_at DESC
  `).all(req.user.id);
  res.json(rows);
});

router.post('/join', requireRole('player'), (req, res) => {
  const joinCode = String(req.body?.join_code || '').trim().toUpperCase();
  if (!joinCode) return res.status(400).json({ error: 'join_code is required' });
  if (!/^[A-Z0-9]+$/.test(joinCode)) return res.status(400).json({ error: 'join_code format is invalid' });

  const campaign = db.prepare('SELECT * FROM campaigns WHERE join_code = ?').get(joinCode);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  db.prepare(`
    INSERT OR IGNORE INTO campaign_members (campaign_id, player_user_id)
    VALUES (?, ?)
  `).run(campaign.id, req.user.id);

  res.json({ ok: true, campaign });
});

router.get('/:id', (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  if (req.user.role === 'dm') {
    if (campaign.dm_user_id !== req.user.id) return res.status(403).json({ error: 'Not your campaign' });
  } else {
    const member = db.prepare('SELECT id FROM campaign_members WHERE campaign_id = ? AND player_user_id = ?').get(campaignId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Not a campaign member' });
  }

  res.json(campaign);
});

router.get('/:id/characters', requireRole('dm'), (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ? AND dm_user_id = ?').get(campaignId, req.user.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const rows = db.prepare(`
    SELECT c.id, c.name, c.level, c.updated_at, c.class_id, c.subclass_id, c.race_id,
           cl.name as class_name, sc.name as subclass_name, r.name as race_name,
           u.username as owner_username
    FROM characters c
    LEFT JOIN classes cl ON cl.id = c.class_id
    LEFT JOIN subclasses sc ON sc.id = c.subclass_id
    LEFT JOIN races r ON r.id = c.race_id
    LEFT JOIN users u ON u.id = c.owner_user_id
    WHERE c.campaign_id = ?
    ORDER BY c.updated_at DESC
  `).all(campaignId);

  res.json(rows);
});

router.post('/:id/characters/:characterId/attach', requireRole('player'), (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const characterId = parseInt(req.params.characterId, 10);

  const member = db.prepare('SELECT id FROM campaign_members WHERE campaign_id = ? AND player_user_id = ?').get(campaignId, req.user.id);
  if (!member) return res.status(403).json({ error: 'You must join this campaign first' });

  const character = db.prepare('SELECT id FROM characters WHERE id = ? AND owner_user_id = ?').get(characterId, req.user.id);
  if (!character) return res.status(404).json({ error: 'Character not found' });

  db.prepare(`
    UPDATE characters
    SET campaign_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(campaignId, characterId);

  res.json({ ok: true });
});

router.post('/:id/characters/:characterId/detach', (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const characterId = parseInt(req.params.characterId, 10);

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  if (req.user.role === 'dm') {
    if (campaign.dm_user_id !== req.user.id) return res.status(403).json({ error: 'Not your campaign' });
  }

  const character = db.prepare('SELECT id, owner_user_id, campaign_id FROM characters WHERE id = ?').get(characterId);
  if (!character || character.campaign_id !== campaignId) {
    return res.status(404).json({ error: 'Character not found in campaign' });
  }

  if (req.user.role === 'player' && character.owner_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your character' });
  }

  db.prepare(`
    UPDATE characters
    SET campaign_id = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(characterId);

  res.json({ ok: true });
});

module.exports = router;
