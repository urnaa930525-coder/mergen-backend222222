const { pool, PLANS } = require('./db');

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ---- Has this business already used up its plan's monthly quota + bonus token pool? ----
async function isOverTokenLimit(businessId) {
  const bizResult = await pool.query('SELECT plan, bonus_tokens FROM businesses WHERE id = $1', [businessId]);
  if (!bizResult.rows[0]) return false;
  const plan = PLANS[bizResult.rows[0].plan] || PLANS.start;
  const bonusTokens = Number(bizResult.rows[0].bonus_tokens) || 0;

  const usageResult = await pool.query(
    'SELECT tokens_used FROM token_usage WHERE business_id = $1 AND year_month = $2',
    [businessId, currentYearMonth()]
  );
  const used = usageResult.rows[0] ? Number(usageResult.rows[0].tokens_used) : 0;
  // Bonus tokens (from referrals) top up the monthly quota until spent.
  return { over: used >= plan.token_limit && bonusTokens <= 0, used, limit: plan.token_limit, bonus: bonusTokens };
}

// ---- Record tokens spent by this business — draws from any bonus pool first, then the monthly quota ----
async function recordTokenUsage(businessId, tokens) {
  if (!tokens || tokens <= 0) return;

  const bizResult = await pool.query('SELECT bonus_tokens FROM businesses WHERE id = $1', [businessId]);
  const bonusAvailable = bizResult.rows[0] ? Number(bizResult.rows[0].bonus_tokens) : 0;
  const fromBonus = Math.min(bonusAvailable, tokens);
  const remaining = tokens - fromBonus;

  if (fromBonus > 0) {
    await pool.query('UPDATE businesses SET bonus_tokens = bonus_tokens - $1 WHERE id = $2', [fromBonus, businessId]);
  }
  if (remaining > 0) {
    const yearMonth = currentYearMonth();
    await pool.query(
      `INSERT INTO token_usage (business_id, year_month, tokens_used)
       VALUES ($1, $2, $3)
       ON CONFLICT (business_id, year_month)
       DO UPDATE SET tokens_used = token_usage.tokens_used + $3`,
      [businessId, yearMonth, remaining]
    );
  }
}

// ---- Call Claude; returns { text, usage: { input_tokens, output_tokens, total } } ----
async function callClaude({ system, messages, maxTokens }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens || 600,
      system,
      messages,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  return {
    text: textBlock ? textBlock.text : '',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total: inputTokens + outputTokens },
  };
}

module.exports = { callClaude, recordTokenUsage, isOverTokenLimit, currentYearMonth };
