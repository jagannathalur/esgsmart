import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DbfsReadOk = { data: string }

async function dbfsRead(
  host: string,
  token: string,
  path: string
): Promise<{ ok: true; json: any } | { ok: false; status: number; body: string }> {
  const url = `${host.replace(/\/$/, "")}/api/2.0/dbfs/read?path=${encodeURIComponent(path)}`
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })

  if (!r.ok) {
    return { ok: false, status: r.status, body: await r.text() }
  }

  const j = (await r.json()) as DbfsReadOk
  if (!j?.data) {
    return { ok: false, status: 500, body: "DBFS read returned no data" }
  }

  try {
    const raw = Buffer.from(j.data, "base64").toString("utf8")
    const parsed = JSON.parse(raw)
    return { ok: true, json: parsed }
  } catch (e: any) {
    return { ok: false, status: 500, body: `Failed to parse JSON: ${e?.message || e}` }
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { pdfId: string } }
) {
  try {
    const host = process.env.DATABRICKS_HOST
    const token = process.env.DATABRICKS_TOKEN

    if (!host || !token) {
      return NextResponse.json(
        { error: "Databricks configuration missing (DATABRICKS_HOST / DATABRICKS_TOKEN)" },
        { status: 400 }
      )
    }

    const pdfId = params?.pdfId
    if (!pdfId) {
      return NextResponse.json({ error: "Missing pdfId" }, { status: 400 })
    }

    const gapDir = process.env.DATABRICKS_GAP_DIR || "dbfs:/tmp/gap_analysis"
    const baseDir = gapDir.replace(/^dbfs:\//, "").replace(/\/$/, "")

    const candidates = [
      `${baseDir}/severity_${pdfId}.json`,
      `${baseDir}/${pdfId}.json`,
      `${baseDir}/gap_${pdfId}.json`,
    ]

    const tried: string[] = []

    for (const path of candidates) {
      tried.push(path)
      console.log(`[gap] Trying: ${path}`)

      const res = await dbfsRead(host, token, path)
      if (res.ok) {
        console.log(`[gap] ✓ Found: ${path}`)
        return NextResponse.json(
          { ok: true, artifact: res.json, pathTried: path },
          { status: 200, headers: { "Cache-Control": "no-store" } }
        )
      }

      // If it's not a 404, surface the exact error
      if (!res.ok && res.status !== 404) {
        console.error(`[gap] Error reading ${path}: ${res.body}`)
        return NextResponse.json(
          {
            error: `DBFS read failed ${res.status}`,
            detail: res.body?.slice(0, 500),
            pathTried: path,
          },
          { status: res.status }
        )
      }
    }

    // None found
    console.log(`[gap] Not found. Tried: ${tried.join(", ")}`)
    return NextResponse.json(
      {
        notFound: true,
        message: "Gap artifact not found yet",
        pathsTried: tried,
      },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    )
  } catch (err: any) {
    console.error("[gap] Unexpected error:", err)
    return NextResponse.json(
      { error: err?.message || "Unexpected server error" },
      { status: 500 }
    )
  }
}
