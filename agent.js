const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool, PLANS } = require('./db');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

// ---- Plan info ----
router.get('/plan', requireAuth, async (req, res) => {
  const bizResult = await pool.query('SELECT plan FROM businesses WHERE id = $1', [req.businessId]);
  const plan = bizResult.rows[0].plan;
  const countResult = await pool.query('SELECT COUNT(*) FROM agents WHERE business_id = $1', [req.businessId]);
  res.json({
    plan,
    plan_label: (PLANS[plan] || PLANS.start).label,
    max_agents: (PLANS[plan] || PLANS.start).max_agents,
    agents_used: parseInt(countResult.rows[0].count, 10),
    all_plans: PLANS,
  });
});

// ---- List all agents for this business ----
router.get('/', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM agents WHERE business_id = $1 ORDER BY is_primary DESC, created_at ASC',
    [req.businessId]
  );
  res.json({ agents: result.rows });
});

// ---- Create a new agent (limited by plan) ----
router.post('/', requireAuth, async (req, res) => {
  const { agent_name } = req.body;
  const bizResult = await pool.query('SELECT plan FROM businesses WHERE id = $1', [req.businessId]);
  const plan = PLANS[bizResult.rows[0].plan] || PLANS.start;
  const countResult = await pool.query('SELECT COUNT(*) FROM agents WHERE business_id = $1', [req.businessId]);
  const used = parseInt(countResult.rows[0].count, 10);

  if (used >= plan.max_agents) {
    return res.status(403).json({
      error: `Таны "${plan.label}" багц дээр дээд тал нь ${plan.max_agents} agent үүсгэх боломжтой. Илүү үнэтэй багцад шилжинэ үү.`,
    });
  }

  const widgetKey = uuidv4();
  const result = await pool.query(
    `INSERT INTO agents (business_id, agent_name, widget_key) VALUES ($1, $2, $3) RETURNING *`,
    [req.businessId, agent_name || 'Шинэ agent', widgetKey]
  );
  res.json({ agent: result.rows[0] });
});

// ---- Update one agent ----
router.put('/:id', requireAuth, async (req, res) => {
  const { agent_name, knowledge_base, welcome_message, primary_color } = req.body;
  const result = await pool.query(
    `UPDATE agents SET
       agent_name = COALESCE($1, agent_name),
       knowledge_base = COALESCE($2, knowledge_base),
       welcome_message = COALESCE($3, welcome_message),
       primary_color = COALESCE($4, primary_color)
     WHERE id = $5 AND business_id = $6 RETURNING *`,
    [agent_name, knowledge_base, welcome_message, primary_color, req.params.id, req.businessId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Agent олдсонгүй' });
  res.json({ agent: result.rows[0] });
});

// ---- Delete one agent (cannot delete the primary agent) ----
router.delete('/:id', requireAuth, async (req, res) => {
  const agentResult = await pool.query(
    'SELECT * FROM agents WHERE id = $1 AND business_id = $2',
    [req.params.id, req.businessId]
  );
  const agent = agentResult.rows[0];
  if (!agent) return res.status(404).json({ error: 'Agent олдсонгүй' });
  if (agent.is_primary) return res.status(400).json({ error: 'Үндсэн agent-ийг устгах боломжгүй' });

  await pool.query('DELETE FROM agents WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---- Conversations for one agent ----
router.get('/:id/conversations', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, session_id, created_at FROM conversations
     WHERE agent_id = $1 AND business_id = $2 ORDER BY created_at DESC LIMIT 100`,
    [req.params.id, req.businessId]
  );
  res.json({ conversations: result.rows });
});

router.get('/:agentId/conversations/:id', requireAuth, async (req, res) => {
  const convo = await pool.query(
    `SELECT * FROM conversations WHERE id = $1 AND agent_id = $2 AND business_id = $3`,
    [req.params.id, req.params.agentId, req.businessId]
  );
  if (!convo.rows[0]) return res.status(404).json({ error: 'Олдсонгүй' });
  const messages = await pool.query(
    `SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [req.params.id]
  );
  res.json({ messages: messages.rows });
});

module.exports = router;
