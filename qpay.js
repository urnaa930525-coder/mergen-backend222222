// QPay Merchant API client (v2). Docs: https://developer.qpay.mn
// Needs QPAY_CLIENT_ID, QPAY_CLIENT_SECRET, QPAY_INVOICE_CODE env vars from QPay.
// Defaults to the sandbox host until QPAY_BASE_URL is set to the production one.

let cachedToken = null;
let cachedTokenExpiry = 0;

function getBaseUrl() {
  return process.env.QPAY_BASE_URL || 'https://merchant-sandbox.qpay.mn';
}

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const clientId = process.env.QPAY_CLIENT_ID;
  const clientSecret = process.env.QPAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('QPAY_CLIENT_ID, QPAY_CLIENT_SECRET тохируулаагүй байна.');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${getBaseUrl()}/v2/auth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`QPay auth алдаа: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  cachedToken = data.access_token;
  // refresh a little early to be safe
  cachedTokenExpiry = Date.now() + (data.expires_in ? (data.expires_in - 60) * 1000 : 5 * 60 * 1000);
  return cachedToken;
}

async function createInvoice({ amount, description, senderInvoiceNo, callbackUrl }) {
  const token = await getToken();
  const invoiceCode = process.env.QPAY_INVOICE_CODE;
  if (!invoiceCode) throw new Error('QPAY_INVOICE_CODE тохируулаагүй байна.');

  const response = await fetch(`${getBaseUrl()}/v2/invoice`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      invoice_code: invoiceCode,
      sender_invoice_no: senderInvoiceNo,
      invoice_receiver_code: 'terminal',
      invoice_description: description,
      amount,
      callback_url: callbackUrl,
    }),
  });
  if (!response.ok) {
    throw new Error(`QPay invoice үүсгэхэд алдаа: ${response.status} ${await response.text()}`);
  }
  return response.json(); // { invoice_id, qr_image, qr_text, urls, ... }
}

async function checkPayment(invoiceId) {
  const token = await getToken();
  const response = await fetch(`${getBaseUrl()}/v2/payment/check`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      object_type: 'INVOICE',
      object_id: invoiceId,
    }),
  });
  if (!response.ok) {
    throw new Error(`QPay төлбөр шалгахад алдаа: ${response.status} ${await response.text()}`);
  }
  return response.json(); // { count, rows: [{ payment_status, ... }] }
}

module.exports = { getToken, createInvoice, checkPayment };
