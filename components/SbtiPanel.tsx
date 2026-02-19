"use client"
import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts"

type Props = { bench: any }

export default function SbtiPanel({ bench }: Props) {
  const c = bench?.company || {}
  const sy = Number(c?.sbti_start_year)
  const ty = Number(c?.sbti_target_year)
  const s1b = num(c?.scope_1),
    s2b = num(c?.scope_2)
  const s1t = num(c?.sbti_scope_1_target),
    s2t = num(c?.sbti_scope_2_target)
  const s12b = s1b != null && s2b != null ? s1b + s2b : num(c?.sbti_scope_1_2)
  const red = frac(c?.sbti_scope_1_2_reduction_pct)
  const s12t = s1t ?? s2t ?? (s12b != null && red != null ? s12b * (1 - red) : null)

  const chart = buildLinearSeries(sy, ty, { s1b, s1t, s2b, s2t, s12b, s12t })

  const peersCountry = normPeers(bench?.peers_country || [])
  const peersRegion = normPeers(bench?.peers_region || [])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 text-sm text-muted-foreground">{c?.company_name || "—"}</div>
          {chart.length > 0 && (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <XAxis dataKey="year" stroke="#888888" fontSize={12} />
                  <YAxis
                    stroke="#888888"
                    fontSize={12}
                    axisLine={{ stroke: "#0a0b0cff", strokeWidth: 2 }}
                    tickLine={{ stroke: "#07080aff" }}
                    label={{
                      value: "Emissions (tCO2e)",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 12 },
                    }}
                  />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line type="monotone" dataKey="Scope 1" stroke="#ef4444" dot strokeWidth={2} />
                  <Line type="monotone" dataKey="Scope 2" stroke="#f97316" dot strokeWidth={2} />
                  <Line type="monotone" dataKey="Scope 1+2" stroke="#3b82f6" dot strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Peer Companies — Same Country</CardTitle>
        </CardHeader>
        <CardContent>
          <SimplePeerTable rows={peersCountry} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Peer Companies — Same Region</CardTitle>
        </CardHeader>
        <CardContent>
          <SimplePeerTable rows={peersRegion} />
        </CardContent>
      </Card>
    </div>
  )
}

function num(v: any): number | null {
  const n = Number(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}
function frac(x: any): number | null {
  const n = Number(String(x ?? "").replace("%", ""))
  if (!Number.isFinite(n)) return null
  return n <= 1 ? n : n / 100
}
function buildLinearSeries(sy: number, ty: number, v: any) {
  if (!Number.isFinite(sy) || !Number.isFinite(ty) || ty <= sy) return []
  const ys = []
  for (let year = sy; year <= ty; year++) {
    ys.push({
      year,
      "Scope 1": lerp(v.s1b, v.s1t, sy, ty, year),
      "Scope 2": lerp(v.s2b, v.s2t, sy, ty, year),
      "Scope 1+2": lerp(v.s12b, v.s12t, sy, ty, year),
    })
  }
  return ys
}
function lerp(a: number | null, b: number | null, sy: number, ty: number, y: number) {
  if (a == null || b == null) return null as any
  const t = (y - sy) / (ty - sy)
  return a + (b - a) * t
}
function normPeers(rows: any[]) {
  const keep = ["Company", "Sector", "Country", "Region", "Base Year", "Target Year", "% Reduction"]
  const mapped = rows.map((r) => ({
    Company: r.company_name ?? "",
    Sector: r.sector ?? "",
    Country: r.main_country ?? "",
    Region: r.main_region ?? "",
    "Base Year": toYear(r.sbti_start_year),
    "Target Year": toYear(r.sbti_target_year),
    "% Reduction": pctDisp(r.sbti_scope_1_2_reduction_pct),
  }))
  const pctNums = mapped
    .map((x) => toPctNum(x["% Reduction"]))
    .filter((x) => x != null) as number[]
  const avg = pctNums.length ? pctNums.reduce((a, b) => a + b, 0) / pctNums.length : null
  const median = pctNums.length
    ? [...pctNums].sort((a, b) => a - b)[Math.floor(pctNums.length / 2)]
    : null
  const blank = {
    Company: "**Average**",
    Sector: "",
    Country: "",
    Region: "",
    "Base Year": "",
    "Target Year": "",
    "% Reduction": disp(avg),
  }
  const blank2 = {
    Company: "**Median**",
    Sector: "",
    Country: "",
    Region: "",
    "Base Year": "",
    "Target Year": "",
    "% Reduction": disp(median),
  }
  return [...mapped, blank, blank2].map((row) =>
    keep.reduce((o, k) => ((o[k] = row[k] ?? ""), o), {} as any)
  )
}
function toYear(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? String(n | 0) : "n/a"
}
function pctDisp(x: any) {
  const n = Number(String(x ?? "").replace("%", ""))
  if (!Number.isFinite(n)) return ""
  return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`
}
function toPctNum(s: string) {
  const n = Number(String(s ?? "").replace("%", ""))
  return Number.isFinite(n) ? n : null
}
function disp(n: number | null) {
  if (n == null) return ""
  return `${n.toFixed(1)}%`
}

function SimplePeerTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {["Company", "Sector", "Country", "Region", "Base Year", "Target Year", "% Reduction"].map(
              (h) => (
                <th key={h} className="text-left px-3 py-2 border-b">
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-gray-50">
              {["Company", "Sector", "Country", "Region", "Base Year", "Target Year", "% Reduction"].map(
                (k) => (
                  <td key={k} className="px-3 py-2 border-b">
                    {r[k]}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
