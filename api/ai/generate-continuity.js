// POST /api/ai/generate-continuity
// Body: { lessonTitle, lastSegmentTitle, lastNote, previousLessonSummary }
// Returns: { recap, nextStep, adjustment }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { lessonTitle, lastSegmentTitle, lastNote, previousLessonSummary } = req.body
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

Respond strictly with a JSON object in this format:
{
  "recap": "1-2 sentence recap of the last session",
  "nextStep": "Opening move for today's lesson (e.g. 'Start with a 5-min drill on...')",
  "adjustment": "Optional warning/pacing note (can be null)"
}`

  const userPrompt = `
The teacher is continuing the lesson: "${lessonTitle}".
Last completed segment: "${lastSegmentTitle || 'Beginning of lesson'}"
Last session notes: "${lastNote || 'No notes'}"
Context from previous lessons: "${previousLessonSummary || ''}"

Help the teacher bridge the gap from the last class to today.`

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
        temperature: 0.7,
        response_format: { type: 'json_object' }
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Continuity Error:', errText)
      return res.status(502).json({ error: 'Failed to generate continuity' })
    }

    const data = await response.json()
    const content = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    
    return res.status(200).json(content)
  } catch (err) {
    console.error('Continuity Handler Error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
