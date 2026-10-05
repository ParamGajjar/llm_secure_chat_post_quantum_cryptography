require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const sessionRoutes = require('./routes/session');
const chatRoutes = require('./routes/chat');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/chat', chatRoutes);

// Generic error handler: never leak internals, never fall back to plaintext
app.use((err, req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(err.status || 500).json({ error: err.publicMessage || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`PQC chat backend listening on http://localhost:${PORT}`);
});