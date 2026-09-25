const express = require('express');
const { pool } = require('./db');
const { callClaude } = require('./claude');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'mergen-verify-token';
const GRAPH_VERSION = 'v19.0';

// ---- Business-side settings (dashboard) ----

router.post('/connect', requireAuth, async (req, res) => {
  const { page_id, ig_business_id, access_token } = req.body;
  if (!page_id || !access_token) {
    return res.status(400).json({ error: 'page_id, access_token шаардлагатай' });
  }
  const existing = await pool.query('SELECT id FROM social_accounts WHERE business_id = $1', [req.businessId]);
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE social_accounts SET page_id=$1, ig_business_id=$2, access_token=$3 WHERE business_id=$4`,
      [page_id, ig_business_id, access_token, req.businessId]
    );
  } else {
    await pool.query(
      `INSERT INTO social_accounts (business_id, page_id, ig_business_id, access_token) VALUES ($1,$2,$3,$4)`,
      [req.businessId, page_id, ig_business_id, access_token]
    );
  }
  res.json({ ok: true });
});

router.get('/', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, platform, page_id, page_name, ig_business_id, trollguard_enabled, auto_reply_enabled, created_at
     FROM social_accounts WHERE business_id = $1`,
    [req.businessId]
  );
  res.json({ account: result.rows[0] || null });
});

router.put('/settings', requireAuth, async (req, res) => {
  const { trollguard_enabled, auto_reply_enabled } = req.body;
  await pool.query(
    `UPDATE social_accounts SET
       trollguard_enabled = COALESCE($1, trollguard_enabled),
       auto_reply_enabled = COALESCE($2, auto_reply_enabled)
     WHERE business_id = $3`,
    [trollguard_enabled, auto_reply_enabled, req.businessId]
  );
  res.json({ ok: true });
});

router.get('/logs', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM comment_logs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.businessId]
  );
  res.json({ logs: result.rows });
});

// ---- Meta webhook ----

// Verification handshake (Meta calls this once when you register the webhook URL)
router.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming comment events
router.post('/webhook/meta', async (req, res) => {
  res.sendStatus(200); // ack immediately, Meta requires a fast response

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      const igBusinessId = entry.id;
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'comments') continue;
        await handleComment(igBusinessId, change.value);
      }
    }
  } catch (e) {
    console.error('Webhook processing error:', e);
  }
});

async function handleComment(igBusinessId, value) {
  const commentId = value.id;
  const text = value.text || '';
  const author = value.from ? value.from.username || value.from.id : 'unknown';

  const accountResult = await pool.query(
    'SELECT * FROM social_accounts WHERE ig_business_id = $1 OR page_id = $1',
    [igBusinessId]
  );
  const account = accountResult.rows[0];
  if (!account) return; // unregistered account, ignore

  const agentResult = await pool.query(
    'SELECT * FROM agents WHERE business_id = $1 ORDER BY is_primary DESC, created_at ASC LIMIT 1',
    [account.business_id]
  );
  const agent = agentResult.rows[0] || {};

  const classification = await classifyComment(text, agent.knowledge_base);

  let actionTaken = 'none';
  let replyText = null;

  if (classification === 'troll' && account.trollguard_enabled) {
    await hideComment(commentId, account.access_token);
    actionTaken = 'hidden';
  } else if (classification === 'question' && account.auto_reply_enabled) {
    replyText = await generateReply(text, agent.knowledge_base, agent.agent_name);
    await replyToComment(commentId, replyText, account.access_token);
    actionTaken = 'replied';
  }

  await pool.query(
    `INSERT INTO comment_logs (business_id, comment_id, author, comment_text, classification, action_taken, reply_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [account.business_id, commentId, author, text, classification, actionTaken, replyText]
  );
}

async function classifyComment(text, knowledgeBase) {
  const system = `Чи бол Instagram/Facebook коммент ангилагч. Өгөгдсөн коммент-ийг яг эдгээр 3 категорийн ЗӨВХӨН НЭГ үгээр ангилж хариул (өөр юу ч бичихгүй):
- troll: доромжлол, спам, муу санаатай, зохисгүй үг, худал мэдээлэл тараах
- question: жинхэнэ асуулт, тодруулга хэрэгтэй сэтгэгдэл
- positive: эерэг, магтаал, урамшуулал, хариулт заавал биш сэтгэгдэл

Зөвхөн нэг үг буц: troll, question, эсвэл positive.`;
  const result = await callClaude({
    system,
    messages: [{ role: 'user', content: text }],
    maxTokens: 10,
  });
  const cleaned = result.trim().toLowerCase();
  if (cleaned.includes('troll')) return 'troll';
  if (cleaned.includes('question')) return 'question';
  return 'positive';
}

async function generateReply(text, knowledgeBase, agentName) {
  const system = `Чи бол "${agentName || 'Mergen'}" нэртэй Instagram/Facebook-ийн AI хариулагч.
Мэдлэгийн сан:
---
${knowledgeBase || '(хоосон)'}
---
Хэрэглэгчийн коммент бичсэн хэлээр нь, товч (1-2 өгүүлбэр), эелдэг хариул.`;
  return callClaude({
    system,
    messages: [{ role: 'user', content: text }],
    maxTokens: 200,
  });
}

async function hideComment(commentId, accessToken) {
  await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${commentId}?hide=true&access_token=${accessToken}`, {
    method: 'POST',
  });
}

async function replyToComment(commentId, message, accessToken) {
  await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: accessToken }),
  });
}

module.exports = router;
