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

  const systemPrompt = `You are a K-12 curriculum expert. Extract structural lesson plans. Keep descriptions very concise.`
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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 600,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "unit_outline",
            strict: true,
            schema: {
              type: "object",
              properties: {
                lessons: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      duration_minutes: { type: "number" }
                    },
                    required: ["title", "description", "duration_minutes"],
                    additionalProperties: false
                  }
                }
              },
              required: ["lessons"],
              additionalProperties: false
            }
          }
        }
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
    return res.status(500).json({ error: 'Internal error', lessons: [] })
  }
}
