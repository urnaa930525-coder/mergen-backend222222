const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

// ---- List customers (with simple search) ----
router.get('/', requireAuth, async (req, res) => {
  const { q, status } = req.query;
  const params = [req.businessId];
  let where = 'business_id = $1';

  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`;
  }

  const result = await pool.query(
    `SELECT * FROM customers WHERE ${where} ORDER BY updated_at DESC LIMIT 200`,
    params
  );
  res.json({ customers: result.rows });
});

// ---- Create ----
router.post('/', requireAuth, async (req, res) => {
  const { name, phone, email, status, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Нэр шаардлагатай' });
  const result = await pool.query(
    `INSERT INTO customers (business_id, name, phone, email, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.businessId, name, phone || null, email || null, status || 'lead', notes || null]
  );
  res.json({ customer: result.rows[0] });
});

// ---- Update ----
router.put('/:id', requireAuth, async (req, res) => {
  const { name, phone, email, status, notes } = req.body;
  const result = await pool.query(
    `UPDATE customers SET
       name = COALESCE($1, name),
       phone = COALESCE($2, phone),
       email = COALESCE($3, email),
       status = COALESCE($4, status),
       notes = COALESCE($5, notes),
       updated_at = NOW()
     WHERE id = $6 AND business_id = $7 RETURNING *`,
    [name, phone, email, status, notes, req.params.id, req.businessId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Харилцагч олдсонгүй' });
  res.json({ customer: result.rows[0] });
});

// ---- Delete ----
router.delete('/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM customers WHERE id = $1 AND business_id = $2', [req.params.id, req.businessId]);
  res.json({ ok: true });
});

// ---- Simple stats: totals by status ----
router.get('/stats', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT status, COUNT(*) AS count FROM customers WHERE business_id = $1 GROUP BY status`,
    [req.businessId]
  );
  res.json({ stats: result.rows });
});

module.exports = router;
