import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/databricks/fetch/[pdfId]?batch_path=<optional>
 *
 * Unified endpoint that fetches:
 * 1. Summary from DBFS batch predictions
 * 2. Benchmark from DBFS
 * 3. Gap analysis from DBFS
 */

type DbfsReadResult =
  | { ok: true; data: any }
  | { ok: false; status: number; error: string }

// ==================== Helpers ====================

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

async function dbfsReadJSON(
  host: string,
  token: string,
  path: string
): Promise<DbfsReadResult> {
  try {
    // Normalize path
    const dbfsPath = path.startsWith("dbfs:")
      ? path
      : path.startsWith("/dbfs/")
      ? `dbfs:${path.replace(/^\/dbfs/, "")}`
      : `dbfs:${path}`

    const CHUNK = 1_000_000
    let offset = 0
    let base64All = ""

    while (true) {
      const q = new URLSearchParams({
        path: dbfsPath,
        offset: String(offset),
        length: String(CHUNK),
      })

      const r = await fetch(`${host}/api/2.0/dbfs/read?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })

      if (!r.ok) {
        if (r.status === 404) {
          return { ok: false, status: 404, error: "File not found" }
        }
        return { ok: false, status: r.status, error: await r.text() }
      }

      const j = (await r.json()) as { data?: string; bytes_read?: number }
      const chunkB64 = j?.data || ""
      const bytesRead = j?.bytes_read ?? 0

      if (!chunkB64 || bytesRead === 0) break

      base64All += chunkB64
      offset += bytesRead

      if (bytesRead < CHUNK) break
    }

    if (!base64All) {
      return { ok: false, status: 404, error: "Empty file" }
    }

    const buffer = Buffer.from(base64All, "base64")
    const text = buffer.toString("utf8")
    const parsed = JSON.parse(text)

    return { ok: true, data: parsed }
  } catch (err: any) {
    return { ok: false, status: 500, error: err?.message || String(err) }
  }
}

async function readSummaryFromBatch(
  host: string,
  token: string,
  batchPath: string,
  pdfId: string
): Promise<any | null> {
  try {
    console.log(`[fetch] Reading batch file: ${batchPath}`)
    const result = await dbfsReadJSON(host, token, batchPath)
    
    if (!result.ok) {
      console.log(`[fetch] Batch file not ready: ${result.error}`)
      return null
    }

    // Batch file is NDJSON - could be array or single object
    let predictions: any[] = []
    
    if (Array.isArray(result.data)) {
      predictions = result.data
    } else if (typeof result.data === 'string') {
      // Parse NDJSON
      const lines = result.data.split('\n').filter(l => l.trim())
      predictions = lines.map(line => JSON.parse(line))
    } else {
      predictions = [result.data]
    }

    // Find the row with matching pdfId
    const row = predictions.find((p: any) => {
      const rowPdfId = p.pdf_id || p?.json_schema?.pdf_id || p?.metadata?.pdf_id
      return rowPdfId === pdfId
    })

    if (row) {
      console.log(`[fetch] ✓ Found summary in batch`)
      return row
    }

    console.log(`[fetch] No matching pdfId in batch predictions`)
    return null
  } catch (err) {
    console.error("[fetch] Error reading batch:", err)
    return null
  }
}

// ==================== Route ====================

export async function GET(
  req: NextRequest,
  { params }: { params: { pdfId: string } }
) {
  try {
    const host = need("DATABRICKS_HOST")
    const token = need("DATABRICKS_TOKEN")
    const benchDir = process.env.DATABRICKS_BENCHMARK_DIR || "dbfs:/tmp/sbti_benchmarks"
    const gapDir = process.env.DATABRICKS_GAP_DIR || "dbfs:/tmp/gap_analysis"

    const pdfId = params?.pdfId
    if (!pdfId) {
      return NextResponse.json({ error: "Missing pdfId" }, { status: 400 })
    }

    // Get batch_path from query params (passed by frontend)
    const url = new URL(req.url)
    const batchPath = url.searchParams.get("batch_path")

    console.log(`[fetch] Starting fetch for pdfId: ${pdfId}`)
    if (batchPath) {
      console.log(`[fetch] Batch path: ${batchPath}`)
    }

    // Fetch summary from batch file
    let summaryData: any = null
    if (batchPath) {
      summaryData = await readSummaryFromBatch(host, token, batchPath, pdfId)
    } else {
      console.log("[fetch] No batch_path provided, skipping summary")
    }

    // Fetch benchmark from DBFS
    console.log(`[fetch] Trying benchmark: ${benchDir}/${pdfId}.json`)
    const benchmarkResult = await dbfsReadJSON(host, token, `${benchDir}/${pdfId}.json`)
    if (benchmarkResult.ok) {
      console.log(`[fetch] ✓ Benchmark found`)
    } else {
      console.log(`[fetch] ✗ Benchmark not ready: ${benchmarkResult.error}`)
    }

    // Try gap with multiple naming patterns
    console.log(`[fetch] Trying gap analysis...`)
    const gapPatterns = [
      `${gapDir}/severity_${pdfId}.json`,
      `${gapDir}/${pdfId}.json`,
      `${gapDir}/gap_${pdfId}.json`,
    ]

    let gapResult: DbfsReadResult = { ok: false, status: 404, error: "Not found" }
    for (const path of gapPatterns) {
      const res = await dbfsReadJSON(host, token, path)
      if (res.ok) {
        console.log(`[fetch] ✓ Gap found: ${path}`)
        gapResult = res
        break
      }
    }

    if (!gapResult.ok) {
      console.log(`[fetch] ✗ Gap not ready`)
    }

    // Determine ready status
    const ready = {
      summary: summaryData !== null,
      benchmark: benchmarkResult.ok,
      gap: gapResult.ok,
      all: false,
    }
    ready.all = ready.summary && ready.benchmark && ready.gap

    console.log(`[fetch] Ready status:`, ready)

    return NextResponse.json(
      {
        ready,
        summary: summaryData,
        benchmark: benchmarkResult.ok ? benchmarkResult.data : null,
        gap: gapResult.ok ? gapResult.data : null,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    )
  } catch (err: any) {
    console.error("[fetch] Error:", err)
    return NextResponse.json(
      { error: err?.message || "Fetch failed" },
      { status: 500 }
    )
  }
}
