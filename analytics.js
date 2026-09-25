const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

router.get('/summary', requireAuth, async (req, res) => {
  const businessId = req.businessId;

  const [
    conversationsResult,
    messagesResult,
    customersResult,
    ordersResult,
    orderStatusResult,
    commentsResult,
    smsResult,
    dailyConversationsResult,
  ] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM conversations WHERE business_id = $1', [businessId]),
    pool.query(
      `SELECT COUNT(*) FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.business_id = $1`,
      [businessId]
    ),
    pool.query(
      `SELECT status, COUNT(*) AS count FROM customers WHERE business_id = $1 GROUP BY status`,
      [businessId]
    ),
    pool.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS revenue FROM orders WHERE business_id = $1`,
      [businessId]
    ),
    pool.query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS revenue
       FROM orders WHERE business_id = $1 GROUP BY status`,
      [businessId]
    ),
    pool.query(
      `SELECT classification, COUNT(*) AS count FROM comment_logs WHERE business_id = $1 GROUP BY classification`,
      [businessId]
    ),
    pool.query(
      `SELECT status, COUNT(*) AS count FROM sms_logs WHERE business_id = $1 GROUP BY status`,
      [businessId]
    ),
    pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM conversations WHERE business_id = $1 AND created_at >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(created_at) ORDER BY day ASC`,
      [businessId]
    ),
  ]);

  res.json({
    conversations_total: parseInt(conversationsResult.rows[0].count, 10),
    messages_total: parseInt(messagesResult.rows[0].count, 10),
    customers_by_status: customersResult.rows,
    orders_total: parseInt(ordersResult.rows[0].count, 10),
    orders_revenue: Number(ordersResult.rows[0].revenue),
    orders_by_status: orderStatusResult.rows,
    comments_by_classification: commentsResult.rows,
    sms_by_status: smsResult.rows,
    conversations_daily: dailyConversationsResult.rows,
  });
});

module.exports = router;
