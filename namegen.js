const express = require('express');
const { callClaude } = require('./claude');
const { PALETTE } = require('./palette');

const router = express.Router();

// This is a public, unauthenticated endpoint (a marketing/lead-gen tool, like Namelix itself).
// Simple in-memory per-IP rate limit to bound API cost exposure — resets on server restart,
// which is fine for this use case (an abuser just gets a fresh window, but the cost per abuse
// burst stays capped).
const RATE_LIMIT = 15; // requests per IP per hour
const rateLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const hits = (rateLog.get(ip) || []).filter((t) => t > hourAgo);
  hits.push(now);
  rateLog.set(ip, hits);
  return hits.length > RATE_LIMIT;
}

const SHAPES = ['circle', 'rounded-square', 'hexagon'];

function markFor(name, index) {
  const palette = PALETTE[index % PALETTE.length];
  const shape = SHAPES[index % SHAPES.length];
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return { shape, bg: palette.bg, accent: palette.accent, letters: letters || name[0].toUpperCase() };
}

router.post('/generate', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу.' });
  }

  const { idea } = req.body;
  if (!idea || !idea.trim()) return res.status(400).json({ error: 'Бизнесийн санаагаа бичнэ үү' });

  const system = `Чи бол бизнесийн нэр зохион бүтээгч. Хэрэглэгчийн бичсэн санаанд тулгуурлан 8 өвөрмөц, товч (1-3 үгтэй), амаар хэлэхэд хялбар нэр санал болго. Монгол болон/эсвэл латин үсгээр байж болно, гэхдээ тухайн бизнест тохирсон байх ёстой.

ЗӨВХӨН дараах JSON форматаар хариул, өөр юу ч бичихгүй:
[{"name":"Нэр1","tagline":"5-8 үгтэй товч тодорхойлолт"},{"name":"Нэр2","tagline":"..."}]

Давхардсан үг, ерөнхий үг (жишээ нь зөвхөн "Компани", "ХХК") бүү ашигла. Нэр бүр өөр өөр хэв маягтай (нэг үгтэй, хоёр үгийн хослол, шинэлэг үг зохиох гэх мэт) байг.`;

  try {
    const { text } = await callClaude({
      system,
      messages: [{ role: 'user', content: idea.trim() }],
      maxTokens: 500,
    });

    let parsed;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      return res.status(502).json({ error: 'AI хариултыг задлахад алдаа гарлаа, дахин оролдоно уу' });
    }

    const suggestions = parsed.slice(0, 8).map((item, i) => ({
      name: item.name,
      tagline: item.tagline,
      logo: markFor(item.name, i),
    }));

    res.json({ suggestions });
  } catch (e) {
    console.error('Name generation error:', e);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
