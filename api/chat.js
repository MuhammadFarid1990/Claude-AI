module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({
      error: 'Bloom AI is not yet configured. Add GROQ_API_KEY to Vercel environment variables to enable the chatbot.'
    });
  }

  const { message, context, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const systemPrompt = `You are Bloom, a warm and knowledgeable AI companion for pregnancy and parenting. You give clear, evidence-based, and empathetic answers on pregnancy, infant care, nutrition, and child development.${context ? '\n\nRelevant knowledge:\n' + context : ''}

Keep responses concise and warm — 2-4 sentences for simple questions. Always recommend consulting a healthcare provider for medical decisions. Never diagnose. If unsure, say so.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),
    { role: 'user', content: message },
  ];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 600,
        temperature: 0.7,
      }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      const status = groqRes.status === 401 ? 401 : 500;
      return res.status(status).json({ error: data?.error?.message || 'Something went wrong. Please try again.' });
    }

    const reply = data.choices?.[0]?.message?.content || "I'm not sure — could you rephrase that?";
    res.status(200).json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
