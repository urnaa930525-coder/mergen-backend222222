const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const GRAPH_VERSION = 'v19.0';

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ---- Step 1: browser navigates here (with the user's JWT as a query param,
// since this is a full-page redirect flow, not a fetch call that can carry
// an Authorization header). We re-sign it as the OAuth "state" so Facebook
// hands it straight back to us on the callback. ----
router.get('/facebook/connect', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Нэвтрээгүй байна.');
  try {
    jwt.verify(token, JWT_SECRET); // just validate it belongs to a logged-in business
  } catch (e) {
    return res.status(401).send('Token хүчингүй байна.');
  }

  if (!process.env.FACEBOOK_APP_ID) {
    return res.status(500).send('Серверт FACEBOOK_APP_ID тохируулаагүй байна.');
  }

  const redirectUri = `${getBaseUrl(req)}/oauth/facebook/callback`;
  const scope = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_engagement',
    'business_management',
    'instagram_basic',
    'instagram_manage_comments',
  ].join(',');

  const authUrl = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?` +
    `client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(token)}` +
    `&scope=${encodeURIComponent(scope)}`;

  res.redirect(authUrl);
});

// ---- Step 2: Facebook redirects back here with a `code` and our `state` ----
router.get('/facebook/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const dashboardUrl = `${getBaseUrl(req)}/dashboard.html`;

  if (error) {
    return res.redirect(`${dashboardUrl}?social_error=denied`);
  }
  if (!code || !state) {
    return res.redirect(`${dashboardUrl}?social_error=missing_code`);
  }

  let businessId;
  try {
    const payload = jwt.verify(state, JWT_SECRET);
    businessId = payload.businessId;
  } catch (e) {
    return res.redirect(`${dashboardUrl}?social_error=bad_state`);
  }

  try {
    const redirectUri = `${getBaseUrl(req)}/oauth/facebook/callback`;

    // Exchange code -> short-lived user token
    const tokenRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      `client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${encodeURIComponent(process.env.FACEBOOK_APP_SECRET)}` +
      `&code=${encodeURIComponent(code)}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData));

    // Exchange short-lived -> long-lived user token
    const longTokenRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}` +
      `&client_secret=${encodeURIComponent(process.env.FACEBOOK_APP_SECRET)}` +
      `&fb_exchange_token=${encodeURIComponent(tokenData.access_token)}`
    );
    const longTokenData = await longTokenRes.json();
    const userToken = longTokenData.access_token || tokenData.access_token;

    // Fetch the pages this user manages, with their page access tokens + linked IG account
    const pagesRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userToken)}`
    );
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    if (pages.length === 0) {
      return res.redirect(`${dashboardUrl}?social_error=no_pages`);
    }

    if (pages.length === 1) {
      await savePageConnection(businessId, pages[0]);
      return res.redirect(`${dashboardUrl}?social_connected=1`);
    }

    // Multiple pages: show a simple picker so the user chooses which one.
    const picksHtml = pages
      .map((p) => `<a class="pick" href="/oauth/facebook/choose-page?state=${encodeURIComponent(state)}&page_id=${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>`)
      .join('');
    global.__mergenPendingPages = global.__mergenPendingPages || {};
    global.__mergenPendingPages[businessId] = pages;

    res.send(`<!DOCTYPE html><html lang="mn"><head><meta charset="UTF-8"><title>Page сонгох</title>
      <style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
      .box{max-width:360px;width:100%;padding:24px;}h1{font-size:18px;margin-bottom:16px;}
      .pick{display:block;background:#151515;border:1px solid #333;padding:14px 16px;border-radius:8px;color:#fff;text-decoration:none;margin-bottom:10px;}
      .pick:hover{background:#1f1f1f;}</style></head>
      <body><div class="box"><h1>Аль Page-ээ холбох вэ?</h1>${picksHtml}</div></body></html>`);
  } catch (e) {
    console.error('Facebook OAuth error:', e);
    res.redirect(`${dashboardUrl}?social_error=server_error`);
  }
});

// ---- Step 2b: if the user manages multiple pages, they pick one here ----
router.get('/facebook/choose-page', async (req, res) => {
  const { state, page_id } = req.query;
  const dashboardUrl = `${getBaseUrl(req)}/dashboard.html`;

  let businessId;
  try {
    const payload = jwt.verify(state, JWT_SECRET);
    businessId = payload.businessId;
  } catch (e) {
    return res.redirect(`${dashboardUrl}?social_error=bad_state`);
  }

  const pending = (global.__mergenPendingPages || {})[businessId] || [];
  const page = pending.find((p) => p.id === page_id);
  if (!page) return res.redirect(`${dashboardUrl}?social_error=page_not_found`);

  await savePageConnection(businessId, page);
  delete global.__mergenPendingPages[businessId];
  res.redirect(`${dashboardUrl}?social_connected=1`);
});

async function savePageConnection(businessId, page) {
  const igId = page.instagram_business_account ? page.instagram_business_account.id : null;
  const existing = await pool.query('SELECT id FROM social_accounts WHERE business_id = $1', [businessId]);
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE social_accounts SET page_id=$1, page_name=$2, ig_business_id=$3, access_token=$4 WHERE business_id=$5`,
      [page.id, page.name || null, igId, page.access_token, businessId]
    );
  } else {
    await pool.query(
      `INSERT INTO social_accounts (business_id, page_id, page_name, ig_business_id, access_token) VALUES ($1,$2,$3,$4,$5)`,
      [businessId, page.id, page.name || null, igId, page.access_token]
    );
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = router;
