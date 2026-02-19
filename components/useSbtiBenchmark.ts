//components/useSbtiBenchmark.ts
import { useEffect, useState } from "react"

export function useSbtiBenchmark(pdfId: string | null, maxWaitMs = 10000) {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!pdfId) return
    let cancelled = false
    setLoading(true)
    const start = Date.now()

    const tick = async () => {
      if (cancelled) return
      const path = `dbfs:/tmp/sbti_benchmarks/${pdfId}.json`
      const r = await fetch(`/api/databricks/dbfs-read?path=${encodeURIComponent(path)}`)
      if (r.ok) {
        const j = await r.json()
        if (!cancelled && !j?.notFound) {
          setData(j)
          setLoading(false)
          return
        }
      }
      if (Date.now() - start < maxWaitMs) {
        setTimeout(tick, 1000)
      } else {
        setLoading(false)
      }
    }

    tick()
    return () => { cancelled = true }
  }, [pdfId, maxWaitMs])

  return { data, loading }
}
