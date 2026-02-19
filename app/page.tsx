"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Upload,
  MessageCircle,
  FileText,
  BarChart3,
  Target,
  ArrowLeft,
  RefreshCcw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

/* ========================= Config ========================= */
const POLL_MS = 3000 // poll every 3s until ALL (summary+benchmark+gap) are ready

/* ========================= Small utils ========================= */
type Row = Record<string, any>
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/[, ]+/g, "")
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function formatNumber(n: number) {
  if (!Number.isFinite(n)) return "n/a"
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B"
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return n.toLocaleString()
}

function pick<T = any>(obj: any, keys: string[], def: any = undefined): T {
  for (const k of keys) {
    const val = obj?.[k]
    if (val !== undefined && val !== null) return val as T
  }
  return def
}

/* ========================= Loaders / Charts ========================= */
function IndeterminateBar({ height = 8, rounded = true }: { height?: number; rounded?: boolean }) {
  return (
    <div className="relative w-full overflow-hidden bg-muted" style={{ height, borderRadius: rounded ? 9999 : 0 }}>
      <div className="absolute h-full w-2/5 -left-2/5 animate-[indet_1.1s_ease-in-out_infinite] bg-foreground/20" />
      <style jsx>{`
        @keyframes indet { 0% { left:-40%; } 100% { left:100%; } }
      `}</style>
    </div>
  )
}

