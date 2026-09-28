const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { requireAuth, requireOwner } = require('./authMiddleware');

const router = express.Router();

// ---- List team members (owner and staff can both see the roster) ----
router.get('/', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, name, created_at FROM team_members WHERE business_id = $1 ORDER BY created_at ASC',
    [req.businessId]
  );
  res.json({ members: result.rows, my_role: req.role });
});

// ---- Owner adds a new staff login ----
router.post('/', requireAuth, requireOwner, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email, password шаардлагатай' });
  if (password.length < 6) return res.status(400).json({ error: 'Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой' });

  try {
    const bizClash = await pool.query('SELECT id FROM businesses WHERE email = $1', [email]);
    if (bizClash.rows.length > 0) {
      return res.status(409).json({ error: 'Энэ email аль хэдийн бүртгэлтэй байна' });
    }
    const memberClash = await pool.query('SELECT id FROM team_members WHERE email = $1', [email]);
    if (memberClash.rows.length > 0) {
      return res.status(409).json({ error: 'Энэ email аль хэдийн бүртгэлтэй байна' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO team_members (business_id, email, password_hash, name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, created_at`,
      [req.businessId, email, passwordHash, name || null]
    );
    res.json({ member: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Серверийн алдаа' });
  }
});

// ---- Owner removes a staff login ----
router.delete('/:id', requireAuth, requireOwner, async (req, res) => {
  await pool.query('DELETE FROM team_members WHERE id = $1 AND business_id = $2', [req.params.id, req.businessId]);
  res.json({ ok: true });
});

module.exports = router;
