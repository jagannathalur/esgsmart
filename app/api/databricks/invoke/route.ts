import { NextResponse } from "next/server"
import crypto from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PredictionsBody = { predictions?: any[] } | any[]

/* ==== ENV (from .env.local) ==== */
function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

const DATABRICKS_HOST = () => need("DATABRICKS_HOST")
const DATABRICKS_TOKEN = () => need("DATABRICKS_TOKEN")
const ENDPOINT_NAME = () => process.env.DATABRICKS_ENDPOINT || "esgsmart_chatbot"
const JOB_ID = () => (process.env.DATABRICKS_JOB_ID ? Number(process.env.DATABRICKS_JOB_ID) : 0)
const TARGET_TABLE = () =>
  process.env.DATABRICKS_TARGET_TABLE || "esgsmart.pdf_extraction.report_extractions"
const BENCHMARK_DIR = () => process.env.DATABRICKS_BENCHMARK_DIR || "dbfs:/tmp/sbti_benchmarks"
const DBFS_BASE = () => process.env.DATABRICKS_DBFS_BASE || "dbfs:/tmp/pdf_extractions"

/* ==== Helpers ==== */
function dbxHeadersJSON() {
  return {
    Authorization: `Bearer ${DATABRICKS_TOKEN()}`,
    "Content-Type": "application/json",
  }
}

async function pdfBytesToText(buf: Buffer): Promise<string> {
  try {
    // Inline require to avoid Webpack bundling issues
    const pdfParse = require("pdf-parse")
    const data = await pdfParse(buf)
    return data?.text ? data.text.trim() : ""
  } catch (err: any) {
    console.error("[invoke] pdf-parse failed:", err)
    throw new Error(`PDF parsing failed: ${err?.message || err}`)
  }
}

function sha256(s: string | Buffer) {
  return crypto.createHash("sha256").update(s).digest("hex")
}

function first(x: PredictionsBody): any {
  if (Array.isArray(x)) return x[0] ?? {}
  if (x && typeof x === "object" && Array.isArray((x as any).predictions)) {
    return (x as any).predictions[0] ?? {}
  }
  return {}
}

function extractPdfId(row: any, fallback: string) {
  if (!row || typeof row !== "object") return fallback
  return (
    row.pdf_id ??
    row?.json_schema?.pdf_id ??
    row?.metadata?.pdf_id ??
    row?.context?.pdf_id ??
    fallback
  )
}

/* ==== Databricks calls ==== */
async function callServing(records: any[]) {
  const url = `${DATABRICKS_HOST()}/serving-endpoints/${ENDPOINT_NAME()}/invocations`
  const r = await fetch(url, {
    method: "POST",
    headers: dbxHeadersJSON(),
    body: JSON.stringify({ dataframe_records: records }),
  })
  if (!r.ok) throw new Error(`Serving error ${r.status}: ${await r.text()}`)
  return (await r.json()) as PredictionsBody
}

async function dbfsPutText(targetPath: string, text: string) {
  const url = `${DATABRICKS_HOST()}/api/2.0/dbfs/put`
  const body = {
    path: targetPath,
    overwrite: true,
    contents: Buffer.from(text, "utf8").toString("base64"),
  }
  const r = await fetch(url, {
    method: "POST",
    headers: dbxHeadersJSON(),
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`DBFS put failed ${r.status}: ${await r.text()}`)
}

async function runMergeJob(batchPath: string) {
  const jobId = JOB_ID()
  if (!jobId) return { run_id: null }

  const url = `${DATABRICKS_HOST()}/api/2.1/jobs/run-now`
  const payload = {
    job_id: jobId,
    notebook_params: {
      batch_path: batchPath,
      target_table: TARGET_TABLE(),
      output_dir: BENCHMARK_DIR(),
    },
  }
  const r = await fetch(url, {
    method: "POST",
    headers: dbxHeadersJSON(),
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`run-now failed ${r.status}: ${await r.text()}`)
  return (await r.json()) as { run_id: number }
}

/* ==== Route ==== */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    if (url.searchParams.get("ping")) {
      return NextResponse.json({ ok: true, msg: "invoke route mounted" })
    }

    const body = await req.json().catch(() => ({}))
    const { pdfName, pdfBytes } = body as { pdfName?: string; pdfBytes?: string }
    if (!pdfBytes) {
      return NextResponse.json(
        { ok: false, error: "Missing pdfBytes (base64)" },
        { status: 400 }
      )
    }

    const pdfBuf = Buffer.from(pdfBytes, "base64")

    // 1) Extract text & ids
    const text = await pdfBytesToText(pdfBuf)
    const textHash = sha256(text || pdfBuf)
    const pdfId = `pdf_${textHash.slice(0, 16)}`

    // 2) Hit serving endpoint
    const records = [
      { pdf_id: pdfId, pdf_doc: text, text_sha256: textHash, company_name: null },
    ]
    const servingResp = await callServing(records)
    const row = first(servingResp)
    const resolvedPdfId = String(extractPdfId(row, pdfId))

    // 3) Write predictions NDJSON to DBFS
    const ndjson = Array.isArray((servingResp as any).predictions)
      ? (servingResp as any).predictions.map((r: any) => JSON.stringify(r)).join("\n")
      : Array.isArray(servingResp)
      ? (servingResp as any[]).map((r) => JSON.stringify(r)).join("\n")
      : JSON.stringify(row)

    const day = new Date().toISOString().slice(0, 10)
    const batchPath = `${DBFS_BASE().replace(/\/$/, "")}/${day}/batch_${crypto.randomUUID()}.json`
    await dbfsPutText(batchPath, ndjson)

    // 4) Trigger MERGE + benchmarking job (fire-and-forget)
    const run = await runMergeJob(batchPath)

    return NextResponse.json({
      ok: true,
      pdfId: resolvedPdfId,
      batchPath,
      runId: run?.run_id ?? null,
      debug: {
        name: pdfName ?? null,
        hash: textHash,
        computedPdfId: pdfId,
        resolvedPdfId,
      },
    })
  } catch (err: any) {
    console.error("[/api/databricks/invoke] error:", err)
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    )
  }
}
