const { pool, PLANS } = require('./db');

// Use AFTER requireAuth (needs req.businessId already set).
function requireFeature(featureName) {
  return async (req, res, next) => {
    try {
      const result = await pool.query('SELECT plan FROM businesses WHERE id = $1', [req.businessId]);
      const plan = PLANS[result.rows[0].plan] || PLANS.start;
      if (!plan.features.includes(featureName)) {
        return res.status(403).json({
          error: `Энэ боломж "${plan.label}" багцад ороогүй байна. Илүү өндөр багц руу шилжинэ үү.`,
          upgrade_required: true,
        });
      }
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Серверийн алдаа' });
    }
  };
}

module.exports = { requireFeature };
