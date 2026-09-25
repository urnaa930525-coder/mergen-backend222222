const express = require('express');
const { pool, PLANS } = require('./db');
const { requireAuth } = require('./authMiddleware');
const { createInvoice, checkPayment } = require('./qpay');

const router = express.Router();

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ---- Create a QPay invoice to upgrade to a given plan ----
router.post('/create-invoice', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.status(400).json({ error: 'Багц буруу байна' });

  const senderInvoiceNo = `MERGEN-${req.businessId}-${Date.now()}`;

  try {
    const callbackUrl = `${getBaseUrl(req)}/api/billing/webhook`;
    const qpayInvoice = await createInvoice({
      amount: planInfo.price,
      description: `Mergen ${planInfo.label} багц - 1 сар`,
      senderInvoiceNo,
      callbackUrl,
    });

    const result = await pool.query(
      `INSERT INTO qpay_invoices (business_id, plan, amount, qpay_invoice_id, qpay_sender_invoice_no, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [req.businessId, plan, planInfo.price, qpayInvoice.invoice_id, senderInvoiceNo]
    );

    res.json({
      invoice: result.rows[0],
      qr_image: qpayInvoice.qr_image,
      qr_text: qpayInvoice.qr_text,
      urls: qpayInvoice.urls,
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
  await pool.query(`UPDATE qpay_invoices SET status = 'paid', paid_at = NOW() WHERE id = $1`, [invoice.id]);
  await pool.query(`UPDATE businesses SET plan = $1 WHERE id = $2`, [invoice.plan, invoice.business_id]);
}

module.exports = router;
