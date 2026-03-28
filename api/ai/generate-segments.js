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

  const prompt = `You are a K-12 curriculum expert.
A teacher is creating a lesson called "${lessonTitle}"${gradeLevel ? ` for grade ${gradeLevel} students` : ''}.
Generate 4-6 lesson segments that structure this lesson well.

Return ONLY a valid JSON array with this exact shape (no markdown, no extra text):
[
  {
    "title": "Warm-up",
    "description": "Brief description of what happens in this segment",
    "duration_minutes": 5
  }
]

Typical segments include: Warm-up, Review, Direct Instruction, Guided Practice, Independent Practice, Discussion, Activity, Exit Ticket.
Make durations realistic and specific to the content.`

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
        max_tokens: 800,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed', segments: [] })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '[]'

    let segments = []
    try {
      segments = JSON.parse(text)
    } catch {
      // Try to extract JSON array from text
      const match = text.match(/\[[\s\S]*\]/)
      if (match) segments = JSON.parse(match[0])
    }

    return res.status(200).json({ segments: Array.isArray(segments) ? segments : [] })
  } catch (err) {
    console.error('generate-segments error:', err)
    return res.status(500).json({ error: 'Internal error', segments: [] })
  }
}
