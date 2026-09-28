const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

// Referral reward: 20% of the referred business's first payment, credited as ₮.
// The referrer can optionally convert that ₮ credit into bonus AI tokens at this rate.
const TOKEN_CONVERSION_RATE = 20; // tokens per ₮1 of credit
// `features` gates access to CRM/orders/marketing/analytics per the pricing page.
// `token_limit` caps real Claude API tokens (input+output combined) used per calendar month.
const PLANS = {
  start: {
    label: 'Start',
    max_agents: 1,
    price: 49900,
    token_limit: 300000,
    features: ['chat', 'comments', 'trollguard', 'site_builder'],
  },
  business: {
    label: 'Business',
    max_agents: 3,
    price: 129900,
    token_limit: 1200000,
    features: ['chat', 'comments', 'trollguard', 'site_builder', 'orders', 'marketing', 'analytics'],
  },
  enterprise: {
    label: 'Enterprise',
    max_agents: 10,
    price: 349900,
    token_limit: 5000000,
    features: ['chat', 'comments', 'trollguard', 'site_builder', 'orders', 'marketing', 'analytics', 'crm'],
  },
};

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      business_name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'start',
      referral_code TEXT UNIQUE,
      referred_by INTEGER REFERENCES businesses(id),
      credit_balance NUMERIC NOT NULL DEFAULT 0,
      bonus_tokens BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Safe additive migration for deployments where `businesses` already existed before these columns were added.
  await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS referral_code TEXT;`);
  await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES businesses(id);`);
  await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS credit_balance NUMERIC NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS bonus_tokens BIGINT NOT NULL DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      agent_name TEXT DEFAULT 'Онч',
      knowledge_base TEXT DEFAULT '',
      welcome_message TEXT DEFAULT 'Сайн байна уу! Танд юугаар туслах вэ?',
      primary_color TEXT DEFAULT '#16213a',
      widget_key TEXT UNIQUE NOT NULL,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      platform TEXT NOT NULL DEFAULT 'instagram',
      page_id TEXT NOT NULL,
      page_name TEXT,
      ig_business_id TEXT,
      ad_account_id TEXT,
      access_token TEXT NOT NULL,
      trollguard_enabled BOOLEAN DEFAULT true,
      auto_reply_enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_name TEXT;`);
  await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS ad_account_id TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comment_logs (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      comment_id TEXT NOT NULL,
      author TEXT,
      comment_text TEXT,
      classification TEXT,
      action_taken TEXT,
      reply_text TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      slug TEXT UNIQUE NOT NULL,
      title TEXT DEFAULT 'Миний сайт',
      blocks JSONB DEFAULT '[]',
      bg_color TEXT DEFAULT '#fff8f0',
      accent_color TEXT DEFAULT '#e8562f',
      published BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Safe additive migration for deployments where `sites` already existed before these columns were added.
  await pool.query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS bg_color TEXT DEFAULT '#fff8f0';`);
  await pool.query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#e8562f';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      caption TEXT NOT NULL,
      media_url TEXT,
      platform TEXT NOT NULL DEFAULT 'facebook',
      scheduled_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      fb_post_id TEXT,
      boost_enabled BOOLEAN DEFAULT false,
      boost_budget NUMERIC,
      boost_duration_days INTEGER DEFAULT 3,
      boost_campaign_id TEXT,
      boost_status TEXT DEFAULT 'none',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS fb_post_id TEXT;`);
  await pool.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS boost_enabled BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS boost_budget NUMERIC;`);
  await pool.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS boost_duration_days INTEGER DEFAULT 3;`);
  await pool.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS boost_campaign_id TEXT;`);
  await pool.query(`ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS boost_status TEXT DEFAULT 'none';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_logs (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'lead',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL DEFAULT 0,
      description TEXT,
      image_url TEXT,
      in_stock BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      total_amount NUMERIC NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      price NUMERIC NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qpay_invoices (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      qpay_invoice_id TEXT,
      qpay_sender_invoice_no TEXT,
      credit_applied NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      paid_at TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE qpay_invoices ADD COLUMN IF NOT EXISTS credit_applied NUMERIC NOT NULL DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      year_month TEXT NOT NULL,
      tokens_used BIGINT NOT NULL DEFAULT 0,
      UNIQUE (business_id, year_month)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS generated_media (
      id SERIAL PRIMARY KEY,
      image_data BYTEA NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/png',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log('Database schema ready.');
}

module.exports = { pool, initDb, PLANS, TOKEN_CONVERSION_RATE };
