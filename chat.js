const express = require('express');
const { pool } = require('./db');
const { callClaude } = require('./claude');

const router = express.Router();

router.post('/:widgetKey', async (req, res) => {
  const { widgetKey } = req.params;
  const { session_id, message } = req.body;
  if (!session_id || !message) {
    return res.status(400).json({ error: 'session_id, message шаардлагатай' });
  }

  try {
    const agentResult = await pool.query(
      `SELECT a.*, b.business_name FROM agents a
       JOIN businesses b ON b.id = a.business_id
       WHERE a.widget_key = $1`,
      [widgetKey]
    );
    const agent = agentResult.rows[0];
    if (!agent) return res.status(404).json({ error: 'Agent олдсонгүй' });

    let convoResult = await pool.query(
      'SELECT id FROM conversations WHERE agent_id = $1 AND session_id = $2',
      [agent.id, session_id]
    );
    let conversationId;
    if (convoResult.rows.length === 0) {
      const inserted = await pool.query(
        'INSERT INTO conversations (agent_id, business_id, session_id) VALUES ($1, $2, $3) RETURNING id',
        [agent.id, agent.business_id, session_id]
      );
      conversationId = inserted.rows[0].id;
    } else {
      conversationId = convoResult.rows[0].id;
    }

    const priorMessages = await pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 20',
      [conversationId]
    );

    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'user', message]
    );

    const systemPrompt = `Чи бол "${agent.agent_name}" нэртэй, "${agent.business_name}" бизнесийн харилцагчийн үйлчилгээний AI туслах.
Дараах мэдлэгийн санд тулгуурлан хариулна уу:
---
${agent.knowledge_base || '(Мэдлэгийн сан хоосон байна — ерөнхий байдлаар эелдэгээр хариул.)'}
---
Дүрэм:
- Хэрэглэгч ямар хэлээр бичсэн бол чи мөн тэр хэлээр хариул (Монгол, Англи, Орос, Хятад г.м. — аль ч хэл дээр).
- Товч, эелдэг, тодорхой хариул.
- Мэдлэгийн санд байхгүй зүйлийг зохиож бүү хариул, мэдэхгүй бол шударгаар хэлж, холбогдох ажилтантай холбогдохыг санал болго.`;

    const history = [
      ...priorMessages.rows.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const reply = await callClaude({ system: systemPrompt, messages: history });

    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'assistant', reply]
    );

    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Серверийн алдаа гарлаа. Дахин оролдоно уу.' });
  }
});

module.exports = router;
