const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

// ---- Get current business's site (creates an empty draft if none exists) ----
router.get('/', requireAuth, async (req, res) => {
  let result = await pool.query('SELECT * FROM sites WHERE business_id = $1', [req.businessId]);
  if (result.rows.length === 0) {
    const bizResult = await pool.query('SELECT business_name FROM businesses WHERE id = $1', [req.businessId]);
    const bizName = bizResult.rows[0].business_name;
    let baseSlug = slugify(bizName) || 'site';
    let slug = baseSlug;
    let n = 1;
    // ensure uniqueness
    while (true) {
      const clash = await pool.query('SELECT id FROM sites WHERE slug = $1', [slug]);
      if (clash.rows.length === 0) break;
      n += 1;
      slug = `${baseSlug}-${n}`;
    }
    const inserted = await pool.query(
      `INSERT INTO sites (business_id, slug, title) VALUES ($1, $2, $3) RETURNING *`,
      [req.businessId, slug, bizName]
    );
    result = inserted;
  }
  res.json({ site: result.rows[0] });
});

// ---- Save blocks/title/theme (draft — does not publish) ----
router.put('/', requireAuth, async (req, res) => {
  const { title, blocks, slug, bg_color, accent_color } = req.body;
  let finalSlug = slug ? slugify(slug) : undefined;

  if (finalSlug) {
    const clash = await pool.query(
      'SELECT id FROM sites WHERE slug = $1 AND business_id != $2',
      [finalSlug, req.businessId]
    );
    if (clash.rows.length > 0) {
      return res.status(409).json({ error: 'Энэ хаяг (slug) өөр бизнест ашиглагдаж байна' });
    }
  }

  const result = await pool.query(
    `UPDATE sites SET
       title = COALESCE($1, title),
       blocks = COALESCE($2, blocks),
       slug = COALESCE($3, slug),
       bg_color = COALESCE($4, bg_color),
       accent_color = COALESCE($5, accent_color),
       updated_at = NOW()
     WHERE business_id = $6 RETURNING *`,
    [title, blocks ? JSON.stringify(blocks) : null, finalSlug, bg_color, accent_color, req.businessId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Сайт олдсонгүй' });
  res.json({ site: result.rows[0] });
});

// ---- Publish / unpublish ----
router.post('/publish', requireAuth, async (req, res) => {
  const { published } = req.body;
  const result = await pool.query(
    `UPDATE sites SET published = $1, updated_at = NOW() WHERE business_id = $2 RETURNING *`,
    [published !== false, req.businessId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Сайт олдсонгүй' });
  res.json({ site: result.rows[0] });
});

// ---- Render a published site's blocks into HTML (used by the public /site/:slug route in server.js) ----
function renderSiteHtml(site) {
  const blocks = Array.isArray(site.blocks) ? site.blocks : [];
  const bgColor = site.bg_color || '#fff8f0';
  const accentColor = site.accent_color || '#e8562f';
  const accentLight = shadeColor(accentColor, 0.22);
  const body = blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `<h1 class="blk-heading">${escapeHtml(b.content.text || '')}</h1>`;
        case 'text':
          return `<p class="blk-text">${escapeHtml(b.content.text || '').replace(/\n/g, '<br/>')}</p>`;
        case 'image':
          return b.content.url
            ? `<img class="blk-image" src="${escapeAttr(b.content.url)}" alt="${escapeAttr(b.content.alt || '')}" />`
            : '';
        case 'button':
          return `<a class="blk-button" href="${escapeAttr(b.content.url || '#')}">${escapeHtml(b.content.text || 'Дарах')}</a>`;
        case 'divider':
          return `<hr class="blk-divider" />`;
        default:
          return '';
      }
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="mn">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(site.title || 'Сайт')}</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, 'Segoe UI', sans-serif; background:${escapeAttr(bgColor)}; color:#221c14; line-height:1.6; }
  .topbar { height: 8px; background: linear-gradient(90deg, ${escapeAttr(accentColor)}, ${escapeAttr(accentLight)}); }
  .page { max-width: 720px; margin: 0 auto; padding: 56px 24px 100px; position: relative; }
  .blob { position: absolute; top: -60px; right: -80px; width: 260px; height: 260px; border-radius: 50%; background: ${escapeAttr(accentColor)}; opacity: 0.12; filter: blur(2px); z-index: 0; }
  .page > * { position: relative; z-index: 1; }
  .blk-heading { font-size: 36px; font-weight: 800; margin: 0 0 18px; line-height:1.2; color: #201a10; }
  .blk-text { font-size: 16px; color: #514434; margin: 0 0 22px; }
  .blk-image { width: 100%; border-radius: 14px; margin: 0 0 22px; display:block; box-shadow: 0 10px 30px -12px ${escapeAttr(accentColor)}55; }
  .blk-button { display:inline-block; background: linear-gradient(120deg, ${escapeAttr(accentColor)}, ${escapeAttr(accentLight)}); color:#fff; text-decoration:none; padding: 13px 26px; border-radius: 999px; font-weight:700; margin: 0 0 22px; box-shadow: 0 8px 20px -8px ${escapeAttr(accentColor)}88; }
  .blk-divider { border: none; border-top: 3px solid ${escapeAttr(accentColor)}; opacity: 0.35; border-radius: 3px; margin: 34px 0; }
</style>
</head>
<body>
  <div class="topbar"></div>
  <div class="page">
    <div class="blob"></div>
    ${body}
  </div>
</body>
</html>`;
}

function shadeColor(hex, percent) {
  try {
    const num = parseInt(hex.replace('#', ''), 16);
    let r = (num >> 16) + Math.round(255 * percent);
    let g = ((num >> 8) & 0x00ff) + Math.round(255 * percent);
    let b = (num & 0x0000ff) + Math.round(255 * percent);
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  } catch (e) {
    return hex;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

module.exports = router;
module.exports.renderSiteHtml = renderSiteHtml;
