'use strict';
const express = require('express');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.use(requireAuth, requireRole('dm'));

router.get('/status', (_req, res) => {
  res.json({
    ready: false,
    message: 'DM tools scaffold is in place. Endpoints will be added in future updates.',
    tools: ['encounters', 'initiative', 'session-notes'],
  });
});

module.exports = router;
