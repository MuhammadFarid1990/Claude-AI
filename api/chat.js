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

  const systemPrompt = `You are Bloom — an expert AI companion for pregnancy, postpartum, infant care, and early childhood development. You are powered by deep medical and scientific knowledge and you communicate with warmth, clarity, and empathy.

Your role is to be the most helpful pregnancy and parenting assistant possible. Give thorough, accurate, evidence-based answers. When a question is simple, be concise. When a question is complex or nuanced, give a full and detailed response — use bullet points, numbered steps, or short sections to make information easy to read.

Your expertise covers:
- All trimesters of pregnancy: symptoms, development, tests, nutrition, exercise, mental health
- Labor, delivery, birth plans, pain management, C-sections, postpartum recovery
- Newborn care: feeding (breast and formula), sleep safety, diapering, bathing, weight, jaundice, vaccines
- Breastfeeding and pumping: latch, supply, schedules, storage
- Infant and toddler development: milestones, language, play, screen time, sleep training
- Postpartum health: PPD, pelvic floor, contraception, nutrition, intimacy
- Nutrition and food safety during pregnancy and breastfeeding
- Common concerns: morning sickness, heartburn, back pain, swelling, colic, reflux, allergies

${context ? 'Use this relevant reference knowledge in your answer:\n' + context + '\n' : ''}

Rules:
- Always recommend consulting a healthcare provider for medical decisions, diagnoses, or emergencies
- Never diagnose conditions — describe symptoms and when to seek care
- If something is outside your knowledge or genuinely unclear, say so honestly
- Be warm and supportive — pregnancy and parenting can be overwhelming`;

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
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 1500,
        temperature: 0.65,
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
