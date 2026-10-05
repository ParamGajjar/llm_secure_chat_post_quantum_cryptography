const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function askLLM(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const e = new Error('OPENROUTER_API_KEY missing');
    e.status = 500;
    e.publicMessage = 'Server is missing its LLM API key';
    throw e;
  }

  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
        'X-Title': 'PQC Secure Chat Demo',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        messages,
      }),
    });
  } catch (err) {
    const e = new Error('Network error contacting OpenRouter');
    e.status = 502;
    e.publicMessage = 'Could not reach the LLM provider';
    e.cause = err;
    throw e;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    e.status = 502;
    e.publicMessage = `LLM provider error (HTTP ${res.status})`;
    throw e;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    const e = new Error('Unexpected OpenRouter response shape');
    e.status = 502;
    e.publicMessage = 'Unexpected response from LLM provider';
    throw e;
  }
  return text;
}

module.exports = { askLLM };