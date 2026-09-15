const Anthropic = require('@anthropic-ai/sdk');

let client;
function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Bloom AI is not yet configured. Add ANTHROPIC_API_KEY to Vercel environment variables to enable the chatbot.'
    });
  }

  const { message, context, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const system = `You are Bloom, a warm and knowledgeable AI companion for pregnancy and parenting. You give clear, evidence-based, and empathetic answers on pregnancy, infant care, nutrition, and child development.${context ? '\n\nRelevant knowledge:\n' + context : ''}

Keep responses concise and warm — 2-4 sentences for simple questions. Always recommend consulting a healthcare provider for medical decisions. Never diagnose. If unsure, say so.`;

  try {
    const anthropic = getClient();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system,
      messages: [...history.slice(-10), { role: 'user', content: message }],
    });
    res.status(200).json({ reply: response.content[0]?.text || "I'm not sure — could you rephrase that?" });
  } catch (err) {
    console.error(err);
    const status = err.status === 401 ? 401 : 500;
    res.status(status).json({ error: err.status === 401 ? 'Invalid API key.' : 'Something went wrong. Please try again.' });
  }
};
