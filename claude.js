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
  return textBlock ? textBlock.text : '';
}

module.exports = { callClaude };
