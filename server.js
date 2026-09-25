require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, pool } = require('./db');

const authRoutes = require('./auth');
const agentRoutes = require('./agent');
const chatRoutes = require('./chat');
const socialRoutes = require('./social');
const siteRoutes = require('./site');
const marketingRoutes = require('./marketing');
const customerRoutes = require('./customers');
const orderRoutes = require('./orders');
const analyticsRoutes = require('./analytics');
const { renderSiteHtml } = require('./site');

const app = express();
app.use(cors());
app.use(express.json());

// Static frontend files live in the same flat folder as the server code,
// so only these specific public-facing files are served (not server.js, db.js, etc).
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/builder.html', (req, res) => res.sendFile(path.join(__dirname, 'builder.html')));
app.get('/widget.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'widget.js'));
});

app.use('/api/auth', authRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/site', siteRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Public: render a published site by its slug ----
app.get('/site/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sites WHERE slug = $1 AND published = true',
      [req.params.slug]
    );
    if (!result.rows[0]) return res.status(404).send('Сайт олдсонгүй эсвэл нийтлэгдээгүй байна.');
    res.send(renderSiteHtml(result.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).send('Серверийн алдаа');
  }
});

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
