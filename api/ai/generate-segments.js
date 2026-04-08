// Vercel serverless function
// POST /api/ai/generate-segments
// Body: { lessonTitle: string, gradeLevel?: string }
// Returns: { segments: [{ title, description, duration_minutes }] }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { lessonTitle, gradeLevel } = req.body

  if (!lessonTitle) {
    return res.status(400).json({ error: 'lessonTitle is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  const systemPrompt = `
You are a curriculum planning assistant for teachers.

Your job is to reduce teacher cognitive load while preserving lesson continuity.

Priorities:
1. Continuity between lessons
2. Clear progression toward standards
3. Realistic classroom pacing
4. Simple, actionable outputs
5. Strong awareness of where the teacher left off

Always:
- Reference the prior lesson or last completed segment
- Suggest the next logical instructional step
- Keep responses structured and easy to scan
- Prefer realistic pacing over idealized pacing
- Help teachers re-enter a lesson quickly

Structure lessons into sequential segments. Respond strictly with a JSON object in this format: { "segments": [ { "title": "string", "description": "string", "duration_minutes": 15 } ] }`
  const userPrompt = `A teacher is creating a lesson called "${lessonTitle}"${gradeLevel ? ` for grade ${gradeLevel} students` : ''}.
Generate 3-5 lesson segments that structure this lesson well.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 500,
        response_format: { type: "json_object" }
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed', segments: [] })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '{"segments":[]}'

    let segments = []
    try {
      const parsed = JSON.parse(text)
      segments = parsed.segments || []
    } catch {
      segments = []
    }

    return res.status(200).json({ segments: segments })
  } catch (err) {
    console.error('generate-segments error:', err)
    return res.status(500).json({ error: 'Internal error', segments: [] })
  }
}
