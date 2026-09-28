// Bloom AI chat, running as a Firebase Cloud Function (2nd gen).
// Firebase Hosting sends /api/chat here (see firebase.json). The Anthropic API key is a Firebase secret:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
// It is never stored in the code or sent to the app.
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

exports.chat = onRequest({ secrets:[ANTHROPIC_API_KEY], region:'us-central1', cors:true, maxInstances:10, timeoutSeconds:60 }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ANTHROPIC_API_KEY.value()) {
    return res.status(503).json({ error: 'Bloom AI is not configured yet. Set the ANTHROPIC_API_KEY secret in Firebase.' });
  }

  const { message, history = [] } = req.body || {};
  const context = typeof (req.body || {}).context === 'string' ? req.body.context.slice(0, 6000) : '';
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  if (message.length > 4000) return res.status(400).json({ error: 'Please keep your message under 4000 characters.' });

  const systemPrompt = `You are Bloom — a warm, knowledgeable AI assistant built into the Bloom pregnancy and parenting app. You answer ANY question the user asks, helpfully and thoroughly.

You have deep expertise in:
- Pregnancy (all trimesters), labor, delivery, postpartum recovery
- Newborn and infant care: feeding, sleep, development, vaccines
- Breastfeeding, pumping, formula feeding
- Maternal nutrition, mental health, pelvic floor, postpartum body
- Baby products, safety, childproofing, car seats

For questions outside pregnancy/parenting, answer them fully and helpfully — you are a general assistant too.

${context ? 'Use this relevant reference knowledge where helpful:\n' + context + '\n' : ''}

Style: clear, warm, and direct. Use bullet points or numbered lists for complex topics. Be concise for simple questions, detailed for complex ones.
For medical decisions always recommend consulting a healthcare provider. Never diagnose.`;

  // Build messages array (Anthropic format: no system role in array)
  const messages = [
    ...(Array.isArray(history) ? history : []).slice(-12).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 4000) })),
    { role: 'user', content: message },
  ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY.value(),
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
});
