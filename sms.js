// Generic SMS gateway client. Works with SMS.to and most gateways that follow
// the same pattern (Bearer token, JSON body with message/to/sender_id).
// Configure via env vars: SMS_API_URL, SMS_API_KEY, SMS_SENDER_ID.
async function sendSms(phone, message) {
  const apiUrl = process.env.SMS_API_URL || 'https://api.sms.to/sms/send';
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || 'Mergen';

  if (!apiKey) {
    throw new Error('SMS_API_KEY тохируулаагүй байна. SMS gateway-тэй холбогдох шаардлагатай.');
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      message,
      to: phone,
      sender_id: senderId,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SMS gateway алдаа: ${response.status} ${errText}`);
  }

  return response.json();
}

module.exports = { sendSms };
