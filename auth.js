const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

router.post('/signup', async (req, res) => {
  const { email, password, business_name } = req.body;
  if (!email || !password || !business_name) {
    return res.status(400).json({ error: 'email, password, business_name шаардлагатай' });
  }
  try {
    const existing = await pool.query('SELECT id FROM businesses WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Энэ email аль хэдийн бүртгэлтэй байна' });
    }
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO businesses (email, password_hash, business_name)
       VALUES ($1, $2, $3) RETURNING id, email, business_name, plan`,
      [email, passwordHash, business_name]
    );
    const business = result.rows[0];

    const widgetKey = uuidv4();
    await pool.query(
      `INSERT INTO agents (business_id, widget_key, is_primary) VALUES ($1, $2, true)`,
      [business.id, widgetKey]
    );

    const token = jwt.sign({ businessId: business.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, business });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Серверийн алдаа' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email, password шаардлагатай' });
  try {
    const result = await pool.query('SELECT * FROM businesses WHERE email = $1', [email]);
    const business = result.rows[0];
    if (!business) return res.status(401).json({ error: 'Email эсвэл нууц үг буруу байна' });
    const ok = await bcrypt.compare(password, business.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email эсвэл нууц үг буруу байна' });

    const token = jwt.sign({ businessId: business.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      business: { id: business.id, email: business.email, business_name: business.business_name, plan: business.plan },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Серверийн алдаа' });
  }
});

module.exports = router;
