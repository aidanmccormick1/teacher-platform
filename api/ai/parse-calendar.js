// Vercel serverless function
// POST /api/ai/parse-calendar
// Body: { text: string }
// Returns: { holidays: [{ name: "Thanksgiving Break", date: "2024-11-28" }] }
//
// Strategy:
//   1. Try OpenAI (gpt-4o-mini — current stable lightweight model)
//   2. If OpenAI fails for any reason, fall back to a local regex parser
//      that handles the most common formats teachers paste.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { text } = req.body
  if (!text?.trim()) {
    return res.status(400).json({ error: 'Calendar text is required' })
  }

  // ── Determine likely school year ──────────────────────────────────────────
  const now = new Date()
  // School year starts in August/September. If we're Jan–July, the school year
  // that started last year is still active (e.g. 2024-25 → year1=2024, year2=2025)
  const schoolYear1 = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  const schoolYear2 = schoolYear1 + 1

  // ── 1. Try OpenAI ─────────────────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey) {
    try {
      const systemPrompt = `You are a school scheduling assistant. Extract ALL holidays, breaks, and off-school days from the text.

Rules:
- If a break spans multiple days (e.g. "Nov 24–27" or "Nov 24th through the 27th"), list EVERY individual date in that range.
- Infer the correct year using the school year ${schoolYear1}–${schoolYear2} (months Aug–Dec belong to ${schoolYear1}, months Jan–Jul belong to ${schoolYear2}).
- Format every date as strictly "YYYY-MM-DD".
- Return ONLY a JSON object: { "holidays": [ { "name": "Thanksgiving Break", "date": "2024-11-28" } ] }`

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
            { role: 'user', content: `School calendar text:\n\n${text}` },
          ],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const raw = data.choices?.[0]?.message?.content?.trim() || '{}'
        const parsed = JSON.parse(raw)
        let holidays = (parsed.holidays || []).filter(
          h => h.name && h.date && !isNaN(Date.parse(h.date))
        )
        if (holidays.length > 0) {
          return res.status(200).json({ holidays, source: 'ai' })
        }
      } else {
        const errText = await response.text()
        console.warn('OpenAI calendar parse failed:', response.status, errText)
      }
    } catch (aiErr) {
      console.warn('OpenAI call threw:', aiErr.message)
    }
  }

  // ── 2. Local regex fallback ───────────────────────────────────────────────
  // Handles the most common teacher paste formats even without a working AI key.
  try {
    const holidays = localParse(text, schoolYear1, schoolYear2)
    if (holidays.length > 0) {
      return res.status(200).json({ holidays, source: 'local' })
    }
    return res.status(200).json({
      holidays: [],
      source: 'local',
      warning: 'No recognisable dates found. Try a more specific format like "Thanksgiving Break: Nov 24–28, 2024".',
    })
  } catch (localErr) {
    console.error('local parse error:', localErr)
    return res.status(500).json({ error: `Parsing failed: ${localErr.message}`, holidays: [] })
  }
}

// ─── Local parser ─────────────────────────────────────────────────────────────

const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12,
}

function ordinal(n) {
  // "24th" → 24
  return parseInt(n.replace(/\D/g, ''), 10)
}

function inferYear(month, schoolYear1, schoolYear2) {
  // Aug–Dec → school year 1 start, Jan–Jul → school year 2
  return month >= 8 ? schoolYear1 : schoolYear2
}

function pad(n) { return String(n).padStart(2, '0') }

function expandRange(name, month, startDay, endDay, year) {
  const dates = []
  const lastDay = new Date(year, month, 0).getDate() // last day of that month
  const actualEnd = Math.min(endDay, lastDay)
  for (let d = startDay; d <= actualEnd; d++) {
    dates.push({ name, date: `${year}-${pad(month)}-${pad(d)}` })
  }
  return dates
}

function localParse(text, schoolYear1, schoolYear2) {
  const results = []

  // Split on newlines and commas to try each chunk independently
  const chunks = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)

  for (const chunk of chunks) {
    const lower = chunk.toLowerCase()

    // Determine the event name: everything before the first month word
    const monthKeys = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length)
    let eventName = chunk
    let remainder = lower

    for (const mk of monthKeys) {
      const idx = lower.indexOf(mk)
      if (idx !== -1) {
        eventName = chunk.slice(0, idx).trim().replace(/[:\-–]+$/, '').trim() || chunk.trim()
        remainder = lower.slice(idx)
        break
      }
    }

    if (!eventName) eventName = chunk

    // Pattern: "Month Day through/to/- Day [Year]"
    // e.g. "November 24th through the 27th", "Nov 24-27", "November 24 – December 1"
    const rangePattern = /(\w+)\s+(\d+(?:st|nd|rd|th)?)\s*(?:through|thru|to|-|–|—)\s*(?:the\s+)?(?:(\w+)\s+)?(\d+(?:st|nd|rd|th)?)(?:\s*,?\s*(\d{4}))?/i
    const singlePattern = /(\w+)\s+(\d+(?:st|nd|rd|th)?)(?:\s*,?\s*(\d{4}))?/i

    const rangeMatch = remainder.match(rangePattern)
    if (rangeMatch) {
      const [, m1, d1Str, m2Str, d2Str, yearStr] = rangeMatch
      const month1 = MONTH_MAP[m1.toLowerCase()]
      if (!month1) continue
      const day1 = ordinal(d1Str)
      const day2 = ordinal(d2Str)

      // Second month may or may not be specified
      const month2 = m2Str ? (MONTH_MAP[m2Str.toLowerCase()] || month1) : month1
      const year1 = yearStr ? parseInt(yearStr) : inferYear(month1, schoolYear1, schoolYear2)
      const year2 = yearStr ? parseInt(yearStr) : inferYear(month2, schoolYear1, schoolYear2)

      if (!day1 || !day2) continue

      // Same month range
      if (month1 === month2 && year1 === year2) {
        results.push(...expandRange(eventName, month1, day1, day2, year1))
      } else {
        // Cross-month range: fill month1 to end, then month2 from 1 to day2
        const lastOfMonth1 = new Date(year1, month1, 0).getDate()
        results.push(...expandRange(eventName, month1, day1, lastOfMonth1, year1))
        results.push(...expandRange(eventName, month2, 1, day2, year2))
      }
      continue
    }

    // Single date: "November 28" or "Nov 28, 2024"
    const singleMatch = remainder.match(singlePattern)
    if (singleMatch) {
      const [, m1, d1Str, yearStr] = singleMatch
      const month = MONTH_MAP[m1.toLowerCase()]
      if (!month) continue
      const day = ordinal(d1Str)
      const year = yearStr ? parseInt(yearStr) : inferYear(month, schoolYear1, schoolYear2)
      if (!day) continue
      results.push({ name: eventName, date: `${year}-${pad(month)}-${pad(day)}` })
    }
  }

  // Deduplicate by date
  const seen = new Set()
  return results.filter(h => {
    if (seen.has(h.date)) return false
    seen.add(h.date)
    return true
  })
}
