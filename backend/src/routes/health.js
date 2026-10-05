const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    pqc: 'ML-KEM-768',
    symmetric: 'AES-256-GCM',
    openrouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  });
});

module.exports = router;