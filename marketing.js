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
  const { caption, media_url, scheduled_at, platform, boost_enabled, boost_budget, boost_duration_days } = req.body;
  if (!caption || !scheduled_at) {
    return res.status(400).json({ error: 'caption, scheduled_at шаардлагатай' });
  }
  if (boost_enabled && (!boost_budget || Number(boost_budget) <= 0)) {
    return res.status(400).json({ error: 'Boost асаасан бол өдрийн төсөв (boost_budget) шаардлагатай' });
  }
  const result = await pool.query(
    `INSERT INTO scheduled_posts (business_id, caption, media_url, platform, scheduled_at, boost_enabled, boost_budget, boost_duration_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      req.businessId, caption, media_url || null, platform || 'facebook', scheduled_at,
      boost_enabled || false, boost_budget || null, boost_duration_days || 3,
    ]
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
// Called periodically (e.g. cron-job.org) to publish any scheduled_posts
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

      const fbPostId = await publishPost(account, post);
      await pool.query(`UPDATE scheduled_posts SET status = 'posted', fb_post_id = $1 WHERE id = $2`, [fbPostId, post.id]);
      results.push({ id: post.id, status: 'posted' });

      if (post.boost_enabled) {
        try {
          if (!account.ad_account_id) throw new Error('Холбогдсон Ad Account алга (Facebook холболтоо шинэчилнэ үү)');
          const campaignId = await createBoostCampaign(account, post, fbPostId);
          await pool.query(`UPDATE scheduled_posts SET boost_campaign_id = $1, boost_status = 'created' WHERE id = $2`, [campaignId, post.id]);
        } catch (boostErr) {
          console.error('Boost error:', boostErr);
          await pool.query(`UPDATE scheduled_posts SET boost_status = 'failed', error = $1 WHERE id = $2`, [
            'Boost алдаа: ' + boostErr.message, post.id,
          ]);
        }
      }
    } catch (e) {
      await pool.query(`UPDATE scheduled_posts SET status = 'failed', error = $1 WHERE id = $2`, [e.message, post.id]);
      results.push({ id: post.id, status: 'failed', error: e.message });
    }
  }

  res.json({ processed: results.length, results });
}

// ---- Publish to the Page; returns the Facebook post ID (pageId_postId) ----
async function publishPost(account, post) {
  const pageId = account.page_id;
  const accessToken = account.access_token;

  if (post.media_url) {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: post.media_url, caption: post.caption, access_token: accessToken }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data.post_id || data.id; // /photos returns post_id separately from the photo's own id
  } else {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: post.caption, access_token: accessToken }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data.id; // already "pageId_postId"
  }
}

// ---- Boost a just-published post via the Meta Marketing API ----
// Creates: campaign -> ad set (with the daily budget) -> creative (pointing at the post) -> ad.
// Requires account.ad_account_id (e.g. "act_123456789") and the ads_management permission,
// and the business's own funded Ad Account in Meta Business Manager — Mergen never touches
// that spend; Meta bills the business directly.
async function createBoostCampaign(account, post, fbPostId) {
  const adAccountId = account.ad_account_id;
  const accessToken = account.access_token;
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}`;

  const campaignRes = await fetch(`${base}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Mergen boost — post #${post.id}`,
      objective: 'OUTCOME_ENGAGEMENT',
      status: 'ACTIVE',
      special_ad_categories: [],
      access_token: accessToken,
    }),
  });
  if (!campaignRes.ok) throw new Error(await campaignRes.text());
  const campaign = await campaignRes.json();

  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + (post.boost_duration_days || 3) * 24 * 60 * 60 * 1000);
  // NOTE: daily_budget is in the ad account's currency minor unit. For MNT (no minor unit)
  // Meta typically expects the whole ₮ amount; verify against your Ad Account's actual
  // currency before relying on this in production.
  const adsetRes = await fetch(`${base}/adsets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Mergen boost adset — post #${post.id}`,
      campaign_id: campaign.id,
      daily_budget: Math.round(Number(post.boost_budget)),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'POST_ENGAGEMENT',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: { geo_locations: { countries: ['MN'] } },
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      status: 'ACTIVE',
      access_token: accessToken,
    }),
  });
  if (!adsetRes.ok) throw new Error(await adsetRes.text());
  const adset = await adsetRes.json();

  const creativeRes = await fetch(`${base}/adcreatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Mergen boost creative — post #${post.id}`,
      object_story_id: fbPostId,
      access_token: accessToken,
    }),
  });
  if (!creativeRes.ok) throw new Error(await creativeRes.text());
  const creative = await creativeRes.json();

  const adRes = await fetch(`${base}/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Mergen boost ad — post #${post.id}`,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: 'ACTIVE',
      access_token: accessToken,
    }),
  });
  if (!adRes.ok) throw new Error(await adRes.text());

  return campaign.id;
}

module.exports = router;
