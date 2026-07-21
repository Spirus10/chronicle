/**
 * @fileoverview Authentication API routes.
 * Handles user registration, login, logout, and session management.
 */
'use strict';
const express = require('express');
const db = require('../db');
const {
  normalizeUsername,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  createSession,
  destroySessionByToken,
  userResponse,
  requireAuth,
} = require('../auth');

const router = express.Router();

/**
 * Checks if users table has legacy email column.
 * Used for backward compatibility with mixed user schema.
 * @returns {boolean} True if email column exists
 */
function usersHaveEmailColumn() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  return cols.includes('email');
}

/**
 * Generates synthetic email for users without email column.
 * Format: "username@local.invalid"
 * @param {string} username - The normalized username
 * @returns {string} Synthetic email address
 */
function syntheticEmail(username) {
  return `${username}@local.invalid`;
}

router.post('/register', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '').toLowerCase();

  if (!username || username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (username.length > 32) return res.status(400).json({ error: 'Username must be 32 characters or fewer' });
  if (!/^[a-z0-9_\-]+$/.test(username)) return res.status(400).json({ error: 'Username may only contain letters, numbers, _ and -' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password.length > 128) return res.status(400).json({ error: 'Password must be 128 characters or fewer' });
  if (!['dm', 'player'].includes(role)) return res.status(400).json({ error: 'Role must be dm or player' });

  const hasEmail = usersHaveEmailColumn();
  const existing = hasEmail
    ? db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, username)
    : db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already registered' });

  const result = hasEmail
    ? db.prepare(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(username, syntheticEmail(username), hashPassword(password), role)
    : db.prepare(`
      INSERT INTO users (username, password_hash, role)
      VALUES (?, ?, ?)
    `).run(username, hashPassword(password), role);

  const user = hasEmail
    ? db.prepare('SELECT id, COALESCE(username, email) as username, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid)
    : db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: userResponse(user) });
});

router.post('/login', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const user = usersHaveEmailColumn()
    ? db.prepare(`
      SELECT id, COALESCE(username, email) as username, role, created_at, password_hash
      FROM users
      WHERE username = ? OR email = ?
    `).get(username, username)
    : db.prepare('SELECT id, username, role, created_at, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: userResponse(user) });
});

router.post('/logout', (req, res) => {
  if (req.sessionToken) destroySessionByToken(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: userResponse(req.user) });
});

module.exports = router;
