const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./authMiddleware');
const { requireFeature } = require('./planMiddleware');
const { sendSms } = require('./sms');

const router = express.Router();
const GRAPH_VERSION = 'v19.0';
const requirePlan = [requireAuth, requireFeature('marketing')];

// ================= Scheduled posts =================

router.get('/posts', requirePlan, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM scheduled_posts WHERE business_id = $1 ORDER BY scheduled_at DESC LIMIT 100',
    [req.businessId]
  );
  res.json({ posts: result.rows });
});

router.post('/posts', requirePlan, async (req, res) => {
  const { caption, media_url, scheduled_at, platform } = req.body;
  if (!caption || !scheduled_at) {
    return res.status(400).json({ error: 'caption, scheduled_at шаардлагатай' });
  }
  const result = await pool.query(
    `INSERT INTO scheduled_posts (business_id, caption, media_url, platform, scheduled_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.businessId, caption, media_url || null, platform || 'facebook', scheduled_at]
  );
  res.json({ post: result.rows[0] });
});

router.delete('/posts/:id', requirePlan, async (req, res) => {
  await pool.query(
    'DELETE FROM scheduled_posts WHERE id = $1 AND business_id = $2 AND status = $3',
    [req.params.id, req.businessId, 'pending']
  );
  res.json({ ok: true });
});

// ================= SMS =================

router.get('/sms', requirePlan, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM sms_logs WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.businessId]
  );
  res.json({ logs: result.rows });
});

router.post('/sms', requirePlan, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone, message шаардлагатай' });

  const logResult = await pool.query(
    `INSERT INTO sms_logs (business_id, phone, message, status) VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [req.businessId, phone, message]
  );
  const log = logResult.rows[0];

  try {
    await sendSms(phone, message);
    const updated = await pool.query(
      `UPDATE sms_logs SET status = 'sent' WHERE id = $1 RETURNING *`,
      [log.id]
    );
    res.json({ log: updated.rows[0] });
  } catch (e) {
    const updated = await pool.query(
      `UPDATE sms_logs SET status = 'failed', error = $1 WHERE id = $2 RETURNING *`,
      [e.message, log.id]
    );
    res.status(502).json({ error: e.message, log: updated.rows[0] });
  }
});

// ================= Cron worker: publish due posts =================
// Called periodically (e.g. Render Cron Job) to publish any scheduled_posts
// whose time has come. Protected by CRON_SECRET so it can't be triggered publicly.

router.post('/cron/publish-due', handlePublishDue);
router.get('/cron/publish-due', handlePublishDue);

async function handlePublishDue(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const due = await pool.query(
    `SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= NOW() ORDER BY scheduled_at ASC LIMIT 20`
  );

  const results = [];
  for (const post of due.rows) {
    try {
      const accountResult = await pool.query(
        'SELECT * FROM social_accounts WHERE business_id = $1 LIMIT 1',
        [post.business_id]
      );
      const account = accountResult.rows[0];
      if (!account) throw new Error('Холбогдсон Instagram/Facebook акаунт олдсонгүй');

      await publishPost(account, post);

      await pool.query(`UPDATE scheduled_posts SET status = 'posted' WHERE id = $1`, [post.id]);
      results.push({ id: post.id, status: 'posted' });
    } catch (e) {
      await pool.query(`UPDATE scheduled_posts SET status = 'failed', error = $1 WHERE id = $2`, [e.message, post.id]);
      results.push({ id: post.id, status: 'failed', error: e.message });
    }
  }

  res.json({ processed: results.length, results });
}

async function publishPost(account, post) {
  const pageId = account.page_id;
  const accessToken = account.access_token;

  if (post.media_url) {
    // Photo post
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: post.media_url, caption: post.caption, access_token: accessToken }),
    });
    if (!response.ok) throw new Error(await response.text());
  } else {
    // Text-only feed post
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: post.caption, access_token: accessToken }),
    });
    if (!response.ok) throw new Error(await response.text());
  }
}

module.exports = router;
