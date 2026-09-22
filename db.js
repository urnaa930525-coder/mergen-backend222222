const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

// Plan definitions: agent-count based, unlimited usage within a plan.
const PLANS = {
  start: { label: 'Start', max_agents: 1 },
  business: { label: 'Business', max_agents: 3 },
  enterprise: { label: 'Enterprise', max_agents: 10 },
};

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      business_name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'start',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

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
      ig_business_id TEXT,
      access_token TEXT NOT NULL,
      trollguard_enabled BOOLEAN DEFAULT true,
      auto_reply_enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

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

  console.log('Database schema ready.');
}

module.exports = { pool, initDb, PLANS };
