/**
 * @fileoverview Authentication module for user management.
 * Handles password hashing/verification, session management, and authentication middleware.
 */
'use strict';
const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'chronicle_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

/**
 * Normalizes a username for consistent storage and comparison.
 * Converts to lowercase and trims whitespace.
 * @param {string} username - The raw username input
 * @returns {string} The normalized username
 */
function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

/**
 * Hashes a password using crypto.scryptSync with a random salt.
 * @param {string} password - The plaintext password to hash
 * @returns {string} The salted hash in format "salt:hash"
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored hash using timing-safe comparison.
 * @param {string} password - The plaintext password to verify
 * @param {string} storedHash - The stored hash from database (format: "salt:hash")
 * @returns {boolean} True if password matches, false otherwise
 */
function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/**
 * Parses HTTP cookie header from request.
 * @param {Object} req - Express request object
 * @returns {Object<string, string>} Parsed cookies as key-value pairs
 */
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

/**
 * Creates SHA256 hash of session token for secure storage.
 * @param {string} token - The raw session token
 * @returns {string} The SHA256 hex digest
 */
function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Builds cookie attribute string with security flags.
 * Includes HttpOnly, SameSite=Lax, and Secure (in production).
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {string} Semicolon-separated cookie attributes
 */
function cookieBaseAttrs(maxAgeMs) {
  const attrs = [`Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

/**
 * Sets session cookie in HTTP response with security attributes.
 * @param {Object} res - Express response object
 * @param {string} token - The session token to set
 * @returns {void}
 */
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieBaseAttrs(SESSION_TTL_MS)}`);
}

/**
 * Clears session cookie by setting Max-Age to 0.
 * @param {Object} res - Express response object
 * @returns {void}
 */
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieBaseAttrs(0)}`);
}

/**
 * Creates a new session record in database and returns session token.
 * Token expires after SESSION_TTL_MS (14 days).
 * @param {number} userId - The user ID to create session for
 * @returns {string} The raw session token (not hashed)
 */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, tokenHash(token), expiresAt);
  return token;
}

/**
 * Deletes a session record from database by token hash.
 * Safely handles null/undefined tokens.
 * @param {string} [token] - The session token to destroy
 * @returns {void}
 */
function destroySessionByToken(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

/**
 * Sanitizes user object for API responses (excludes password hash, etc).
 * @param {Object} [user] - User record from database
 * @returns {Object|null} Sanitized user object or null if input is falsy
 */
function userResponse(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role, created_at: user.created_at };
}

/**
 * Express middleware that attaches authenticated user to request object.
 * Checks session cookie, verifies token hash, and validates expiration.
 * @param {Object} req - Express request object
 * @param {Object} _res - Express response object (unused)
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
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

/**
 * Express middleware that enforces authentication.
 * Returns 401 if user is not authenticated.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  return next();
}

/**
 * Creates middleware to enforce role-based access control.
 * @param {string} role - Required role ('dm' or 'player')
 * @returns {Function} Express middleware function that checks user role
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role !== role) return res.status(403).json({ error: `${role.toUpperCase()} role required` });
    return next();
  };
}

/**
 * Deletes all expired sessions from database.
 * Called during server startup.
 * @returns {void}
 */
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
