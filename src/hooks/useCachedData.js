import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// Simple in-memory cache with TTL (time-to-live)
const dataCache = {}
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function useCachedData(cacheKey, fetchFn, dependencies = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    async function loadData() {
      // Check cache first
      const cached = dataCache[cacheKey]
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        if (isMountedRef.current) {
          setData(cached.data)
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        const result = await fetchFn()
        if (isMountedRef.current) {
          setData(result)
          setError(null)
          // Store in cache
          dataCache[cacheKey] = {
            data: result,
            timestamp: Date.now(),
          }
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(err)
          setData(null)
        }
      } finally {
        if (isMountedRef.current) setLoading(false)
      }
    }

    loadData()

    return () => {
      isMountedRef.current = false
    }
  }, [cacheKey, fetchFn, ...dependencies])

  return { data, loading, error }
}

// Clear specific cache entry
export function clearCache(cacheKey) {
  delete dataCache[cacheKey]
}

// Clear all cache
export function clearAllCache() {
  Object.keys(dataCache).forEach(key => delete dataCache[key])
}

// Pre-populate cache (useful for seeding data)
export function seedCache(cacheKey, data) {
  dataCache[cacheKey] = {
    data,
    timestamp: Date.now(),
  }
}
