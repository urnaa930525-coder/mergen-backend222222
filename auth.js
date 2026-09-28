const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./db');
const { TEMPLATES } = require('./templates');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex'); // 8-char code, e.g. "a1b2c3d4"
}

router.post('/signup', async (req, res) => {
  const { email, password, business_name, ref, template } = req.body;
  if (!email || !password || !business_name) {
    return res.status(400).json({ error: 'email, password, business_name шаардлагатай' });
  }
  try {
    const existing = await pool.query('SELECT id FROM businesses WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Энэ email аль хэдийн бүртгэлтэй байна' });
    }
    const passwordHash = await bcrypt.hash(password, 10);

    let referredBy = null;
    if (ref) {
      const referrer = await pool.query('SELECT id FROM businesses WHERE referral_code = $1', [ref]);
      if (referrer.rows[0]) referredBy = referrer.rows[0].id;
    }

    let referralCode = generateReferralCode();
    // extremely unlikely, but guard against a collision
    for (let i = 0; i < 5; i++) {
      const clash = await pool.query('SELECT id FROM businesses WHERE referral_code = $1', [referralCode]);
      if (clash.rows.length === 0) break;
      referralCode = generateReferralCode();
    }

    const result = await pool.query(
      `INSERT INTO businesses (email, password_hash, business_name, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, business_name, plan, referral_code`,
      [email, passwordHash, business_name, referralCode, referredBy]
    );
    const business = result.rows[0];

    const chosenTemplate = template && TEMPLATES[template] ? TEMPLATES[template] : null;
    const widgetKey = uuidv4();
    await pool.query(
      `INSERT INTO agents (business_id, widget_key, is_primary, agent_name, welcome_message, knowledge_base)
       VALUES ($1, $2, true, $3, $4, $5)`,
      [
        business.id,
        widgetKey,
        chosenTemplate ? chosenTemplate.agent_name : 'Онч',
        chosenTemplate ? chosenTemplate.welcome_message : 'Сайн байна уу! Танд юугаар туслах вэ?',
        chosenTemplate ? chosenTemplate.knowledge_base.replace('[Бизнесийн нэр]', business_name).replace(/\[Ресторан\/кафений нэр\]|\[Салоны нэр\]|\[Дэлгүүрийн нэр\]|\[Эмнэлэг\/клиникийн нэр\]/g, business_name) : '',
      ]
    );

    const token = jwt.sign({ businessId: business.id, role: 'owner' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, business });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Серверийн алдаа' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email, password шаардлагатай' });
  try {
    // Owners log in via the businesses table.
    const bizResult = await pool.query('SELECT * FROM businesses WHERE email = $1', [email]);
    const business = bizResult.rows[0];
    if (business) {
      const ok = await bcrypt.compare(password, business.password_hash);
      if (!ok) return res.status(401).json({ error: 'Email эсвэл нууц үг буруу байна' });

      if (!business.referral_code) {
        let code = generateReferralCode();
        for (let i = 0; i < 5; i++) {
          const clash = await pool.query('SELECT id FROM businesses WHERE referral_code = $1', [code]);
          if (clash.rows.length === 0) break;
          code = generateReferralCode();
        }
        await pool.query('UPDATE businesses SET referral_code = $1 WHERE id = $2', [code, business.id]);
        business.referral_code = code;
      }

      const token = jwt.sign({ businessId: business.id, role: 'owner' }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({
        token,
        business: { id: business.id, email: business.email, business_name: business.business_name, plan: business.plan },
        role: 'owner',
      });
    }

    // Otherwise, try an invited team member.
    const memberResult = await pool.query('SELECT * FROM team_members WHERE email = $1', [email]);
    const member = memberResult.rows[0];
    if (!member) return res.status(401).json({ error: 'Email эсвэл нууц үг буруу байна' });
    const memberOk = await bcrypt.compare(password, member.password_hash);
    if (!memberOk) return res.status(401).json({ error: 'Email эсвэл нууц үг буруу байна' });

    const bizForMember = await pool.query('SELECT id, email, business_name, plan FROM businesses WHERE id = $1', [member.business_id]);
    const token = jwt.sign(
      { businessId: member.business_id, role: 'staff', memberId: member.id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, business: bizForMember.rows[0], role: 'staff' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Серверийн алдаа' });
  }
});

module.exports = router;
