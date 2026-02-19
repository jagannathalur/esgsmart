// app/api/databricks/benchmark/[pdfId]/route.ts
import { NextRequest, NextResponse } from "next/server"

// We want fresh reads every time; the artifact may appear shortly after the job finishes.
export const dynamic = "force-dynamic"

type ReadResult =
  | { ok: true; json: any }
  | { ok: false; status: number; body: string }

async function dbfsReadJson(host: string, token: string, path: string): Promise<ReadResult> {
  const url = `${host}/api/2.0/dbfs/read?path=${encodeURIComponent(path)}`
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })

  // Non-200: return short error body (don't throw so caller can try fallbacks)
  if (!r.ok) {
    const txt = await r.text().catch(() => "")
    return { ok: false, status: r.status, body: txt }
  }

  // DBFS read returns base64 data: { data: "..." }
  const payload = await r.json()
  const raw = Buffer.from(payload?.data ?? "", "base64").toString("utf8")

  // Keep a strict pass-through policy; do not coerce percentages or numbers.
  // If JSON parse fails, surface a concise error to caller.
  try {
    const json = JSON.parse(raw)
    return { ok: true, json }
  } catch (err: any) {
    return { ok: false, status: 502, body: `Artifact is not valid JSON at ${path}: ${String(err?.message || err)}` }
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { pdfId: string } }
) {
  try {
    const host = process.env.DATABRICKS_HOST
    const token = process.env.DATABRICKS_TOKEN
    // Default aligns with the Streamlit job convention
    const baseDir = (process.env.DATABRICKS_BENCHMARK_DIR || "dbfs:/tmp/sbti_benchmarks").replace(/\/$/, "")
    const pdfId = params?.pdfId

    if (!host || !token) {
      return NextResponse.json(
        { error: "Databricks configuration missing (DATABRICKS_HOST/TOKEN)" },
        { status: 400 }
      )
    }
    if (!pdfId) {
      return NextResponse.json({ error: "Missing pdfId" }, { status: 400 })
    }

    // Try a few likely file names/locations (job variants sometimes differ slightly)
    const candidates = [
      `${baseDir}/benchmark_${pdfId}.json`,
      `${baseDir}/${pdfId}.json`,
      `${baseDir}/${pdfId}/benchmark.json`,
    ]

    const tried: Array<{ path: string; status?: number }> = []

    for (const path of candidates) {
      const res = await dbfsReadJson(host, token, path)
      if (res.ok) {
        // Strict pass-through: return exactly what the job produced.
        return NextResponse.json({ ok: true, artifact: res.json, pathUsed: path })
      }
      tried.push({ path, status: res.status })
      // If not found, try next path. Any non-404 error we surface immediately.
      if (res.status && res.status !== 404) {
        return NextResponse.json(
          { error: `DBFS read failed ${res.status}`, pathTried: path, details: res.body?.slice(0, 500) },
          { status: res.status }
        )
      }
    }

    // Nothing found on any candidate
    return NextResponse.json(
      {
        notFound: true,
        message: "Benchmark artifact not found yet",
        pathsTried: tried,
      },
      { status: 404 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected server error" },
      { status: 500 }
    )
  }
}
