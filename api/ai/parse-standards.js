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

Parse a standards document and extract individual learning standards.
For each standard, extract:
- code: the standard identifier (e.g. "CCSS.ELA-LITERACY.RI.6.1") — use empty string if none
- description: the full text of the standard

Respond ONLY with a JSON object in this format (no markdown, no extra text):
{ "standards": [ { "code": "CCSS.ELA.1", "description": "Read closely to determine..." } ] }`

  const userPrompt = `Parse this standards document and extract all individual standards:\n\n${text || '[Image/PDF uploaded — extract all visible standards from it]'}`

  try {
    const messages = []

    if (pdf) {
      // Vision mode for image/PDF uploads
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: systemPrompt + '\n\n' + 'Extract all standards visible in this document image.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${pdf}`, detail: 'high' } },
        ],
      })
    } else {
      messages.push(
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      )
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed', standards: [] })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.error('Empty model output from parse-standards')
      return res.status(200).json({ standards: [] })
    }

    let parsed = {}
    try { parsed = JSON.parse(content) } catch {
      console.error('Failed to parse model output:', content)
    }

    return res.status(200).json({ standards: parsed.standards || [] })
  } catch (err) {
    console.error('parse-standards error:', err)
    return res.status(500).json({ error: 'Internal error', standards: [] })
  }
}
