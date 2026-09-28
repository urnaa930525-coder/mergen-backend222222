const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нэвтрээгүй байна' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
    req.businessId = payload.businessId;
    // Older tokens (issued before team accounts existed) carry no role — treat as owner.
    req.role = payload.role || 'owner';
    req.memberId = payload.memberId || null;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token хүчингүй байна' });
  }
}

// Use AFTER requireAuth. Only the business owner (not invited staff) may pass.
function requireOwner(req, res, next) {
  if (req.role !== 'owner') {
    return res.status(403).json({ error: 'Энэ үйлдлийг зөвхөн эзэмшигч хийх боломжтой' });
  }
  next();
}

module.exports = { requireAuth, requireOwner };
