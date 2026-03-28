// Vercel serverless function
// POST /api/parse-schedule
// Body: { text } OR { image: base64string }
// Returns: { schedule: [{ name, period, days, time, room, subject, grade }] }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text, image } = req.body

  if (!text && !image) {
    return res.status(400).json({ error: 'Either text or image is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  const systemPrompt = `You are a schedule parser. Given raw schedule text (or an image of a schedule), extract each class/section the teacher teaches.

Return a JSON array called "schedule". Each item should have:
- name: string (course name, e.g. "Algebra I", "AP Chemistry", "English 10")
- period: string (section label, e.g. "Period 1", "Block A", "6th Period") — if not present, use the name
- days: array of full day names from ["Monday","Tuesday","Wednesday","Thursday","Friday","A-Day","B-Day"]. If "daily" or "every day", include all 5 weekdays.
- time: string in HH:MM 24-hour format (e.g. "08:00", "13:30"), or null if not provided
- room: string or null
- subject: infer from name (e.g. "Math", "Science", "English", "History", "Art", "PE", "Computer Science", "Foreign Language", "Other")
- grade: infer if possible (e.g. "9", "10", "AP"), or empty string

Skip non-class items like Lunch, Planning, Break, etc.
Return ONLY valid JSON with no explanation. Example format:
{
  "schedule": [
    { "name": "Algebra I", "period": "Period 1", "days": ["Monday","Wednesday","Friday"], "time": "08:00", "room": "204", "subject": "Math", "grade": "9" }
  ]
}`

  try {
    let messages

    if (image) {
      messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the teaching schedule from this image.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
          ],
        },
      ]
    } else {
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Parse this schedule:\n\n${text}` },
      ]
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: image ? 'gpt-4o' : 'gpt-4o-mini',
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(500).json({ error: 'AI parsing failed' })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return res.status(500).json({ error: 'No response from AI' })
    }

    const parsed = JSON.parse(content)

    if (!Array.isArray(parsed.schedule)) {
      return res.status(500).json({ error: 'Could not parse schedule structure' })
    }

    return res.status(200).json({ schedule: parsed.schedule })
  } catch (e) {
    console.error('Parse schedule error:', e)
    return res.status(500).json({ error: e.message || 'Failed to parse schedule' })
  }
}
