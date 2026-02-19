import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

/**
 * GET /api/databricks/dbfs-read?path=<dbfs_path>
 *
 * - Proxies Databricks DBFS Read API and returns the full file.
 * - Streams in chunks to handle files > 1MB.
 * - Includes retry logic for transient failures.
 * - If the file is JSON, returns { ok:true, kind:"json", artifact, path }.
 *   Otherwise returns { ok:true, kind:"text", content, path }.
 *
 * Env required:
 *   DATABRICKS_HOST
 *   DATABRICKS_TOKEN
 */

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, options)
      // Don't retry 404s (file doesn't exist)
      if (r.ok || r.status === 404) return r
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, 1000 * (i + 1))) // Exponential backoff
      }
    } catch (err) {
      if (i === retries - 1) throw err
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)))
    }
  }
  throw new Error("Max retries exceeded")
}

export async function GET(req: NextRequest) {
  try {
    const host = process.env.DATABRICKS_HOST
    const token = process.env.DATABRICKS_TOKEN
    if (!host || !token) {
      return NextResponse.json(
        { error: "Missing DATABRICKS_HOST or DATABRICKS_TOKEN" },
        { status: 400 }
      )
    }

    const url = new URL(req.url)
    const rawPath = url.searchParams.get("path") || ""
    if (!rawPath) {
      return NextResponse.json({ error: "Missing 'path' query param" }, { status: 400 })
    }

    // Normalize: accept both "/dbfs/..." and "dbfs:/..."
    const dbfsPath = rawPath.startsWith("/dbfs/")
      ? `dbfs:/${rawPath.replace(/^\/dbfs\//, "")}`
      : rawPath

    // Page through file in chunks
    const CHUNK = 1_000_000 // 1MB per call
    let offset = 0
    let base64All = ""

    while (true) {
      const q = new URLSearchParams({
        path: dbfsPath,
        offset: String(offset),
        length: String(CHUNK),
      })

      const r = await fetchWithRetry(
        `${host}/api/2.0/dbfs/read?${q.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      )

      if (!r.ok) {
        const t = await r.text()
        return NextResponse.json(
          { error: `DBFS read failed ${r.status}: ${t?.slice(0, 300)}`, path: dbfsPath },
          { status: r.status }
        )
      }

      const j = (await r.json()) as { data?: string; bytes_read?: number }
      const chunkB64 = j?.data || ""
      const bytesRead = j?.bytes_read ?? 0

      if (!chunkB64 || bytesRead === 0) break

      base64All += chunkB64
      offset += bytesRead

      // If we read less than requested, we've reached EOF
      if (bytesRead < CHUNK) break
    }

    if (!base64All) {
      // Empty file
      return NextResponse.json({ ok: true, kind: "text", content: "", path: dbfsPath })
    }

    const buffer = Buffer.from(base64All, "base64")
    const text = buffer.toString("utf8")

    // Try to parse as JSON
    try {
      const artifact = JSON.parse(text)
      return NextResponse.json({ ok: true, kind: "json", artifact, path: dbfsPath })
    } catch {
      // Not JSON — return raw text
      return NextResponse.json({ ok: true, kind: "text", content: text, path: dbfsPath })
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected server error" },
      { status: 500 }
    )
  }
}
