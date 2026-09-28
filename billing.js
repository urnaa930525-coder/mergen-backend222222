const express = require('express');
const { pool, PLANS, TOKEN_CONVERSION_RATE } = require('./db');
const { requireAuth, requireOwner } = require('./authMiddleware');
const { createInvoice, checkPayment } = require('./qpay');

const router = express.Router();
const REFERRAL_PERCENT = 0.20;

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ---- Create a QPay invoice to upgrade to a given plan (applies any referral credit first) ----
// Credit is *reserved* (deducted) when the invoice is created, so the same credit can never
// discount two invoices. Any older still-pending invoice of this business is cancelled first and
// its reserved credit is returned, so at most one pending invoice holds credit at a time.
router.post('/create-invoice', requireAuth, requireOwner, async (req, res) => {
  const { plan } = req.body;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.status(400).json({ error: 'Багц буруу байна' });

  // 1. release credit held by older pending invoices
  const cancelled = await pool.query(
    `UPDATE qpay_invoices SET status = 'cancelled'
     WHERE business_id = $1 AND status = 'pending' RETURNING credit_applied`,
    [req.businessId]
  );
  const refund = cancelled.rows.reduce((sum, r) => sum + Number(r.credit_applied || 0), 0);
  if (refund > 0) {
    await pool.query('UPDATE businesses SET credit_balance = credit_balance + $1 WHERE id = $2', [refund, req.businessId]);
  }

  const bizResult = await pool.query('SELECT credit_balance FROM businesses WHERE id = $1', [req.businessId]);
  const creditBalance = Number(bizResult.rows[0].credit_balance) || 0;
  const creditApplied = Math.min(creditBalance, planInfo.price);
  const amountDue = planInfo.price - creditApplied;

  // Credit fully covers the plan — upgrade instantly, no QPay invoice needed.
  if (amountDue <= 0) {
    await pool.query('UPDATE businesses SET plan = $1, credit_balance = credit_balance - $2 WHERE id = $3', [plan, creditApplied, req.businessId]);
    return res.json({ paid_with_credit: true, credit_applied: creditApplied });
  }

  const senderInvoiceNo = `MERGEN-${req.businessId}-${Date.now()}`;

  try {
    const callbackUrl = `${getBaseUrl(req)}/api/billing/webhook`;
    const qpayInvoice = await createInvoice({
      amount: amountDue,
      description: `Mergen ${planInfo.label} багц - 1 сар${creditApplied > 0 ? ` (${creditApplied.toLocaleString()}₮ credit хассан)` : ''}`,
      senderInvoiceNo,
      callbackUrl,
    });

    // reserve the credit now that the QPay invoice exists
    if (creditApplied > 0) {
      await pool.query('UPDATE businesses SET credit_balance = credit_balance - $1 WHERE id = $2', [creditApplied, req.businessId]);
    }

    const result = await pool.query(
      `INSERT INTO qpay_invoices (business_id, plan, amount, credit_applied, qpay_invoice_id, qpay_sender_invoice_no, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
      [req.businessId, plan, amountDue, creditApplied, qpayInvoice.invoice_id, senderInvoiceNo]
    );

    res.json({
      invoice: result.rows[0],
      qr_image: qpayInvoice.qr_image,
      qr_text: qpayInvoice.qr_text,
      urls: qpayInvoice.urls,
      credit_applied: creditApplied,
      original_price: planInfo.price,
    });
  } catch (e) {
    console.error('QPay invoice error:', e);
    res.status(502).json({ error: e.message });
  }
});

// ---- Manually poll payment status (used while the QR is on screen) ----
router.get('/check/:id', requireAuth, async (req, res) => {
  const invoiceResult = await pool.query(
    'SELECT * FROM qpay_invoices WHERE id = $1 AND business_id = $2',
    [req.params.id, req.businessId]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).json({ error: 'Invoice олдсонгүй' });
  if (invoice.status === 'paid') return res.json({ status: 'paid' });

  try {
    const result = await checkPayment(invoice.qpay_invoice_id);
    const paid = result.count > 0 && result.rows.some((r) => r.payment_status === 'PAID');
    if (paid) {
      await markInvoicePaid(invoice);
      return res.json({ status: 'paid' });
    }
    res.json({ status: 'pending' });
  } catch (e) {
    console.error('QPay check error:', e);
    res.status(502).json({ error: e.message });
  }
});

// ---- QPay calls this automatically when payment completes ----
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200); // ack immediately

  try {
    const invoiceId = req.body.invoice_id || req.body.object_id;
    if (!invoiceId) return;

    const invoiceResult = await pool.query(
      'SELECT * FROM qpay_invoices WHERE qpay_invoice_id = $1',
      [invoiceId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice || invoice.status === 'paid') return;

    const result = await checkPayment(invoiceId);
    const paid = result.count > 0 && result.rows.some((r) => r.payment_status === 'PAID');
    if (paid) await markInvoicePaid(invoice);
  } catch (e) {
    console.error('QPay webhook error:', e);
  }
});

async function markInvoicePaid(invoice) {
  // Atomic claim: the dashboard poll and QPay's webhook can fire at the same moment —
  // only the one that actually flips the status may upgrade the plan / pay the referral reward.
  const claimed = await pool.query(
    `UPDATE qpay_invoices SET status = 'paid', paid_at = NOW() WHERE id = $1 AND status <> 'paid' RETURNING id`,
    [invoice.id]
  );
  if (claimed.rows.length === 0) return;

  if (invoice.status === 'cancelled' && Number(invoice.credit_applied) > 0) {
    // the credit was refunded when this invoice was cancelled, but the (discounted) invoice got paid anyway
    await pool.query('UPDATE businesses SET credit_balance = GREATEST(credit_balance - $1, 0) WHERE id = $2', [invoice.credit_applied, invoice.business_id]);
  }

  await pool.query(`UPDATE businesses SET plan = $1 WHERE id = $2`, [invoice.plan, invoice.business_id]);

  // First-ever successful payment of this business? (we already flipped this invoice to paid, so count === 1)
  const paidCount = await pool.query(
    `SELECT COUNT(*) FROM qpay_invoices WHERE business_id = $1 AND status = 'paid'`,
    [invoice.business_id]
  );
  if (parseInt(paidCount.rows[0].count, 10) === 1) {
    const bizResult = await pool.query('SELECT referred_by FROM businesses WHERE id = $1', [invoice.business_id]);
    const referredBy = bizResult.rows[0] ? bizResult.rows[0].referred_by : null;
    if (referredBy) {
      const reward = Number(invoice.amount) * REFERRAL_PERCENT;
      await pool.query('UPDATE businesses SET credit_balance = credit_balance + $1 WHERE id = $2', [reward, referredBy]);
    }
  }
}

// ---- Convert some (or all) of the owner's ₮ credit into bonus AI tokens ----
router.post('/convert-credit', requireAuth, requireOwner, async (req, res) => {
  const { amount } = req.body;
  const bizResult = await pool.query('SELECT credit_balance FROM businesses WHERE id = $1', [req.businessId]);
  const balance = Number(bizResult.rows[0].credit_balance) || 0;

  const toConvert = amount ? Math.min(Number(amount), balance) : balance;
  if (toConvert <= 0) return res.status(400).json({ error: 'Хөрвүүлэх credit алга байна' });

  const tokensGained = Math.round(toConvert * TOKEN_CONVERSION_RATE);
  await pool.query(
    'UPDATE businesses SET credit_balance = credit_balance - $1, bonus_tokens = bonus_tokens + $2 WHERE id = $3',
    [toConvert, tokensGained, req.businessId]
  );
  res.json({ converted: toConvert, tokens_gained: tokensGained, rate: TOKEN_CONVERSION_RATE });
});

module.exports = router;
