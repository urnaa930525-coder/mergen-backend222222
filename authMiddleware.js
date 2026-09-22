const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нэвтрээгүй байна' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
    req.businessId = payload.businessId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token хүчингүй байна' });
  }
}

module.exports = { requireAuth };
