// Vercel serverless function
// POST /api/ai/scaffold-course
// Body: { courseId, subject, gradeLevel, goals, month?, topic?, examDate?, mode? }
// mode: 'month' => generate one unit for a specific month/topic
// mode: undefined => generate full course scaffold
// Returns: { units } (also inserts into Supabase)

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { courseId, subject, gradeLevel, goals, month, topic, examDate, mode } = req.body

  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' })
  }

  let systemPrompt = `You are a K-12 curriculum design expert. Create pedagogically sound unit plans with sequential lessons.`
  let userPrompt = ''

  if (mode === 'month' && month && topic) {
    const context = [
      subject    && `Subject: ${subject}`,
      gradeLevel && `Grade level: ${gradeLevel}`,
      goals      && `Course goals: ${goals}`,
      examDate   && `Key date: ${examDate}`,
    ].filter(Boolean).join('\n')

    userPrompt = `${context}
Month: ${month}
Topic for this month: ${topic}

Generate a single curriculum unit for this month, with 4-6 lessons.`
  } else {
    // Full course mode: generate 4-6 units with lessons
    const context = [
      subject    && `Subject: ${subject}`,
      gradeLevel && `Grade level: ${gradeLevel}`,
      goals      && `Teacher goals: ${goals}`,
      examDate   && `Key date: ${examDate}`,
    ].filter(Boolean).join('\n')

    userPrompt = `${context}
Generate a full course structure with 4-5 units, each with 4-6 lessons.`
  }

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
        temperature: 0.5,
        max_tokens: 3000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "course_structure",
            strict: true,
            schema: {
              type: "object",
              properties: {
                units: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      lessons: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string" },
                            description: { type: "string" },
                            duration_minutes: { type: "number" }
                          },
                          required: ["title", "description", "duration_minutes"],
                          additionalProperties: false
                        }
                      }
                    },
                    required: ["title", "description", "lessons"],
                    additionalProperties: false
                  }
                }
              },
              required: ["units"],
              additionalProperties: false
            }
          }
        }
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return res.status(502).json({ error: 'AI request failed' })
    }

    const data = await response.json()
    let text = data.choices?.[0]?.message?.content?.trim() || '{"units":[]}'

    let units = []
    try {
      const parsed = JSON.parse(text)
      units = parsed.units || []
    } catch {
      units = []
    }

    if (units.length === 0) {
      return res.status(200).json({ units: [] })
    }

    if (mode === 'month') {
      const unit = units[0]

      // Count existing units for this course to set order_index
      const { count } = await supabase
        .from('units')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', courseId)

      const { data: newUnit, error: unitErr } = await supabase
        .from('units')
        .insert({
          course_id:   courseId,
          title:       unit.title,
          description: unit.description || null,
          order_index: count || 0,
        })
        .select()
        .single()

      if (unitErr || !newUnit) {
        console.error('Unit insert error:', unitErr)
        return res.status(500).json({ error: 'Failed to save unit' })
      }

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

      return res.status(200).json({ units: [unit] })

    } else {
      // Full course mode

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
    }
  } catch (err) {
    console.error('scaffold-course error:', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