function TinyBarChart({
  data,
  height = 220,
}: {
  data: Array<{ label: string; value: number }>
  height?: number
}) {
  const max = Math.max(1, ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)))
  const palette = ["#3b82f6", "#10b981", "#f59e0b"]
  return (
    <div className="w-full">
      <div className="flex items-end justify-around gap-8" style={{ height }}>
        {data.map((d, i) => {
          const v = Number.isFinite(d.value) ? d.value : 0
          const h = Math.max(2, Math.round((v / max) * (height - 24)))
          const fill = palette[i % palette.length]
          return (
            <div key={d.label} className="flex flex-col items-center">
              <div
                className="w-24 rounded-t-md"
                style={{ height: h, background: fill, boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}
                title={`${d.label}: ${formatNumber(v)}`}
                aria-label={`${d.label}: ${formatNumber(v)}`}
              />
              <div className="mt-2 text-sm text-muted-foreground">{d.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniLineChart({
  series,
  height = 260,
  padding = 36,
}: {
  series: Array<{ name: string; points: Array<{ x: number; y: number }> }>
  height?: number
  padding?: number
}) {
  const all = series.flatMap((s) => s.points)
  if (!all.length) return <div className="text-sm text-muted-foreground">No data available.</div>

  const width = 640
  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const axisColor = "hsl(var(--muted-foreground))"
  const colors = ["#3b82f6", "#10b981", "#f59e0b"]

  const scaleX = (x: number) => (maxX === minX ? padding : padding + ((x - minX) / (maxX - minX)) * (width - padding * 2))
  const scaleY = (y: number) => (maxY === minY ? height - padding : height - padding - ((y - minY) / (maxY - minY)) * (height - padding * 2))

  const yTicks = [0, 1, 2, 3].map((i) => minY + (i * (maxY - minY)) / 3)

  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [hoverYs, setHoverYs] = useState<Array<{ name: string; x: number; y: number; px: number; py: number }>>([])

  const onMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const xPx = e.clientX - rect.left
    const t = clamp((xPx - padding) / (width - padding * 2), 0, 1)
    const yr = Math.round(minX + t * (maxX - minX))
    const clamped = clamp(yr, minX, maxX)
    setHoverYear(clamped)
    setHoverX(scaleX(clamped))
    const pts: Array<{ name: string; x: number; y: number; px: number; py: number }> = []
    for (const s of series) {
      const p = s.points.find((pp) => pp.x === clamped)
      if (p) pts.push({ name: s.name, x: p.x, y: p.y, px: scaleX(p.x), py: scaleY(p.y) })
    }
    setHoverYs(pts)
  }
  const onLeave: React.MouseEventHandler<SVGSVGElement> = () => {
    setHoverYear(null)
    setHoverX(null)
    setHoverYs([])
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="relative inline-block">
        <svg width={width} height={height} role="img" aria-label="SBTi trajectories" onMouseMove={onMove} onMouseLeave={onLeave} style={{ display: "block" }}>
          {/* Axes */}
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke={axisColor} strokeWidth={1} />
          <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke={axisColor} strokeWidth={1} />

          {/* X ticks */}
          {[minX, Math.round((minX + maxX) / 2), maxX].map((t, i) => (
            <g key={i}>
              <line x1={scaleX(t)} y1={height - padding} x2={scaleX(t)} y2={height - padding + 4} stroke={axisColor} />
              <text x={scaleX(t)} y={height - padding + 16} fontSize="10" textAnchor="middle" fill={axisColor}>{t}</text>
            </g>
          ))}

          {/* Y ticks + grid */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padding - 4} y1={scaleY(t)} x2={padding} y2={scaleY(t)} stroke={axisColor} />
              <text x={padding - 8} y={scaleY(t) + 3} fontSize="10" textAnchor="end" fill={axisColor}>
                {formatNumber(Math.round(t))}
              </text>
              <line x1={padding} y1={scaleY(t)} x2={width - padding} y2={scaleY(t)} stroke="hsl(var(--muted))" strokeWidth={1} opacity={0.35} />
            </g>
          ))}

          {/* Lines */}
          {series.map((s, idx) => {
            if (!s.points.length) return null
            const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.x).toFixed(2)} ${scaleY(p.y).toFixed(2)}`).join(" ")
            return <path key={s.name} d={d} fill="none" stroke={colors[idx % colors.length]} strokeWidth={2} />
          })}

          {/* Legend */}
          {series.map((s, idx) => (
            <g key={s.name} transform={`translate(${padding + idx * 170}, ${padding - 12})`}>
              <rect width="12" height="12" fill={colors[idx % colors.length]} rx="2" />
              <text x="18" y="11" fontSize="11" fill="hsl(var(--foreground))">{s.name}</text>
            </g>
          ))}

          {/* Hover */}
          {hoverX != null && (
            <g>
              <line x1={hoverX} y1={padding} x2={hoverX} y2={height - padding} stroke="hsl(var(--foreground))" strokeWidth={1} opacity={0.25} />
              {hoverYs.map((p, i) => (
                <circle key={i} cx={p.px} cy={p.py} r={4} fill={colors[i % colors.length]} stroke="#fff" strokeWidth={1.5} />
              ))}
            </g>
          )}
        </svg>

        {/* Tooltip */}
        {hoverYear != null && hoverYs.length > 0 && (
          <div
            className="absolute rounded-md border bg-popover text-popover-foreground shadow-md px-3 py-2 text-xs"
            style={{ left: clamp((hoverX ?? 0) + 12, 8, 640 - 180), top: 8, maxWidth: 240 }}
          >
            <div className="font-medium mb-1">Year {hoverYear}</div>
            <div className="space-y-0.5">
              {hoverYs.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block rounded-[2px]" style={{ width: 10, height: 10, background: colors[idx % colors.length] }} />
                    {p.name}
                  </span>
                  <span className="tabular-nums">{formatNumber(Math.round(p.y))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ========================= Page ========================= */
export default function ESGsmartPage() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [activeTab, setActiveTab] = useState<"summary" | "benchmarking" | "gap">("summary")

  // Orchestration
  const [pdfId, setPdfId] = useState<string | null>(null)
  const [batchPath, setBatchPath] = useState<string | null>(null)
  const [dbxRunId, setDbxRunId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Unified payloads
  const [allReady, setAllReady] = useState(false)
  const [summaryRow, setSummaryRow] = useState<Row | null>(null)
  const [bench, setBench] = useState<any | null>(null)
  const [gapData, setGapData] = useState<any | null>(null)
  const [fetching, setFetching] = useState(false)

  // Chat
  const QUICK_QUESTIONS = useMemo(
    () => [
      "Does Singapore mandate GRI-aligned disclosures for real estate companies?",
      "Are there peers with similar revenue or size that have more aggressive targets?",
      "Which missing disclosures can we address with data we already have internally?",
      
    ],
    [],
  )
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "ai"; content: string }>>([])
  const [currentMessage, setCurrentMessage] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" })
  }, [chatMessages])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRefNew = useRef<HTMLInputElement | null>(null)

  /* -------------------- Upload + Invoke (no waiting) -------------------- */
  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const base64 = result.includes(",") ? result.split(",")[1] : result
        resolve(base64)
      }
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"))
      reader.readAsDataURL(file)
    })
  }

  async function invokeDatabricks(file: File) {
    const base64 = await fileToBase64(file)
    const r = await fetch("/api/databricks/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfName: file.name, pdfBytes: base64 }),
    })
    if (!r.ok) {
      let msg = `Invoke failed ${r.status}`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return (await r.json()) as { ok: boolean; pdfId: string; batchPath: string; runId: number }
  }

  const resetState = () => {
    setActiveTab("summary")
    setPdfId(null)
    setBatchPath(null)
    setDbxRunId(null)
    setAllReady(false)
    setSummaryRow(null)
    setBench(null)
    setGapData(null)
    setErrorMsg(null)
    setChatMessages([])
    setCurrentMessage("")
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (!file) return

    if (file.type !== "application/pdf") {
      setErrorMsg("Please upload a PDF file only.")
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg("PDF file too large. Maximum size is 20MB.")
      return
    }

    setUploadedFile(file)
    resetState()
    setBusy(true)
    try {
      const res = await invokeDatabricks(file)
      setPdfId(res.pdfId)
      setBatchPath(res.batchPath)
      setDbxRunId(res.runId)
    } catch (e: any) {
      console.error("[invoke] error:", e)
      setErrorMsg(e?.message || "Analysis failed")
      setUploadedFile(null)
    } finally {
      setBusy(false)
    }
  }

  const handleFileUploadNew = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0]
    if (fileInputRefNew.current) fileInputRefNew.current.value = ""
    if (!f) return
    setUploadedFile(f)
    resetState()
    setBusy(true)
    try {
      const res = await invokeDatabricks(f)
      setPdfId(res.pdfId)
      setBatchPath(res.batchPath)
      setDbxRunId(res.runId)
    } catch (e: any) {
      console.error("[invoke] error:", e)
      setErrorMsg(e?.message || "Analysis failed")
      setUploadedFile(null)
    } finally {
      setBusy(false)
    }
  }

  const handleBackToUpload = () => {
    setUploadedFile(null)
    resetState()
  }

  /* -------------------- Unified fetch (summary+benchmark+gap) -------------------- */
  const doFetchAll = async (id: string, batch?: string | null) => {
    setFetching(true)
    try {
      const url = `/api/databricks/fetch/${encodeURIComponent(id)}${batch ? `?batch_path=${encodeURIComponent(batch)}` : ""}`
      const r = await fetch(url, { cache: "no-store" })
      if (!r.ok) throw new Error(await r.text())
      const j = await r.json()

      const readyAll = Boolean(j?.ready?.all)
      if (readyAll) {
        setSummaryRow(j?.summary ?? null)
        setBench(j?.benchmark ?? null)
        setGapData(j?.gap ?? null)
        setAllReady(true)
      } else {
        setAllReady(false)
      }
    } catch (e) {
      console.error("[fetch] error:", e)
    } finally {
      setFetching(false)
    }
  }

  // Poll until ready.all === true
  useEffect(() => {
    if (!pdfId) return
    let cancelled = false
    let timer: NodeJS.Timeout | null = null
    const tick = async () => {
      if (cancelled) return
      await doFetchAll(pdfId, batchPath)
      if (cancelled) return
      if (!allReady) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId, batchPath, allReady])

  const retryFetch = () => { if (pdfId) doFetchAll(pdfId, batchPath) }

  /* -------------------- Summary derived (robust mapping) -------------------- */
  const s = summaryRow || {}
  const companyName = pick<string>(s, ["company_name", "Company", "company"], "")
  const sector      = pick<string>(s, ["sector"], "Real Estate")
  const country     = pick<string>(s, ["main_country", "country"], "")
  const region      = pick<string>(s, ["main_region", "region"], "")
  const framework   = pick<string | string[]>(s, ["framework"], "")
  const futureFw    = pick<string | string[]>(s, ["future_framework", "futureFramework"], "")
  const year        = pick<string | number>(s, ["year", "Year"], "")
  const employees = pick<string | number>(s, ["total_employees", "employees", "num_employees"], "")
  const revenue = pick<string | number>(s, ["total_revenue", "revenue", "annual_revenue"], "")

  const scope1      = pick<string | number>(s, ["Scope1", "scope_1", "Scope 1"], "")
  const scope2      = pick<string | number>(s, ["Scope2", "scope_2", "Scope 2"], "")
  const scope1Unit  = pick<string>(s, ["Scope1_unit", "scope_1_unit", "Scope 1 unit"], "")
  const scope2Unit  = pick<string>(s, ["Scope2_unit", "scope_2_unit", "Scope 2 unit"], "")
  const electricity = pick<string | number>(s, ["Electricity"], "")
  const electricityU= pick<string>(s, ["Electricity_unit"], "")
  const water       = pick<string | number>(s, ["Water"], "")
  const waterU      = pick<string>(s, ["Water_unit"], "")
  const sdgs        = Array.isArray(s?.un_sdg) ? s.un_sdg.filter(Boolean) : []
  const mats        = Array.isArray(s?.materiality_topics) ? s.materiality_topics.filter(Boolean) : []

  const kcards = useMemo(() => {
    return [
      { label: "Company", value: companyName },
      { label: "Sector", value: sector },
      { label: "Country", value: country },
      { label: "Region", value: region },
      { label: "Year", value: year },
      { label: "Employees", value: employees },
      { label: "Revenue", value: typeof revenue === 'number' ? `$${formatNumber(revenue)}` : revenue },
      { label: "Framework", value: Array.isArray(framework) ? framework.join(", ") : framework },
      { label: "Future Framework", value: Array.isArray(futureFw) ? futureFw.join(", ") : futureFw },
    ]
  }, [companyName, sector, country, region, year, framework, futureFw])

  const summaryBullets = useMemo(() => {
    const bullets: string[] = []
    const s1 = toNumber(scope1)
    const s2 = toNumber(scope2)
    if (s1 !== null) bullets.push(`Scope 1 ${s1.toLocaleString()}${scope1Unit ? ` ${scope1Unit}` : ""}`)
    if (s2 !== null) bullets.push(`Scope 2 ${s2.toLocaleString()}${scope2Unit ? ` ${scope2Unit}` : ""}`)
    if (electricity) bullets.push(`Electricity ${electricity}${electricityU ? " " + electricityU : ""}`)
    if (water) bullets.push(`Water ${water}${waterU ? " " + waterU : ""}`)
    if (sdgs.length) bullets.push(`UN SDGs ${sdgs.join(", ")}`)
    if (mats.length) bullets.push(`Material topics ${mats.join(", ")}`)
    return bullets
  }, [scope1, scope2, scope1Unit, scope2Unit, electricity, electricityU, water, waterU, sdgs, mats])

  const chartData = useMemo(() => {
    const s1 = toNumber(scope1) ?? 0
    const s2 = toNumber(scope2) ?? 0
    return [
      { label: "Scope 1", value: s1 },
      { label: "Scope 2", value: s2 },
    ]
  }, [scope1, scope2])

  /* -------------------- Benchmark derived -------------------- */
  const asFrac = (x: any): number | null => {
    if (x === null || x === undefined || x === "") return null
    const v = Number(String(x).replace("%", ""))
    if (!Number.isFinite(v)) return null
    if (v >= 0 && v <= 1) return v
    if (v > 1 && v <= 100) return v / 100
    return null
  }
  const fmtPct = (x: any): string => {
    const f = asFrac(x)
    if (f === null) return "n/a"
    return `${(f * 100).toFixed(1)}%`
  }

  const lineSeries = useMemo(() => {
    if (!bench?.company) return []
    const c = bench.company
    const sy = Number(c.sbti_start_year)
    const ty = Number(c.sbti_target_year)
    if (!Number.isFinite(sy) || !Number.isFinite(ty) || ty <= sy) return []

    const sf = (v: any): number | null => {
      if (v === null || v === undefined || v === "") return null
      const n = Number(String(v).replace(/,/g, ""))
      return Number.isFinite(n) ? n : null
    }
    const s1b = sf(c.scope_1)
    const s2b = sf(c.scope_2)
    let s12b = sf(c.sbti_scope_1_2)
    if (s12b == null && s1b != null && s2b != null) s12b = s1b + s2b
    let s1t = sf(c.sbti_scope_1_target)
    let s2t = sf(c.sbti_scope_2_target)
    let s12t = sf(c.sbti_scope_1_2_target)
    const redRaw = sf(c.sbti_scope_1_2_reduction_pct)

    if (s12t == null && redRaw != null && s12b != null) {
      const rf = redRaw > 1 ? redRaw / 100 : redRaw
      s12t = s12b * (1 - rf)
    }
    if (s12t != null && (s1t == null || s2t == null) && s1b != null && s2b != null && s1b + s2b > 0) {
      if (s1t == null) s1t = s12t * (s1b / (s1b + s2b))
      if (s2t == null) s2t = s12t * (s2b / (s1b + s2b))
    }
    if (s12t == null && s1t != null && s2t != null) s12t = s1t + s2t

    const years: number[] = []
    for (let y = sy; y <= ty; y++) years.push(y)

    const make = (name: string, v0: number | null, v1: number | null) => {
      if (v0 == null || v1 == null) return { name, points: [] as Array<{ x: number; y: number }> }
      const pts = years.map((y, i) => {
        const t = i / (years.length - 1 || 1)
        return { x: y, y: v0 + (v1 - v0) * t }
      })
      return { name, points: pts }
    }
    return [make("Scope 1", s1b, s1t), make("Scope 2", s2b, s2t), make("Scope 1+2", s12b, s12t)]
  }, [bench])

  type PeerRow = {
    Company: string
    Sector: string
    Country: string
    Region: string
    "Base Year": string
    "Target Year": string
    "% Reduction": string
    _pct_num?: number
  }
  const buildPeerDisplay = (raw: any[]): PeerRow[] => {
    if (!Array.isArray(raw)) return []
    const rows: PeerRow[] = raw.map((r: any) => ({
      Company: r.company_name ?? "",
      Sector: r.sector ?? "",
      Country: r.main_country ?? "",
      Region: r.main_region ?? "",
      "Base Year": r.sbti_start_year != null ? String(r.sbti_start_year) : "n/a",
      "Target Year": r.sbti_target_year != null ? String(r.sbti_target_year) : "n/a",
      "% Reduction": r.sbti_scope_1_2_reduction_pct != null ? String(r.sbti_scope_1_2_reduction_pct) : "",
    }))

    const pctNum = (s: string): number | null => {
      if (!s) return null
      const v = Number(String(s).replace("%", ""))
      if (!Number.isFinite(v)) return null
      if (v >= 0 && v <= 1) return v * 100
      if (v > 1 && v <= 100) return v
      return null
    }

    const withNum = rows.map((r) => ({ ...r, _pct_num: pctNum(r["% Reduction"]) ?? null }))
    const nums = withNum.map((r) => r._pct_num).filter((x): x is number => x != null)
    const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
    const sorted = [...nums].sort((a, b) => a - b)
    const median =
      sorted.length === 0
        ? null
        : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2

    const avgRow: PeerRow = {
      Company: "**Average**", Sector: "", Country: "", Region: "",
      "Base Year": "", "Target Year": "", "% Reduction": mean == null ? "" : `${mean.toFixed(1)}%`,
      _pct_num: mean == null ? undefined : mean,
    }
    const medRow: PeerRow = {
      Company: "**Median**", Sector: "", Country: "", Region: "",
      "Base Year": "", "Target Year": "", "% Reduction": median == null ? "" : `${median.toFixed(1)}%`,
      _pct_num: median == null ? undefined : median,
    }
    const combined = [...withNum, avgRow, medRow]
    combined.sort((a, b) => (b._pct_num ?? -Infinity) - (a._pct_num ?? -Infinity))
    return combined.map((r) => ({
      ...r,
      "% Reduction": r._pct_num != null ? `${r._pct_num.toFixed(1)}%` : r["% Reduction"],
    }))
  }

  const insightText = useMemo(() => {
    if (!bench?.company) return ""
    const c = bench.company
    const companyName = c.company_name || "the company"
    const startY = Number(c.sbti_start_year)
    const targetY = Number(c.sbti_target_year)
    const companyFrac = asFrac(c.sbti_scope_1_2_reduction_pct)

    let yearsCompany: number | null = null
    if (Number.isFinite(startY) && Number.isFinite(targetY)) yearsCompany = targetY - startY + 1

    const peersCountry = buildPeerDisplay(bench?.peers_country || [])
    const peersRegion = buildPeerDisplay(bench?.peers_region || [])
    const medianOf = (rows: PeerRow[]): number | null => {
      const vals = rows.filter((r) => !r.Company.startsWith("**")).map((r) => Number(r["% Reduction"].replace("%", ""))).filter((n) => Number.isFinite(n))
      if (!vals.length) return null
      vals.sort((a, b) => a - b)
      const n = vals.length
      return n % 2 ? vals[(n - 1) / 2] / 100 : ((vals[n / 2 - 1] + vals[n / 2]) / 2) / 100
    }
    const pcMedian = medianOf(peersCountry)
    const prMedian = medianOf(peersRegion)

    const ambition = (() => {
      const eps = 0.01
      if (companyFrac === null) return "unclear relative to peers (missing company target)"
      const aboveCountry = pcMedian !== null && companyFrac >= pcMedian + eps
      const aboveRegion = prMedian !== null && companyFrac >= prMedian + eps
      const belowCountry = pcMedian !== null && companyFrac <= pcMedian - eps
      const belowRegion = prMedian !== null && companyFrac <= prMedian - eps
      if (aboveCountry && aboveRegion) return "more ambitious than the median companies in both country and region"
      if (belowCountry && belowRegion) return "less ambitious than the median companies in both country and region"
      if (aboveCountry && belowRegion) return "above the country median but below the regional median"
      if (aboveRegion && belowCountry) return "above the regional median but below the country median"
      return "roughly in line with peer medians"
    })()

    return (
      `If ${companyName} sets a near-term target of its Scope 1+2 reduction by ${targetY || "n/a"}, ` +
      `it will aim for a ${fmtPct(companyFrac)} reduction from its ${startY || "n/a"} baseline, ` +
      `over ${Number.isFinite(yearsCompany ?? NaN) ? `${yearsCompany} years` : "n/a"}. Compared with the same country's median (${fmtPct(pcMedian)}) ` +
      `and same region's median (${fmtPct(prMedian)}) companies validated by SBTi, ` +
      `this target is ${ambition}.`
    )
  }, [bench])

  /* -------------------- GAP derived (defensive) -------------------- */
  const renderSeverityDistribution = (block: any) => {
    if (!block) return null
    let entries: Array<{ label: string; value: number }> = []
    if (Array.isArray(block)) {
      entries = block
        .map((x) => ({ label: String(x.label ?? x.name ?? ""), value: Number(x.value ?? x.count ?? 0) }))
        .filter((x) => x.label)
    } else if (typeof block === "object") {
      entries = Object.entries(block).map(([k, v]) => ({ label: String(k), value: Number(v as any) }))
    }
    if (!entries.length) return null
    const total = entries.reduce((a, b) => a + (Number.isFinite(b.value) ? b.value : 0), 0)
    return (
      <div className="rounded-md border bg-background p-3">
        <div className="font-medium mb-2">GRI Severity Distribution — Overall (IFRS RE Lens)</div>
        <div className="flex flex-wrap gap-3">
          {entries.map((e, i) => {
            const pct = total > 0 ? Math.round((e.value / total) * 100) : 0
            return (
              <div key={i} className="min-w-[180px]">
                <div className="text-sm mb-1">{e.label}</div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div className="h-2 bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">{e.value} ({pct}%)</div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderHeatmap = (byLevel: any) => {
    if (!byLevel) return null
    const rows: Array<{ topic: string; severity: string }> = Array.isArray(byLevel)
      ? byLevel.map((r) => ({ topic: String(r.topic ?? r.name ?? r.gri ?? ""), severity: String(r.severity ?? r.level ?? "") })).filter((r) => r.topic)
      : []
    if (!rows.length) return null
    const sevColor = (s: string) =>
      s.toLowerCase().startsWith("high") ? "bg-red-500/80"
      : s.toLowerCase().startsWith("med") ? "bg-amber-500/80"
      : s.toLowerCase().startsWith("low") ? "bg-emerald-500/80"
      : "bg-muted"
    return (
      <div className="rounded-md border bg-background p-3">
        <div className="font-medium mb-2">Gap analysis by level of severity</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Topic</th>
                <th className="py-2 pr-4">Severity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-4">{r.topic}</td>
                  <td className="py-2 pr-4">
                    <span className={`inline-block text-white px-2 py-1 rounded ${sevColor(r.severity)}`}>{r.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const renderFullMapping = (mapping: any) => {
    if (!Array.isArray(mapping) || mapping.length === 0) return null
    const cols = ["Standard", "Disclosure", "Status", "Severity"]
    return (
      <div className="rounded-md border bg-background p-3">
        <div className="font-medium mb-2">Full Disclosure Mapping</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                {cols.map((h) => (<th key={h} className="py-2 pr-4">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {mapping.map((m: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-4">{m.standard ?? m.Standard ?? ""}</td>
                  <td className="py-2 pr-4">{m.disclosure ?? m.Disclosure ?? ""}</td>
                  <td className="py-2 pr-4">{m.status ?? m.Status ?? ""}</td>
                  <td className="py-2 pr-4">{m.severity ?? m.Severity ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  /* -------------------- Chat -------------------- */
  const handleFAQClick = async (q: string) => { await handleSendMessageInternal(q) }
  const handleSendMessage = async () => {
    if (!currentMessage.trim()) return
    const msg = currentMessage
    setCurrentMessage("")
    await handleSendMessageInternal(msg)
  }
  const handleSendMessageInternal = async (msg: string) => {
  setChatMessages((prev) => [...prev, { role: "user", content: msg }])
  setIsTyping(true)
  
  // Add placeholder for assistant message
  const assistantIndex = chatMessages.length + 1
  setChatMessages((prev) => [...prev, { role: "ai", content: "" }])
  
  try {
    const r = await fetch("/api/databricks/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: "You are an ESG analysis assistant. Keep answers concise, use the provided context only.",
          },
          { role: "user", content: msg },
        ],
        summary: summaryRow,
        benchmark: bench,
        gap: gapData,
      }),
    })

    let content = "I'll analyze that and get back to you."
    if (r.ok) {
      const j = await r.json()
      content = j?.content || content
    }

    // Typewriter effect
    const words = content.split(" ")
    let currentText = ""
    
    for (let i = 0; i < words.length; i++) {
      currentText += (i > 0 ? " " : "") + words[i]
      
      setChatMessages((prev) => {
        const updated = [...prev]
        updated[assistantIndex] = { role: "ai", content: currentText }
        return updated
      })
      
      // Adjust speed: 30ms = fast, 60ms = medium, 100ms = slow
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    
  } catch (err) {
    setChatMessages((prev) => {
      const updated = [...prev]
      updated[assistantIndex] = {
        role: "ai",
        content: "Sorry, I couldn't reach the analysis service just now.",
      }
      return updated
    })
  } finally {
    setIsTyping(false)
  }
}


  /* ========================= Render ========================= */
  return (
    <div className="min-h-screen bg-background">
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 relative">
          <span className="block sm:inline">{errorMsg}</span>
          <button className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setErrorMsg(null)}>×</button>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {uploadedFile && (
                <Button variant="ghost" size="sm" onClick={handleBackToUpload} className="mr-2">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              )}
              {/* 20% larger logo */}
              <img src="/ESGsmart.png" alt="ESGsmart" className="h-20 md:h-[86px] w-auto" />
            </div>

            {uploadedFile && (
              <div className="ml-auto flex items-center gap-3 text-sm">
                <FileText className="w-4 h-4 text-muted-foreground" />
                {busy ? (
                  <div className="w-44"><IndeterminateBar height={6} /></div>
                ) : dbxRunId ? (
                  <span className="text-muted-foreground">Triggered job {dbxRunId}</span>
                ) : (
                  <span className="text-muted-foreground">Analyzing: {uploadedFile.name}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main body */}
      <div className="mx-auto max-w-[92%] px-6 py-8">
        {!uploadedFile ? (
          <div className="flex items-center justify-center min-h-[70vh]">
            <Card className="w-full max-w-2xl">
              <CardHeader className="text-center pb-8">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Upload className="w-10 h-10 text-primary" />
                </div>
                <CardTitle className="text-3xl font-bold mb-4">Upload ESG Document</CardTitle>
                <CardDescription className="text-lg">
                  Upload your PDF for ESG summary, benchmarking, and gap analysis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border-2 border-dashed border-border rounded-xl p-12 text-center hover:border-primary/50 transition-all duration-300 hover:bg-accent/5">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="pdf-upload"
                    disabled={busy}
                  />
                  <Label htmlFor="pdf-upload" className="cursor-pointer block">
                    <div className="flex flex-col items-center gap-6">
                      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                        <FileText className="w-8 h-8 text-primary" />
                      </div>
                      <div className="flex flex-col items-center">
                        <p className="text-xl font-semibold text-foreground mb-2">
                          {busy ? "Processing..." : "Click to upload PDF"}
                        </p>
                        <p className="text-muted-foreground">or drag and drop your ESG document here</p>
                      </div>
                    </div>
                  </Label>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Left Nav — 2/12 */}
            <div className="col-span-12 md:col-span-2 lg:col-span-2">
              <Card className="h-[680px]">
                <CardContent className="p-0 h-full">
                  <div className="flex flex-col gap-2 p-4">
                    <button
                      onClick={() => setActiveTab("summary")}
                      className={`flex items-center gap-3 p-4 text-left transition-all hover:bg-accent/50 border-r-4 rounded-lg ${
                        activeTab === "summary" ? "bg-[#007A72] text-white border-[#007A72]" : "border-transparent"
                      }`}
                    >
                      <FileText className="w-5 h-5" />
                      <div>
                        <div className="font-semibold">Summary</div>
                        <div className={`text-sm ${activeTab === "summary" ? "text-green-100" : "text-muted-foreground"}`}>Executive overview</div>
                      </div>
                    </button>
                    <button
                      onClick={() => setActiveTab("benchmarking")}
                      className={`flex items-center gap-3 p-4 text-left transition-all hover:bg-accent/50 border-r-4 rounded-lg ${
                        activeTab === "benchmarking" ? "bg-[#007A72] text-white border-[#007A72]" : "border-transparent"
                      }`}
                    >
                      <BarChart3 className="w-5 h-5" />
                      <div>
                        <div className="font-semibold">Benchmarking Analysis</div>
                        <div className={`text-sm ${activeTab === "benchmarking" ? "text-green-100" : "text-muted-foreground"}`}>Industry comparison</div>
                      </div>
                    </button>
                    <button
                      onClick={() => setActiveTab("gap")}
                      className={`flex items-center gap-3 p-4 text-left transition-all hover:bg-accent/50 border-r-4 rounded-lg ${
                        activeTab === "gap" ? "bg-[#007A72] text-white border-[#007A72]" : "border-transparent"
                      }`}
                    >
                      <Target className="w-5 h-5" />
                      <div>
                        <div className="font-semibold">Gap Analysis</div>
                        <div className={`text-sm ${activeTab === "gap" ? "text-green-100" : "text-muted-foreground"}`}>Improvement areas</div>
                      </div>
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Center Content — 7/12 */}
            <div className="col-span-12 md:col-span-7 lg:col-span-7">
              {activeTab === "summary" && (
                <Card className="h-[680px]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>Analysis Results</CardTitle>
                        <CardDescription>Executive summary of your ESG document</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={retryFetch} disabled={!pdfId || fetching}>
                          <RefreshCcw className="w-4 h-4 mr-2" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6 h-[600px] overflow-y-auto">
                    {!allReady && (
                      <div className="rounded-md border p-4">
                        <div className="mb-2 text-sm text-muted-foreground">Preparing your summary…</div>
                        <IndeterminateBar />
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {kcards.map((kv) => (
                        <div key={kv.label} className="rounded-md border bg-background px-3 py-2 shadow-xs text-sm">
                          <div className="text-xs text-muted-foreground mb-1">{allReady ? kv.label : ""}</div>
                          {allReady ? <div className="font-semibold">{String(kv.value || "—")}</div> : <IndeterminateBar height={10} />}
                        </div>
                      ))}
                    </div>

                    <div className="rounded-md border bg-background p-4 text-sm leading-relaxed">
                      {allReady ? (
                        summaryBullets.length ? (
                          <ul className="list-disc pl-5 space-y-1">
                            {summaryBullets.map((b, i) => (<li key={i}>{b}</li>))}
                          </ul>
                        ) : (
                          <div className="text-muted-foreground">No key highlights available.</div>
                        )
                      ) : (
                        <IndeterminateBar />
                      )}
                    </div>

                    <div className="rounded-md border p-4">
                      {allReady ? <TinyBarChart data={chartData} /> : <IndeterminateBar />}
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeTab === "benchmarking" && (
                <Card className="h-[680px]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>Benchmarking Analysis</CardTitle>
                        <CardDescription>Industry comparison</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={retryFetch} disabled={!pdfId || fetching}>
                          <RefreshCcw className="w-4 h-4 mr-2" />
                          Retry
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="h-[600px] overflow-y-auto space-y-4">
                    {!allReady && (
                      <div className="rounded-md border p-4">
                        <div className="mb-2 text-sm text-muted-foreground">Preparing your benchmarking results…</div>
                        <IndeterminateBar />
                      </div>
                    )}

                    {allReady && bench?.company && (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {[
                            { k: "Company", v: bench.company.company_name },
                            { k: "Sector", v: bench.company.sector ?? "Real Estate" },
                            { k: "Country", v: bench.company.main_country },
                            { k: "Region", v: bench.company.main_region },
                            { k: "Base Year", v: bench.company.sbti_start_year },
                            { k: "Target Year", v: bench.company.sbti_target_year },
                            { k: "% Reduction", v: ((asFrac(bench.company.sbti_scope_1_2_reduction_pct) ?? 0) * 100).toFixed(1) + "%" },
                            { k: "Target setting method", v: "Absolute Contraction Approach" },
                            { k: "Target", v: "Near-term" },
                          ].map((it) => (
                            <div key={it.k} className="rounded-md border bg-background px-3 py-2 shadow-xs text-sm">
                              <div className="text-xs text-muted-foreground mb-1">{it.k}</div>
                              <div className="font-semibold">{String(it.v ?? "—")}</div>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-md border bg-background p-4 text-sm leading-relaxed">
                          {insightText}
                        </div>

                        <div className="rounded-md border p-4 bg-card/50">
                          <MiniLineChart series={(lineSeries || []).filter((s) => s.points.length > 0)} height={260} padding={36} />
                        </div>

                        {Array.isArray(bench?.peers_country) && (
                          <div className="rounded-md border bg-background p-3">
                            <div className="font-medium mb-2">Peer Companies — Same Country</div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left border-b">
                                    {["Company", "Sector", "Country", "Region", "Base Year", "Target Year", "% Reduction"].map((h) => (
                                      <th key={h} className="py-2 pr-4">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {buildPeerDisplay(bench.peers_country).map((r, i) => (
                                    <tr key={i} className="border-b last:border-0">
                                      <td className="py-2 pr-4">{r.Company}</td>
                                      <td className="py-2 pr-4">{r.Sector}</td>
                                      <td className="py-2 pr-4">{r.Country}</td>
                                      <td className="py-2 pr-4">{r.Region}</td>
                                      <td className="py-2 pr-4">{r["Base Year"]}</td>
                                      <td className="py-2 pr-4">{r["Target Year"]}</td>
                                      <td className="py-2 pr-4">{r["% Reduction"]}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {Array.isArray(bench?.peers_region) && (
                          <div className="rounded-md border bg-background p-3">
                            <div className="font-medium mb-2">Peer Companies — Same Region</div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left border-b">
                                    {["Company", "Sector", "Country", "Region", "Base Year", "Target Year", "% Reduction"].map((h) => (
                                      <th key={h} className="py-2 pr-4">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {buildPeerDisplay(bench.peers_region).map((r, i) => (
                                    <tr key={i} className="border-b last:border-0">
                                      <td className="py-2 pr-4">{r.Company}</td>
                                      <td className="py-2 pr-4">{r.Sector}</td>
                                      <td className="py-2 pr-4">{r.Country}</td>
                                      <td className="py-2 pr-4">{r.Region}</td>
                                      <td className="py-2 pr-4">{r["Base Year"]}</td>
                                      <td className="py-2 pr-4">{r["Target Year"]}</td>
                                      <td className="py-2 pr-4">{r["% Reduction"]}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeTab === "gap" && (
  <Card className="h-[680px]">
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>Gap Analysis</CardTitle>
          <CardDescription>Disclosure framework compliance</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={retryFetch} disabled={!pdfId || fetching}>
            <RefreshCcw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent className="h-[600px] overflow-y-auto space-y-4">
      {!allReady ? (
        <div className="rounded-md border p-4">
          <div className="mb-2 text-sm text-muted-foreground">Preparing your gap analysis</div>
          <IndeterminateBar />
        </div>
      ) : Array.isArray(gapData) && gapData.length > 0 ? (
        (() => {
          // Calculate statistics from flat array
          const totalRecords = gapData.length
          const severityCounts = { "0": 0, "1": 0, "2": 0, "3": 0 }
          gapData.forEach((r: any) => {
            const sev = String(r.severity ?? "")
            if (sev in severityCounts) severityCounts[sev as keyof typeof severityCounts]++
          })
          
          const missing = severityCounts["3"]
          const matched = severityCounts["0"]
          const GRI_NAMES: Record<string, string> = {
            "201": "Economic Performance",
  "202": "Market Presence",
  "203": "Indirect Economic Impacts",
  "204": "Procurement Practices",
  "205": "Anti-corruption",
  "206": "Anti-competitive Behavior",
  "2": "General Disclosures",
  "3": "Material Topics",
  "301": "Materials",
  "302": "Energy",
  "303": "Water and Effluents",
  "304": "Biodiversity",
  "305": "Emissions",
  "306": "Waste",
  "308": "Supplier Environmental Assessment",
  "401": "Employment",
  "402": "Labor/Management Relations",
  "403": "Occupational Health and Safety",
  "404": "Training and Education",
  "405": "Diversity and Equal Opportunity",
  "406": "Non-discrimination",
  "407": "Freedom of Association",
  "408": "Child Labor",
  "409": "Forced or Compulsory Labor",
  "410": "Security Practices",
  "411": "Rights of Indigenous Peoples",
  "413": "Local Communities",
  "414": "Supplier Social Assessment",
  "415": "Public Policy",
  "416": "Customer Health and Safety",
  "417": "Marketing and Labeling",
  "418": "Customer Privacy",
}
// Clean and standardize reported values
function cleanReportedValue(value: string | null | undefined): string {
  if (!value || value === "None") return "Not disclosed"
  
  const v = String(value).toLowerCase()
  
  // Check for availability patterns
  if (/financ|financial|accounts|accounting/.test(v)) return "Available in financial records"
  if (/hr|human\s*resources|personnel/.test(v)) return "Available in HR records"
  if (/governance|board|minutes|corporate/.test(v)) return "Available in governance documentation"
  if (/procure|supplier|vendor|purchasing/.test(v)) return "Available in procurement/supplier records"
  if (/ops|operation|facility|bms|ems|plant/.test(v)) return "Available in operational systems"
  if (/sustainability\s*report|esg\s*report|annual\s*report/.test(v)) return "Disclosed in sustainability report"
  if (/available|yes|disclosed|reported/.test(v)) return "Disclosed in sustainability report"
  if (/not\s*available|no|missing|none/.test(v)) return "Not disclosed"
  
  // Return original if no pattern matches
  return value
}
// Convert camelCase or snake_case to Title Case
// Convert camelCase or snake_case to Title Case
function camelToTitle(str: string | null | undefined): string {
  if (!str) return "—"
  
  // Convert snake_case to spaces first
  let cleaned = String(str).replace(/_/g, " ")
  
  // Insert space before capital letters (camelCase)
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, "$1 $2")
  
  // Capitalize first letter of each word
  cleaned = cleaned
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
  
  return cleaned
}



          // Group by GRI category
          const griGroups: Record<string, Record<number, number>> = {}
          gapData.forEach((r: any) => {
            const code = r.framework_question_code || ""
            const match = code.match(/(?:GRI[- ])?(\d+)[-:]/) || code.match(/^(\d+)/)
  const category = match ? `GRI ${match[1]}` : "Other"
            const sev = r.severity ?? 3
            
            if (!griGroups[category]) {
              griGroups[category] = { 0: 0, 1: 0, 2: 0, 3: 0 }
            }
            griGroups[category][sev] = (griGroups[category][sev] || 0) + 1
          })

          // Sort by total count (descending)
          const sortedGRI = Object.entries(griGroups)
            .map(([cat, counts]) => ({
              category: cat,
              counts,
              total: Object.values(counts).reduce((a: number, b: number) => a + b, 0),
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 15) // Top 15

          const colors = { 0: "bg-green-500", 1: "bg-yellow-500", 2: "bg-orange-500", 3: "bg-red-500" }

          return (
            <>
              {/* Overview */}
              <div className="rounded-md border bg-background p-4 text-sm leading-relaxed">
                The primary disclosure framework used in this report is <strong>GRI</strong>, and the order of
                priority is based on the sector-specific framework <strong>IFRS RE</strong> that is used for{" "}
                <strong>Real Estate</strong>.
                <br />
                <br />A total of <strong>{totalRecords} disclosure standards</strong> were assessed. Of these,{" "}
                <strong>
                  {missing} disclosures ({((missing / totalRecords) * 100).toFixed(0)}%)
                </strong>{" "}
                are classified as &quot;Missing GRI & IFRS RE standards&quot;.
                <br />
                <br />
                Only <strong>{matched} disclosures ({((matched / totalRecords) * 100).toFixed(0)}%)</strong> are
                fully aligned with both frameworks.
                <br />
                <br />
                Key areas with the most severe gaps include <strong>GRI 305: Emissions, GRI 401: Employment</strong>.
              </div>

              {/* Gap Analysis by Level of Severity - Stacked by GRI Category */}
              <div className="rounded-md border bg-background p-4">
                <div className="font-medium mb-3">Gap Analysis by Level of Severity</div>
                
                {/* Legend */}
                <div className="flex flex-wrap gap-4 mb-4 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500"></div>
                    <span>0 – GRI & IFRS RE Present</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-yellow-500"></div>
                    <span>1 – Partial (no IFRS RE)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-orange-500"></div>
                    <span>2 – Partial GRI & IFRS RE</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-500"></div>
                    <span>3 – Missing GRI & IFRS RE</span>
                  </div>
                </div>

                {/* Stacked bars by GRI category */}
                <div className="space-y-2">
                  {sortedGRI.map(({ category, counts, total }) => {
                    return (
                      <div key={category} className="flex items-center gap-3">
                        <div className="w-48 text-sm text-right">
  {category}
  {(() => {
    const num = category.replace("GRI ", "")
    return GRI_NAMES[num] ? `: ${GRI_NAMES[num]}` : ""
  })()}
</div>

                        <div className="flex-1 flex items-center">
  <div className="flex h-7 rounded overflow-hidden border" style={{ width: `${(total / Math.max(...sortedGRI.map(g => g.total))) * 100}%` }}>
    {[3, 2, 1, 0].map((sev) => {
      const count = counts[sev] || 0
      if (count === 0) return null
      const pct = (count / total) * 100
      return (
        <div
          key={sev}
          className={`${colors[sev as keyof typeof colors]} flex items-center justify-center text-white text-xs font-medium hover:opacity-90`}
          style={{ width: `${pct}%` }}
          title={`Severity ${sev}: ${count}`}
        >
          {pct > 15 ? count : ""}
        </div>
      )
    })}
  </div>
</div>

                        <div className="w-12 text-sm text-muted-foreground text-right">{total}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Overall distribution with legend */}
              <div className="rounded-md border bg-background p-4">
                <div className="font-medium mb-3">GRI Severity Distribution — Overall (IFRS RE Lens)</div>
                
                {/* Legend */}
                <div className="flex flex-wrap gap-4 mb-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500"></div>
                    <span>0 – GRI & IFRS RE Present</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-yellow-500"></div>
                    <span>1 – Partial (no IFRS RE)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-orange-500"></div>
                    <span>2 – Partial GRI & IFRS RE</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-500"></div>
                    <span>3 – Missing GRI & IFRS RE</span>
                  </div>
                </div>

                {/* Stacked bar */}
                <div className="flex gap-1 h-10 rounded overflow-hidden border">
                  {[3, 2, 1, 0].map((sev) => {
                    const count = severityCounts[sev as keyof typeof severityCounts]
                    const pct = totalRecords > 0 ? (count / totalRecords) * 100 : 0
                    const labels = { 3: "Missing", 2: "Partial GRI+IFRS", 1: "Partial", 0: "Present" }
                    if (count === 0) return null
                    return (
                      <div
                        key={sev}
                        className={`${colors[sev as keyof typeof colors]} flex items-center justify-center text-white text-sm font-medium hover:opacity-90 transition-opacity`}
                        style={{ width: `${pct}%` }}
                        title={`${labels[sev as keyof typeof labels]}: ${count} (${pct.toFixed(1)}%)`}
                      >
                        {pct > 8 ? count : ""}
                      </div>
                    )
                  })}
                </div>

                {/* Summary stats */}
                <div className="grid grid-cols-4 gap-2 mt-3 text-xs text-center">
                  {[
                    { sev: 0, label: "Present", color: "text-green-700" },
                    { sev: 1, label: "Partial", color: "text-yellow-700" },
                    { sev: 2, label: "Partial GRI+IFRS", color: "text-orange-700" },
                    { sev: 3, label: "Missing", color: "text-red-700" },
                  ].map(({ sev, label, color }) => {
                    const count = severityCounts[sev as keyof typeof severityCounts]
                    const pct = totalRecords > 0 ? ((count / totalRecords) * 100).toFixed(0) : 0
                    return (
                      <div key={sev}>
                        <div className={`font-medium ${color}`}>{count}</div>
                        <div className="text-muted-foreground">{label} ({pct}%)</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Full mapping table */}
              {/* Full mapping table with cleaning */}
{/* Full mapping table - Clean scrollable design */}
<div className="rounded-md border bg-background p-3">
  <div className="font-medium mb-2">Full Disclosure Mapping</div>
  <div className="text-xs text-muted-foreground mb-3">
    All {gapData.length} disclosures • Scroll to see all data
  </div>
  
  {/* Scrollable container */}
  <div 
    className="overflow-auto rounded-lg border" 
    style={{ maxHeight: "500px" }}
  >
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-muted/50 text-left border-b">
          <th className="py-3 px-4 font-medium whitespace-nowrap">Reported Standard</th>
          <th className="py-3 px-4 font-medium whitespace-nowrap">Reported Value</th>
          <th className="py-3 px-4 font-medium whitespace-nowrap">Main Framework Code</th>
          <th className="py-3 px-4 font-medium">Main Framework Question</th>
          <th className="py-3 px-4 font-medium whitespace-nowrap">Main Framework Status</th>
          <th className="py-3 px-4 font-medium whitespace-nowrap">Sector Framework Code</th>
          <th className="py-3 px-4 font-medium">Sector Framework Question</th>
          <th className="py-3 px-4 font-medium whitespace-nowrap">Sector Status</th>
          <th className="py-3 px-4 font-medium whitespace-nowrap">Severity</th>
        </tr>
      </thead>
      <tbody className="bg-background">
        {gapData.map((row: any, i: number) => {
          const reportedStd = camelToTitle(row.source_question_code)
          const reportedVal = cleanReportedValue(row.value)
          const mainCode = row.framework_question_code || "—"
          const mainQuestion = row.framework_question_name || "—"
          const mainStatus = row.framework_status || "—"
          const sectorCode = row.sector_question_code || "—"
          const sectorQuestion = row.sector_question_name || "—"
          const sectorStatus = row.sector_status || "—"
          const severity = row.severity ?? "—"
          
          const severityColors: Record<number, string> = {
            0: "text-green-700 bg-green-50",
            1: "text-yellow-700 bg-yellow-50",
            2: "text-orange-700 bg-orange-50",
            3: "text-red-700 bg-red-50"
          }
          const severityLabels: Record<number, string> = {
            0: "Present",
            1: "Partial",
            2: "Partial GRI+IFRS",
            3: "Missing"
          }
          
          return (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
              <td className="py-2.5 px-4  text-xs whitespace-nowrap">{reportedStd}</td>
              <td className="py-2.5 px-4 whitespace-nowrap">
                <span className={reportedVal === "Not disclosed" ? "text-muted-foreground italic" : ""}>
                  {reportedVal}
                </span>
              </td>
              <td className="py-2.5 px-4  text-xs whitespace-nowrap">{mainCode}</td>
              <td className="py-2.5 px-4 text-xs" style={{ minWidth: "300px", maxWidth: "500px" }}>
                {mainQuestion}
              </td>
              <td className="py-2.5 px-4 text-xs whitespace-nowrap">{mainStatus}</td>
              <td className="py-2.5 px-4  text-xs whitespace-nowrap">{sectorCode}</td>
              <td className="py-2.5 px-4 text-xs" style={{ minWidth: "300px", maxWidth: "500px" }}>
                {sectorQuestion}
              </td>
              <td className="py-2.5 px-4 text-xs whitespace-nowrap">{sectorStatus}</td>
              <td className="py-2.5 px-4 whitespace-nowrap">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                  severityColors[severity as keyof typeof severityColors] || ""
                }`}>
                  {severityLabels[severity as keyof typeof severityLabels] || severity}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
  
  <div className="text-xs text-muted-foreground mt-2 text-center">
    Showing all {gapData.length} disclosures with 9 columns
  </div>
</div>


            </>
          )
        })()
      ) : (
        <div className="text-sm text-muted-foreground">
          No gap findings were produced for this document.
        </div>
      )}
    </CardContent>
  </Card>
)}



            </div>

            {/* Right Chat Panel — 3/12 */}
            <div className="col-span-12 md:col-span-3 lg:col-span-3">
              <Card className="h-[680px]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1">
                    <MessageCircle className="w-4 h-4 text-primary" />
                    ESGsmart AI Assistant
                  </CardTitle>
                  <CardDescription>Chat with our AI about your ESG document</CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col h-[600px] p-4">
  {/* lock chat until analysis artifacts exist, like Streamlit */}
  {!allReady ? (
    <div className="text-sm text-muted-foreground">
      Chat will unlock after analysis completes. We're waiting for the SBTi + Gap artifacts.
    </div>
  ) : (
    <>
      {/* scrollable messages */}
      <div ref={chatScrollRef} className="flex-1 overflow-y-auto rounded-lg border bg-muted/10 p-3">
        {chatMessages.length === 0 ? (
          <div className="text-left">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle className="w-5 h-5 opacity-60" />
              <span className="font-medium">Ask me anything about your ESG document</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              I can help with analysis, insights, and recommendations.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {chatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}{isTyping && chatMessages[chatMessages.length - 1]?.content === "" && (
    <div className="flex justify-start">
      <div className="bg-background border rounded-lg px-3 py-2">
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  )}
          </div>
        )}
      </div>

      {/* input at bottom */}
      <div className="flex gap-2 mt-3">
        <Input
          placeholder="Ask about your ESG document..."
          value={currentMessage}
          onChange={(e) => setCurrentMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
        />
        <Button onClick={handleSendMessage} disabled={!currentMessage.trim()}>
          Send
        </Button>
      </div>

      {/* FAQs - Always visible below input */}
      <div className="mt-3 border-t pt-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">Quick questions:</div>
        <div className="grid grid-cols-1 gap-1.5">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => handleFAQClick(q)}
              className="inline-flex items-center whitespace-normal break-words text-xs font-medium transition-all border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground rounded-md px-2 py-1.5 w-full text-left"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </>
  )}
</CardContent>

              </Card>
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input for Upload New Document */}
      {uploadedFile && (
        <Input
          ref={fileInputRefNew}
          type="file"
          accept=".pdf"
          onChange={handleFileUploadNew}
          className="hidden"
          id="pdf-upload-new"
          disabled={busy}
        />
      )}

      
    </div>
  )
}
