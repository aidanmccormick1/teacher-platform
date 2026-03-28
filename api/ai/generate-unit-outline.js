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

  const prompt = `You are a K-12 curriculum expert.
${context}
A teacher is planning a unit called "${unitTitle}".
Generate a lesson outline of 5-8 lessons for this unit.

Return ONLY a valid JSON array with this exact shape (no markdown, no extra text):
[
  {
    "title": "Introduction to Ancient Egypt",
    "description": "Brief overview of what students will learn in this lesson",
    "duration_minutes": 50
  }
]

Make the lessons sequential and build on each other. Include variety: direct instruction, exploration, discussion, assessment.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-nano',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1200,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed', lessons: [] })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '[]'

    let lessons = []
    try {
      lessons = JSON.parse(text)
    } catch {
      const match = text.match(/\[[\s\S]*\]/)
      if (match) lessons = JSON.parse(match[0])
    }

    return res.status(200).json({ lessons: Array.isArray(lessons) ? lessons : [] })
  } catch (err) {
    console.error('generate-unit-outline error:', err)
    return res.status(500).json({ error: 'Internal error', lessons: [] })
  }
}
