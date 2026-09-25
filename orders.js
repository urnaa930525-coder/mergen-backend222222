const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireFeature } = require('./planMiddleware');

const router = express.Router();
const requirePlan = [requireAuth, requireFeature('orders')];

// ================= Products =================

router.get('/products', requirePlan, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM products WHERE business_id = $1 ORDER BY created_at DESC',
    [req.businessId]
  );
  res.json({ products: result.rows });
});

router.post('/products', requirePlan, async (req, res) => {
  const { name, price, description, image_url, in_stock } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name, price шаардлагатай' });
  const result = await pool.query(
    `INSERT INTO products (business_id, name, price, description, image_url, in_stock)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.businessId, name, price, description || null, image_url || null, in_stock !== false]
  );
  res.json({ product: result.rows[0] });
});

router.put('/products/:id', requirePlan, async (req, res) => {
  const { name, price, description, image_url, in_stock } = req.body;
  const result = await pool.query(
    `UPDATE products SET
       name = COALESCE($1, name),
       price = COALESCE($2, price),
       description = COALESCE($3, description),
       image_url = COALESCE($4, image_url),
       in_stock = COALESCE($5, in_stock)
     WHERE id = $6 AND business_id = $7 RETURNING *`,
    [name, price, description, image_url, in_stock, req.params.id, req.businessId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Бүтээгдэхүүн олдсонгүй' });
  res.json({ product: result.rows[0] });
});

router.delete('/products/:id', requirePlan, async (req, res) => {
  await pool.query('DELETE FROM products WHERE id = $1 AND business_id = $2', [req.params.id, req.businessId]);
  res.json({ ok: true });
});

// ================= Orders =================

router.get('/orders', requirePlan, async (req, res) => {
  const { status } = req.query;
  const params = [req.businessId];
  let where = 'business_id = $1';
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  const orders = result.rows;
  if (orders.length > 0) {
    const ids = orders.map((o) => o.id);
    const itemsResult = await pool.query(
      `SELECT * FROM order_items WHERE order_id = ANY($1::int[])`,
      [ids]
    );
    orders.forEach((o) => {
      o.items = itemsResult.rows.filter((i) => i.order_id === o.id);
    });
  }
  res.json({ orders });
});

router.post('/orders', requirePlan, async (req, res) => {
  const { customer_name, customer_phone, notes, items } = req.body;
  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customer_name, items (хамгийн багадаа 1) шаардлагатай' });
  }
  const total = items.reduce((sum, i) => sum + Number(i.price) * Number(i.quantity || 1), 0);

  const orderResult = await pool.query(
    `INSERT INTO orders (business_id, customer_name, customer_phone, total_amount, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.businessId, customer_name, customer_phone || null, total, notes || null]
  );
  const order = orderResult.rows[0];

  for (const item of items) {
    await pool.query(
      `INSERT INTO order_items (order_id, product_name, price, quantity) VALUES ($1, $2, $3, $4)`,
      [order.id, item.product_name, item.price, item.quantity || 1]
    );
  }

  const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
  order.items = itemsResult.rows;
  res.json({ order });
});

router.put('/orders/:id/status', requirePlan, async (req, res) => {
  const { status } = req.body;
  const allowed = ['new', 'confirmed', 'preparing', 'done', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'status буруу байна' });
  const result = await pool.query(
    `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3 RETURNING *`,
    [status, req.params.id, req.businessId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Захиалга олдсонгүй' });
  res.json({ order: result.rows[0] });
});

router.get('/orders/stats', requirePlan, async (req, res) => {
  const result = await pool.query(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS total
     FROM orders WHERE business_id = $1 GROUP BY status`,
    [req.businessId]
  );
  res.json({ stats: result.rows });
});

// ================= Public: place an order (for widget/site checkout, keyed by widget_key) =================

router.post('/public/:widgetKey/orders', async (req, res) => {
  const { customer_name, customer_phone, notes, items } = req.body;
  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customer_name, items шаардлагатай' });
  }
  const agentResult = await pool.query('SELECT business_id FROM agents WHERE widget_key = $1', [req.params.widgetKey]);
  const agent = agentResult.rows[0];
  if (!agent) return res.status(404).json({ error: 'Олдсонгүй' });

  const total = items.reduce((sum, i) => sum + Number(i.price) * Number(i.quantity || 1), 0);
  const orderResult = await pool.query(
    `INSERT INTO orders (business_id, customer_name, customer_phone, total_amount, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [agent.business_id, customer_name, customer_phone || null, total, notes || null]
  );
  const order = orderResult.rows[0];
  for (const item of items) {
    await pool.query(
      `INSERT INTO order_items (order_id, product_name, price, quantity) VALUES ($1, $2, $3, $4)`,
      [order.id, item.product_name, item.price, item.quantity || 1]
    );
  }
  res.json({ ok: true, order_id: order.id });
});

router.get('/public/:widgetKey/products', async (req, res) => {
  const agentResult = await pool.query('SELECT business_id FROM agents WHERE widget_key = $1', [req.params.widgetKey]);
  const agent = agentResult.rows[0];
  if (!agent) return res.status(404).json({ error: 'Олдсонгүй' });
  const result = await pool.query(
    'SELECT id, name, price, description, image_url FROM products WHERE business_id = $1 AND in_stock = true ORDER BY created_at DESC',
    [agent.business_id]
  );
  res.json({ products: result.rows });
});

module.exports = router;
