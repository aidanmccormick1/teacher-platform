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

  const systemPrompt = `You are a schedule and assignment parser. Extract classes, sections, and assignments from schedules, syllabi, or assignment sheets.

For SCHEDULE items (classes/sections), return with:
- name: string (course name, e.g. "Algebra I", "AP Chemistry")
- period: string (section label, e.g. "Period 1", "Block A") — if absent, use name
- days: array from ["Monday","Tuesday","Wednesday","Thursday","Friday","A-Day","B-Day"]. If "daily" or "every day", include all 5 weekdays.
- time: string "HH:MM" 24-hour format (e.g. "08:00", "13:30"), or null
- room: string or null
- subject: inferred from name (Math, Science, English, History, Art, PE, Computer Science, Foreign Language, Social Studies, Elective, Other)
- grade: inferred (e.g. "9", "10", "AP", "Honors"), or empty string
- type: "class"

For ASSIGNMENT items (individual tasks, projects, quizzes), return with:
- name: string (assignment title)
- course_name: string (which class it belongs to)
- due_date: string "YYYY-MM-DD" format, or null if not specified
- description: string or null (what students must do)
- type: "assignment"

Skip non-class items like Lunch, Planning, Break, Staff meetings, etc.
Return ONLY valid JSON. Example:
{
  "schedule": [
    { "name": "Algebra I", "period": "Period 1", "days": ["Monday","Wednesday","Friday"], "time": "08:00", "room": "204", "subject": "Math", "grade": "9", "type": "class" },
    { "name": "Chapter 3 Quiz", "course_name": "Algebra I", "due_date": "2026-03-31", "description": "Sections 3.1-3.4, 20 questions", "type": "assignment" }
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
            {
              type: 'text',
              text: 'Please carefully extract all classes, sections, and assignments from this image. Look for: class names, time slots, room numbers, meeting days, due dates, and assignment descriptions. Be thorough and include all readable information.'
            },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
          ],
        },
      ]
    } else {
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Parse this schedule and assignment information:\n\n${text}` },
      ]
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: image ? 'gpt-5.4' : 'gpt-5.4-mini',
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
