// Vercel serverless function
// POST /api/delete-account
// Body: { userId }  (must match the authenticated user's JWT sub)
//
// Deletes all user data and then permanently removes the auth user.
// Requires SUPABASE_SERVICE_ROLE_KEY in environment variables.

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth check: verify the request comes from the user themselves ──
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return res.status(401).json({ error: 'No auth token' })

  // Public client — authenticates the token
  const supabasePublic = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const { data: { user }, error: authErr } = await supabasePublic.auth.getUser()
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  const userId = user.id

  // ── Service-role client — can delete auth users ──
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    // 1. Delete user data in dependency order (FK cascade should handle most,
    //    but being explicit avoids RLS issues during deletion).
    const tables = [
      'lesson_segments',
      'lesson_progress',
      'schedule_overrides',
      'lessons',
      'units',
      'sections',
      'school_holidays',
      'courses',
      'users',
    ]

    for (const table of tables) {
      const col = table === 'users' ? 'id' : 'teacher_id'
      const { error } = await supabaseAdmin.from(table).delete().eq(col, userId)
      if (error) {
        // Non-fatal: column might not exist on all tables; log and continue
        console.warn(`Could not delete from ${table}:`, error.message)
      }
    }

    // 2. Delete storage (avatars bucket)
    await supabaseAdmin.storage.from('avatars').remove([`avatars/${userId}.jpg`, `avatars/${userId}.png`, `avatars/${userId}.webp`])

    // 3. Delete the auth user (irreversible)
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteErr) throw deleteErr

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Account deletion failed:', err)
    return res.status(500).json({ error: err.message || 'Deletion failed' })
  }
}
