// Vercel serverless function
// POST /api/ai/generate-unit-outline
// Body: { unitTitle: string, courseSubject?: string, gradeLevel?: string }
// Returns: { lessons: [{ title, description, duration_minutes }] }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { unitTitle, courseSubject, gradeLevel } = req.body

  if (!unitTitle) {
    return res.status(400).json({ error: 'unitTitle is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  const context = [
    courseSubject && `Subject: ${courseSubject}`,
    gradeLevel && `Grade level: ${gradeLevel}`,
  ].filter(Boolean).join('\n')

  const systemPrompt = `You are a K-12 curriculum expert. Extract structural lesson plans. Keep descriptions very concise. Respond strictly with a JSON object in this format: { "lessons": [ { "title": "string", "description": "string", "duration_minutes": 45 } ] }`
  const userPrompt = `${context}
A teacher is planning a unit called "${unitTitle}".
Generate a lesson outline of 4-6 sequential lessons for this unit.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 600,
        response_format: { type: "json_object" }
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed', lessons: [] })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '{"lessons":[]}'

    let lessons = []
    try {
      const parsed = JSON.parse(text)
      lessons = parsed.lessons || []
    } catch {
      lessons = []
    }

    return res.status(200).json({ lessons: lessons })
  } catch (err) {
    console.error('generate-unit-outline error:', err)
    return res.status(500).json({ error: `Internal error: ${err.message}`, lessons: [] })
  }
}
