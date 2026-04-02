// Vercel serverless function
// POST /api/ai/parse-calendar
// Body: { text: string }
// Returns: { holidays: [{ name: "Thanksgiving", date: "2024-11-28" }] }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text } = req.body

  if (!text) {
    return res.status(400).json({ error: 'Calendar text is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  const currentYear = new Date().getFullYear()

  const systemPrompt = `You are a scheduling assistant. Extract all holidays, breaks, and off days from the provided school calendar text.
If a break spans multiple days (e.g., Nov 24-26), list EACH date individually.
Assume the current year is ${currentYear} if omitted, or the academic year ${currentYear}-${currentYear+1}.
Format dates as strictly 'YYYY-MM-DD'.
Respond strictly with a JSON object in this format: { "holidays": [ { "name": "Thanksgiving Break", "date": "2024-11-28" } ] }`

  const userPrompt = `School Calendar Text:\n\n${text}`

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
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed', holidays: [] })
    }

    const data = await response.json()
    const responseText = data.choices?.[0]?.message?.content?.trim() || '{"holidays":[]}'

    let holidays = []
    try {
      const parsed = JSON.parse(responseText)
      holidays = parsed.holidays || []
    } catch {
      holidays = []
    }

    // Filter out invalid dates
    holidays = holidays.filter(h => h.name && h.date && !isNaN(Date.parse(h.date)))

    return res.status(200).json({ holidays })
  } catch (err) {
    console.error('parse-calendar error:', err)
    return res.status(500).json({ error: `Internal error: ${err.message}`, holidays: [] })
  }
}
