// Vercel serverless function
// POST /api/ai/analyze-standards
// Body: { subject, gradeLevel, standards: [{code, description}], units: [{title, lessons}] }
// Returns: { analysis: { overview, alignments, gaps } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { subject, gradeLevel, standards, units } = req.body
  if (!standards?.length || !units?.length) {
    return res.status(400).json({ error: 'standards and units required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured' })

  const stdText = standards.slice(0, 30).map(s =>
    s.code ? `${s.code}: ${s.description}` : s.description
  ).join('\n')

  const unitsText = units.map((u, i) => {
    const lessons = u.lessons?.length ? `\n  Lessons: ${u.lessons.join(', ')}` : ''
    return `Unit ${i + 1}: ${u.title}${lessons}`
  }).join('\n')

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

Compare standards against a curriculum and return a JSON object in this exact format:
{
  "overview": "A brief overall summary string",
  "alignments": [
    { "standard_code": "CODE", "coverage": "strong|partial|missing", "note": "brief note" }
  ],
  "gaps": ["gap description 1", "gap description 2"]
}
Include up to 10 alignments and up to 5 gaps. Be specific and useful.`

  const userPrompt = `Course: ${subject || 'Unknown subject'} ${gradeLevel ? `Grade ${gradeLevel}` : ''}

Standards:
${stdText}

Current curriculum units:
${unitsText}

Analyze how well the curriculum covers the standards.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed' })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.error('Empty model output from analyze-standards')
      return res.status(200).json({ analysis: {} })
    }

    let parsed = {}
    try { parsed = JSON.parse(content) } catch {}

    return res.status(200).json({ analysis: parsed })
  } catch (err) {
    console.error('analyze-standards error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}

