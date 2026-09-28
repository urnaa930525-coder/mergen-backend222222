const express = require('express');
const { callClaude } = require('./claude');
const { PALETTE } = require('./palette');

const router = express.Router();

// Public, unauthenticated tool — same rate-limit pattern as namegen.js.
const RATE_LIMIT = 15;
const rateLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const hits = (rateLog.get(ip) || []).filter((t) => t > hourAgo);
  hits.push(now);
  rateLog.set(ip, hits);
  return hits.length > RATE_LIMIT;
}

router.post('/generate', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу.' });
  }

  const { idea } = req.body;
  if (!idea || !idea.trim()) return res.status(400).json({ error: 'Санаагаа бичнэ үү' });

  const system = `Чи бол сошиал медиа постын зурагт бичвэр зохиогч. Хэрэглэгчийн бичсэн санаанаас Instagram/Facebook пост зурган дээр байрлуулах маш товч бичвэр гарга:
- headline: хамгийн ихдээ 6 үг, том бичигдэх гарчиг (жишээ нь "50% ХЯМДРАЛ ӨНӨӨДӨР")
- subtext: хамгийн ихдээ 10 үг, гарчгийг тодруулах товч мөр

ЗӨВХӨН дараах JSON форматаар хариул, өөр юу ч бичихгүй:
{"headline":"...","subtext":"..."}`;

  try {
    const { text } = await callClaude({
      system,
      messages: [{ role: 'user', content: idea.trim() }],
      maxTokens: 150,
    });

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      return res.status(502).json({ error: 'AI хариултыг задлахад алдаа гарлаа, дахин оролдоно уу' });
    }

    const paletteIndex = Math.floor(Math.random() * PALETTE.length);
    res.json({
      headline: parsed.headline,
      subtext: parsed.subtext,
      palette: PALETTE[paletteIndex],
    });
  } catch (e) {
    console.error('Content generation error:', e);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
