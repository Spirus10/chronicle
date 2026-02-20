'use strict';
const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'chronicle_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function cookieBaseAttrs(maxAgeMs) {
  const attrs = [`Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieBaseAttrs(SESSION_TTL_MS)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieBaseAttrs(0)}`);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, tokenHash(token), expiresAt);
  return token;
}

function destroySessionByToken(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

function userResponse(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role, created_at: user.created_at };
}

function authMiddleware(req, _res, next) {
  req.user = null;
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return next();

  const hasEmail = db.prepare('PRAGMA table_info(users)').all().map(c => c.name).includes('email');
  const row = hasEmail
    ? db.prepare(`
      SELECT s.id as session_id, s.expires_at, u.id,
             COALESCE(u.username, u.email) as username,
             u.role, u.created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash(token))
    : db.prepare(`
      SELECT s.id as session_id, s.expires_at, u.id, u.username, u.role, u.created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash(token));

  if (!row) return next();
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return next();
  }

  req.user = {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
  };
  req.sessionToken = token;
  return next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role !== role) return res.status(403).json({ error: `${role.toUpperCase()} role required` });
    return next();
  };
}

function cleanupExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
}

module.exports = {
  SESSION_COOKIE,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  createSession,
  destroySessionByToken,
  userResponse,
  authMiddleware,
  requireAuth,
  requireRole,
  cleanupExpiredSessions,
};
