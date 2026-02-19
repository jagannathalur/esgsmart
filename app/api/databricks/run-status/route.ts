//app/api/databricks/run-status/route.ts
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  try {
    const host  = process.env.DATABRICKS_HOST
    const token = process.env.DATABRICKS_TOKEN
    if (!host || !token) {
      return NextResponse.json({ error: "Databricks configuration missing" }, { status: 400 })
    }
    const runId = req.nextUrl.searchParams.get("run_id")
    if (!runId) return NextResponse.json({ error: "Missing run_id" }, { status: 400 })

    const url = `${host.replace(/\/+$/,'')}/api/2.1/jobs/runs/get`
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ run_id: Number(runId) }),
      cache: "no-store",
    })
    const t = await r.text()
    if (!r.ok) {
      return NextResponse.json({ error: `runs/get failed ${r.status}: ${t}` }, { status: r.status })
    }
    return NextResponse.json(JSON.parse(t))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected server error" }, { status: 500 })
  }
}
