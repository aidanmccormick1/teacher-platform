// POST /api/ai/summarize-notes
// Body: { notes: [{ date, content }] }
// Returns: { summary: "string" }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { notes } = req.body
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  if (!notes || !Array.isArray(notes)) {
    return res.status(400).json({ error: 'Notes array required' })
  }

  const notesText = notes
    .filter(n => n.content?.trim())
    .map(n => `Date: ${n.date}\nContent: ${n.content}`)
    .join('\n\n')

  if (!notesText) {
    return res.status(200).json({ summary: 'No notes to summarize.' })
  }

  const systemPrompt = `
You are an educational assistant. 
Summarize the following class notes for a teacher. 
Focus on student progress, recurring issues, and items that need follow-up. 
Keep it concise (2-3 bullet points).

Respond strictly with a JSON object:
{ "summary": "string" }`

  const userPrompt = `Class Notes:\n\n${notesText}`

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
        temperature: 0.5,
        response_format: { type: 'json_object' }
      }),
    })

    if (!response.ok) {
      console.error('OpenAI Error:', await response.text())
      return res.status(502).json({ error: 'AI summarization failed' })
    }

    const data = await response.json()
    const content = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    
    return res.status(200).json(content)
  } catch (err) {
    console.error('Summarize Notes Error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
