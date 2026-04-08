// Vercel serverless function
// POST /api/ai/scaffold-course
// Body: { courseId, subject, gradeLevel, units: [{ title, description, target_lessons }] }
// Returns: { units } (also inserts into Supabase)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials missing on the server' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const { courseId, subject, gradeLevel, units } = req.body

  if (!courseId || !units || !Array.isArray(units)) {
    return res.status(400).json({ error: 'courseId and units array are required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  const context = [
    subject    && `Subject: ${subject}`,
    gradeLevel && `Grade level: ${gradeLevel}`
  ].filter(Boolean).join('\n')

  try {
    let results = []
    
    // Process each unit allocation sequentially
    for (let uIdx = 0; uIdx < units.length; uIdx++) {
      const unit = units[uIdx]
      if (!unit.title) continue

      // 1. Insert the unit into DB
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

      if (unitErr || !newUnit) {
        console.error('Unit insert error:', unitErr)
        continue
      }
      
      const targetLessons = unit.target_lessons || 5

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

Generate exactly ${targetLessons} sequential lesson outlines for a specific unit. Keep descriptions highly concise. Respond strictly with a JSON object in this format: { "lessons": [ { "title": "string", "description": "string", "duration_minutes": 45 } ] }`
      const userPrompt = `${context}\nUnit Title: ${unit.title}\nUnit Focus: ${unit.description || 'General coverage'}\n\nPlease generate exactly ${targetLessons} lessons for this unit.`

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 1500,
          response_format: { type: "json_object" }
        }),
      })

      if (!response.ok) {
        console.error('OpenAI error during unit scaffold:', await response.text())
        continue
      }

      const data = await response.json()
      const text = data.choices?.[0]?.message?.content?.trim() || '{"lessons":[]}'
      
      let generatedLessons = []
      try {
        const parsed = JSON.parse(text)
        generatedLessons = parsed.lessons || []
      } catch (e) {
        generatedLessons = []
      }

      // 2. Insert the lessons into DB
      if (generatedLessons.length > 0) {
        const { error: lessonErr } = await supabase.from('lessons').insert(
          generatedLessons.map((l, lIdx) => ({
            unit_id:                    newUnit.id,
            title:                      l.title,
            description:                l.description || null,
            order_index:                lIdx,
            estimated_duration_minutes: l.duration_minutes || null,
          }))
        )
        if (lessonErr) console.error("Lesson insert error:", lessonErr)
      }

      results.push({ ...newUnit, lessons: generatedLessons })
    }

    return res.status(200).json({ units: results })
  } catch (err) {
    console.error('scaffold-course error:', err)
    return res.status(500).json({ error: `Internal error: ${err.message}` })
  }
}
