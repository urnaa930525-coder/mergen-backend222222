const express = require('express');
const { pool } = require('./db');

const router = express.Router();

// Public, unauthenticated (same pattern as namegen/contentgen) — rate-limited to bound abuse.
const RATE_LIMIT = 20;
const rateLog = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const hits = (rateLog.get(ip) || []).filter((t) => t > hourAgo);
  hits.push(now);
  rateLog.set(ip, hits);
  return hits.length > RATE_LIMIT;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// ---- Upload a base64 PNG (from contentgen.html's canvas), get back a durable URL ----
router.post('/upload', express.json({ limit: '8mb' }), async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу.' });
  }

  const { data } = req.body; // data URL: "data:image/png;base64,...."
  if (!data || !data.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Зурган өгөгдөл (data URL) шаардлагатай' });
  }

  const match = data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Буруу форматтай зураг' });
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Зураг хэт том байна (5MB хүртэл)' });

  const result = await pool.query(
    `INSERT INTO generated_media (image_data, mime_type) VALUES ($1, $2) RETURNING id`,
    [buffer, mimeType]
  );
  const id = result.rows[0].id;
  const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${baseUrl}/api/media/${id}.png` });
});

// ---- Serve a stored image by id (this is the URL Facebook fetches when publishing) ----
router.get('/:id.png', async (req, res) => {
  const result = await pool.query('SELECT image_data, mime_type FROM generated_media WHERE id = $1', [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).send('Олдсонгүй');
  res.set('Content-Type', row.mime_type);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(row.image_data);
});

module.exports = router;
