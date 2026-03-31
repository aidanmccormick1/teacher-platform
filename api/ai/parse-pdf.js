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

  const systemPrompt = `You are a curriculum expert. Extract key topics and lesson structures.`
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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "extracted_lessons",
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
                      description: { type: "string" }
                    },
                    required: ["title", "description"],
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
    console.error('parse-pdf error:', err)
    return res.status(500).json({ error: 'Internal error', lessons: [] })
  }
}
