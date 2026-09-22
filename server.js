require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const authRoutes = require('./auth');
const agentRoutes = require('./agent');
const chatRoutes = require('./chat');
const socialRoutes = require('./social');

const app = express();
app.use(cors());
app.use(express.json());

// Static frontend files live in the same flat folder as the server code,
// so only these specific public-facing files are served (not server.js, db.js, etc).
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/widget.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'widget.js'));
});

app.use('/api/auth', authRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/social', socialRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Mergen backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to init DB', err);
    process.exit(1);
  });
