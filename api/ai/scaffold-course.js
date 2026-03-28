// Vercel serverless function
// POST /api/ai/scaffold-course
// Body: { courseId, subject, gradeLevel, goals }
// Returns: { units: [{ title, lessons: [{ title, description }] }] }
// Side effect: inserts units + lessons into Supabase using SERVICE ROLE key

import { createClient } from '@supabase/supabase-js'

// Service role key needed for server-side inserts without RLS
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { courseId, subject, gradeLevel, goals } = req.body

  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  const context = [
    subject     && `Subject: ${subject}`,
    gradeLevel  && `Grade level: ${gradeLevel}`,
    goals       && `Teacher goals: ${goals}`,
  ].filter(Boolean).join('\n')

  const prompt = `You are a K-12 curriculum design expert.
${context}
Generate a full course structure with 4-6 units, each with 5-8 lessons.

Return ONLY a valid JSON array with this exact shape (no markdown, no extra text):
[
  {
    "title": "Unit 1: Introduction",
    "description": "Overview of the unit",
    "lessons": [
      {
        "title": "Lesson title",
        "description": "What students will learn",
        "duration_minutes": 50
      }
    ]
  }
]

Make it pedagogically sound, with clear progression and varied lesson types.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-nano',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 3000,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed' })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '[]'

    let units = []
    try {
      units = JSON.parse(text)
    } catch {
      const match = text.match(/\[[\s\S]*\]/)
      if (match) units = JSON.parse(match[0])
    }

    if (!Array.isArray(units) || units.length === 0) {
      return res.status(200).json({ units: [] })
    }

    // Insert into Supabase
    for (let uIdx = 0; uIdx < units.length; uIdx++) {
      const unit = units[uIdx]
      const { data: newUnit, error: unitErr } = await supabase
        .from('units')
        .insert({
          course_id:   courseId,
          title:       unit.title,
          description: unit.description || null,
          order_index: uIdx,
        })
        .select()
        .single()

      if (unitErr || !newUnit) continue

      const lessons = unit.lessons || []
      if (lessons.length > 0) {
        await supabase.from('lessons').insert(
          lessons.map((l, lIdx) => ({
            unit_id:                    newUnit.id,
            title:                      l.title,
            description:                l.description || null,
            order_index:                lIdx,
            estimated_duration_minutes: l.duration_minutes || null,
          }))
        )
      }
    }

    return res.status(200).json({ units })
  } catch (err) {
    console.error('scaffold-course error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
