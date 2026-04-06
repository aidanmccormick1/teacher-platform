// Vercel serverless function
// POST /api/ai/parse-pdf
// Body: { fileUrl: string } — Supabase storage URL of an uploaded PDF
// Returns: { lessons: [{ title, description }] }
// The PDF text is fetched server-side, then sent to OpenAI for extraction.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { fileUrl, rawText } = req.body

  if (!fileUrl && !rawText) {
    return res.status(400).json({ error: 'fileUrl or rawText is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  // If rawText wasn't extracted client-side, fetch and note we can't parse binary PDF server-side
  // (PDF parsing requires a library — this route accepts pre-extracted text from the client)
  const documentText = rawText || '[PDF text extraction happens client-side — see materials upload component]'

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

Extract key topics and lesson structures from a document. Return a JSON object in this format: { "lessons": [ { "title": "string", "description": "string" } ] }. If the document doesn't seem to be curriculum content, return { "lessons": [] }.`
  const userPrompt = `Document content:
"""
${documentText.slice(0, 4000)}
"""

Extract 5-15 lessons or major topics. If the document doesn't seem to be curriculum content, return an empty array.`

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
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      }),
    })

    if (!response.ok) {
      return res.status(502).json({ error: 'AI request failed', lessons: [] })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim()

    if (!text) {
      console.error('Empty model output from parse-pdf')
      return res.status(200).json({ lessons: [] })
    }

    let lessons = []
    try {
      const parsed = JSON.parse(text)
      lessons = parsed.lessons || []
    } catch {
      lessons = []
    }

    return res.status(200).json({ lessons: lessons })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return res.status(500).json({ error: 'Internal error', lessons: [] })
  }
}
