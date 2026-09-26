// Preference order: prefer larger/smarter chat models over small/audio ones
const MODEL_PREFERENCE = [
  'llama-4', 'llama3', 'llama-3', 'mixtral', 'gemma2', 'gemma', 'qwen', 'deepseek',
];
const SKIP_KEYWORDS = ['whisper', 'guard', 'vision', 'tts', 'embed', 'tool-use'];

let cachedModel = null;
let cacheTime = 0;

async function getBestModel(apiKey) {
  // Cache for 5 minutes to avoid querying /models on every request
  if (cachedModel && Date.now() - cacheTime < 300000) return cachedModel;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) return null;
    const { data } = await r.json();
    const chatModels = (data || [])
      .map(m => m.id)
      .filter(id => !SKIP_KEYWORDS.some(kw => id.toLowerCase().includes(kw)));

    // Score each model by preference list position (lower = better)
    chatModels.sort((a, b) => {
      const aScore = MODEL_PREFERENCE.findIndex(p => a.toLowerCase().includes(p));
      const bScore = MODEL_PREFERENCE.findIndex(p => b.toLowerCase().includes(p));
      return (aScore === -1 ? 99 : aScore) - (bScore === -1 ? 99 : bScore);
    });

    if (chatModels.length) {
      cachedModel = chatModels[0];
      cacheTime = Date.now();
      return cachedModel;
    }
  } catch (e) {
    // fall through
  }
  return null;
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

  // Discover the best available model (or use env override)
  const model = process.env.GROQ_MODEL || await getBestModel(process.env.GROQ_API_KEY);
  if (!model) {
    return res.status(503).json({ error: 'Could not find an available AI model. Please try again later.' });
  }

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

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 1500, temperature: 0.65 }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      // If the auto-discovered model is now gone, clear cache so next request re-discovers
      const msg = data?.error?.message || '';
      if (msg.includes('does not exist') || msg.includes('decommissioned') || msg.includes('no longer supported')) {
        cachedModel = null;
      }
      const status = groqRes.status === 401 ? 401 : 500;
      return res.status(status).json({ error: msg || 'Something went wrong. Please try again.' });
    }

    const reply = data.choices?.[0]?.message?.content || "I'm not sure — could you rephrase that?";
    res.status(200).json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
