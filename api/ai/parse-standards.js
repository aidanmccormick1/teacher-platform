// Vercel serverless function
// POST /api/ai/parse-standards
// Body: { text?, pdf?, filename }
// Returns: { standards: [{ code: string, description: string }] }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { text, pdf, filename } = req.body
  if (!text && !pdf) return res.status(400).json({ error: 'text or pdf required' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured' })

  const prompt = `You are a curriculum expert. Parse the following standards document and extract individual standards.
For each standard, extract:
- code: the standard identifier (e.g. "CCSS.ELA-LITERACY.RI.6.1", "HSS-IC.A.1") — leave empty string if none
- description: the full text of the standard

Return ONLY valid JSON with this shape (no markdown):
{
  "standards": [
    { "code": "CCSS.ELA.1", "description": "Read closely..." },
    { "code": "", "description": "Understand key concepts..." }
  ]
}

Standards document:
${text || '[PDF uploaded — extract all visible standards]'}`

  try {
    const messages = []
    if (pdf) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt.replace(text || '', '') },
          { type: 'image_url', image_url: { url: `data:application/pdf;base64,${pdf}`, detail: 'high' } },
        ],
      })
    } else {
      messages.push({ role: 'user', content: prompt })
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: pdf ? 'gpt-4o' : 'gpt-4o-mini',
        messages,
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed' })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    let parsed = {}
    try { parsed = JSON.parse(content) } catch {}

    return res.status(200).json({ standards: parsed.standards || [] })
  } catch (err) {
    console.error('parse-standards error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
