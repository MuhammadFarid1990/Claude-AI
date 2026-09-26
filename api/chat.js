module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Bloom AI is not configured. Add ANTHROPIC_API_KEY to Vercel environment variables.'
    });
  }

  const { message, context, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const systemPrompt = `You are Bloom — a warm, knowledgeable AI assistant built into the Bloom pregnancy and parenting app. You answer ANY question the user asks, helpfully and thoroughly.

You have deep expertise in:
- Pregnancy (all trimesters), labor, delivery, postpartum recovery
- Newborn and infant care: feeding, sleep, development, vaccines
- Breastfeeding, pumping, formula feeding
- Toddler development, milestones, behavior, language
- Maternal nutrition, mental health, pelvic floor, postpartum body
- Baby products, safety, childproofing, car seats

For questions outside pregnancy/parenting, answer them fully and helpfully — you are a general assistant too.

${context ? 'Use this relevant reference knowledge where helpful:\n' + context + '\n' : ''}

Style: clear, warm, and direct. Use bullet points or numbered lists for complex topics. Be concise for simple questions, detailed for complex ones.
For medical decisions always recommend consulting a healthcare provider. Never diagnose.`;

  // Build messages array (Anthropic format: no system role in array)
  const messages = [
    ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      const status = r.status === 401 ? 401 : 500;
      return res.status(status).json({ error: data?.error?.message || 'Something went wrong. Please try again.' });
    }

    const reply = data.content?.[0]?.text || "I'm not sure — could you rephrase that?";
    res.status(200).json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
