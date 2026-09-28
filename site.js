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

// ---- Public: products/orders scoped by a published site's slug (used by the products block) ----
router.get('/public/:slug/products', async (req, res) => {
  const siteResult = await pool.query('SELECT business_id FROM sites WHERE slug = $1 AND published = true', [req.params.slug]);
  const site = siteResult.rows[0];
  if (!site) return res.status(404).json({ error: 'Олдсонгүй' });
  const result = await pool.query(
    'SELECT id, name, price, description, image_url FROM products WHERE business_id = $1 AND in_stock = true ORDER BY created_at DESC',
    [site.business_id]
  );
  res.json({ products: result.rows });
});

router.post('/public/:slug/orders', async (req, res) => {
  const { customer_name, customer_phone, notes, items } = req.body;
  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customer_name, items шаардлагатай' });
  }
  const siteResult = await pool.query('SELECT business_id FROM sites WHERE slug = $1 AND published = true', [req.params.slug]);
  const site = siteResult.rows[0];
  if (!site) return res.status(404).json({ error: 'Олдсонгүй' });

  const total = items.reduce((sum, i) => sum + Number(i.price) * Number(i.quantity || 1), 0);
  const orderResult = await pool.query(
    `INSERT INTO orders (business_id, customer_name, customer_phone, total_amount, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [site.business_id, customer_name, customer_phone || null, total, notes || null]
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

// ---- Render a published site's blocks into HTML (used by the public /site/:slug route in server.js) ----
function renderSiteHtml(site) {
  const blocks = Array.isArray(site.blocks) ? site.blocks : [];
  const hasShop = blocks.some((b) => b.type === 'products');
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
        case 'products':
          return `<div class="blk-shop" id="mergen-shop"><div class="shop-loading">Бүтээгдэхүүн ачаалж байна...</div></div>`;
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
  .blk-shop { margin: 0 0 22px; }
  .shop-loading, .shop-empty { color: #77694f; font-size: 14px; }
  .shop-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
  .shop-card { background: rgba(255,255,255,0.6); border: 1px solid ${escapeAttr(accentColor)}33; border-radius: 12px; padding: 14px; }
  .shop-card .name { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .shop-card .price { color: #514434; font-size: 13px; margin-bottom: 10px; }
  .shop-card button { width: 100%; border: none; background: ${escapeAttr(accentColor)}; color: #fff; padding: 9px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; }
  .shop-cartbar { position: sticky; bottom: 0; background: #fff; border-top: 2px solid ${escapeAttr(accentColor)}; padding: 12px 16px; margin-top: 14px; border-radius: 10px; display: none; justify-content: space-between; align-items: center; box-shadow: 0 -6px 20px rgba(0,0,0,0.08); }
  .shop-cartbar button { border: none; background: ${escapeAttr(accentColor)}; color: #fff; padding: 9px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; }
  .shop-modal-backdrop { position: fixed; inset: 0; background: rgba(20,15,8,0.5); display: none; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
  .shop-modal { background: #fff; border-radius: 14px; padding: 22px; max-width: 360px; width: 100%; }
  .shop-modal h3 { font-size: 16px; margin-bottom: 10px; }
  .shop-modal label { font-size: 12px; color: #777; display: block; margin: 10px 0 4px; }
  .shop-modal input, .shop-modal textarea { width: 100%; padding: 9px; border: 1px solid #ddd; border-radius: 8px; font-family: inherit; font-size: 13px; box-sizing: border-box; }
  .shop-modal button.submit { width: 100%; margin-top: 14px; border: none; background: ${escapeAttr(accentColor)}; color: #fff; padding: 11px; border-radius: 8px; font-weight: 700; cursor: pointer; }
  .shop-modal .close { background: transparent; border: none; color: #999; margin-top: 8px; cursor: pointer; text-decoration: underline; font-size: 12px; }
</style>
</head>
<body>
  <div class="topbar"></div>
  <div class="page">
    <div class="blob"></div>
    ${body}
  </div>

  ${hasShop ? `<div class="shop-cartbar" id="mergenCartBar">
    <span id="mergenCartLabel">Сагс хоосон</span>
    <button id="mergenCartCheckoutBtn">Захиалах</button>
  </div>
  <div class="shop-modal-backdrop" id="mergenModal">
    <div class="shop-modal">
      <h3>Захиалгын мэдээлэл</h3>
      <div id="mergenModalSummary" style="font-size:13px;color:#555;"></div>
      <label>Нэр</label>
      <input id="mergenModalName" />
      <label>Утас</label>
      <input id="mergenModalPhone" />
      <label>Тэмдэглэл (сонголт)</label>
      <textarea id="mergenModalNotes" style="min-height:50px;"></textarea>
      <button class="submit" id="mergenModalSubmit">Захиалга илгээх</button>
      <div id="mergenModalMsg" style="margin-top:8px;font-size:13px;"></div>
      <button class="close" id="mergenModalClose">Хаах</button>
    </div>
  </div>
  <script>
    (function () {
      var slug = ${JSON.stringify(site.slug)};
      var cart = [];
      var shopEl = document.getElementById('mergen-shop');

      fetch('/api/site/public/' + slug + '/products')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var products = data.products || [];
          if (products.length === 0) { shopEl.innerHTML = '<div class="shop-empty">Одоогоор бүтээгдэхүүн байхгүй байна.</div>'; return; }
          var grid = document.createElement('div');
          grid.className = 'shop-grid';
          products.forEach(function (p) {
            var card = document.createElement('div');
            card.className = 'shop-card';
            var img = p.image_url ? '<img src="' + p.image_url + '" style="width:100%;border-radius:8px;margin-bottom:8px;" />' : '';
            card.innerHTML = img + '<div class="name"></div><div class="price">' + Number(p.price).toLocaleString() + '₮</div>';
            card.querySelector('.name').textContent = p.name;
            var btn = document.createElement('button');
            btn.textContent = 'Сагслах';
            btn.addEventListener('click', function () { addToCart(p); });
            card.appendChild(btn);
            grid.appendChild(card);
          });
          shopEl.innerHTML = '';
          shopEl.appendChild(grid);
        })
        .catch(function () { shopEl.innerHTML = '<div class="shop-empty">Ачаалахад алдаа гарлаа.</div>'; });

      function addToCart(p) {
        var existing = cart.find(function (i) { return i.id === p.id; });
        if (existing) { existing.quantity += 1; } else { cart.push({ id: p.id, name: p.name, price: p.price, quantity: 1 }); }
        updateCartBar();
      }

      function updateCartBar() {
        var bar = document.getElementById('mergenCartBar');
        var count = cart.reduce(function (s, i) { return s + i.quantity; }, 0);
        var total = cart.reduce(function (s, i) { return s + i.quantity * Number(i.price); }, 0);
        bar.style.display = count > 0 ? 'flex' : 'none';
        document.getElementById('mergenCartLabel').textContent = count + ' ширхэг — ' + total.toLocaleString() + '₮';
      }

      document.getElementById('mergenCartCheckoutBtn').addEventListener('click', function () {
        document.getElementById('mergenModalSummary').innerHTML = cart.map(function (i) {
          return i.name + ' ×' + i.quantity + ' — ' + (i.price * i.quantity).toLocaleString() + '₮';
        }).join('<br/>');
        document.getElementById('mergenModal').style.display = 'flex';
      });
      document.getElementById('mergenModalClose').addEventListener('click', function () {
        document.getElementById('mergenModal').style.display = 'none';
      });
      document.getElementById('mergenModalSubmit').addEventListener('click', function () {
        var name = document.getElementById('mergenModalName').value.trim();
        var phone = document.getElementById('mergenModalPhone').value.trim();
        var notes = document.getElementById('mergenModalNotes').value.trim();
        var msgEl = document.getElementById('mergenModalMsg');
        if (!name || !phone) { msgEl.innerHTML = '<span style="color:#c0392b;">Нэр, утасны дугаараа бөглөнө үү.</span>'; return; }
        fetch('/api/site/public/' + slug + '/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: name, customer_phone: phone, notes: notes,
            items: cart.map(function (i) { return { product_name: i.name, price: i.price, quantity: i.quantity }; }),
          }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok) {
              msgEl.innerHTML = '<span style="color:#1a7d3c;">Захиалга амжилттай илгээгдлээ ✓</span>';
              cart = [];
              setTimeout(function () { document.getElementById('mergenModal').style.display = 'none'; updateCartBar(); }, 1500);
            } else {
              msgEl.innerHTML = '<span style="color:#c0392b;">' + (data.error || 'Алдаа гарлаа') + '</span>';
            }
          })
          .catch(function () { msgEl.innerHTML = '<span style="color:#c0392b;">Сүлжээний алдаа гарлаа.</span>'; });
      });
    })();
  </script>` : ''}
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
