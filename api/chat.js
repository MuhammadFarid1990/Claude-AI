// Models tried in order; first one that works wins. Add new models at the top.
const FALLBACK_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama3-70b-8192',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

async function callGroq(apiKey, model, messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 1500, temperature: 0.65 }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function isModelError(data) {
  const msg = data?.error?.message || '';
  return msg.includes('does not exist') || msg.includes('decommissioned') || msg.includes('no longer supported') || msg.includes('deprecated');
}

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

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-12),
    { role: 'user', content: message },
  ];

  // If GROQ_MODEL env var is set, try it first; otherwise use the fallback list
  const modelsToTry = process.env.GROQ_MODEL
    ? [process.env.GROQ_MODEL, ...FALLBACK_MODELS]
    : FALLBACK_MODELS;

  try {
    let lastError = 'Something went wrong. Please try again.';
    for (const model of modelsToTry) {
      const { ok, status, data } = await callGroq(process.env.GROQ_API_KEY, model, messages);
      if (ok) {
        const reply = data.choices?.[0]?.message?.content || "I'm not sure — could you rephrase that?";
        return res.status(200).json({ reply });
      }
      if (status === 401) {
        return res.status(401).json({ error: 'Invalid API key. Check your GROQ_API_KEY in Vercel environment variables.' });
      }
      if (isModelError(data)) {
        // This model is gone — try the next one
        lastError = data?.error?.message || lastError;
        continue;
      }
      // Other API error (rate limit, bad request, etc.) — don't retry
      return res.status(500).json({ error: data?.error?.message || lastError });
    }
    return res.status(503).json({ error: 'All AI models are currently unavailable. Please try again later.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
