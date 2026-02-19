//components/GriHeatmap.tsx
"use client"

import dynamic from "next/dynamic"
import React, { useMemo } from "react"

// Load Plotly only on the client
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

type GapRow = {
  "GRI Code": string
  Title: string
  Disclosure: "Missing" | "Partial" | "Present" | string
  Priority: "High" | "Medium" | "Low" | string
  Severity: "Severe" | "Moderate" | "Low" | string
  Recommendation: string
}

const SEVERITY_SCORE: Record<string, number> = { Severe: 3, Moderate: 2, Low: 1 }

export default function GriHeatmap({ rows }: { rows: GapRow[] }) {
  // Pivot to: rows=GRI Code, columns=Priority, value=Severity Score
  const { yLabels, xLabels, zMatrix, textMatrix } = useMemo(() => {
    const ySet = new Set<string>()
    const xSet = new Set<string>()
    rows.forEach((r) => {
      if (r["GRI Code"]) ySet.add(r["GRI Code"])
      if (r.Priority) xSet.add(r.Priority)
    })

    // Streamlit shows priorities grouped High/Medium/Low — preserve that order if present
    const prioOrder = ["High", "Medium", "Low"]
    const x = [...xSet].sort((a, b) => prioOrder.indexOf(a) - prioOrder.indexOf(b))
    const y = [...ySet] // keep insertion order (as in the mock list)

    // Build lookup
    const key = (gri: string, prio: string) =>
      rows.find((r) => r["GRI Code"] === gri && r.Priority === prio)

    const z = y.map((gri) =>
      x.map((p) => {
        const hit = key(gri, p)
        const score = hit ? SEVERITY_SCORE[hit.Severity] ?? 0 : 0
        return score
      })
    )

    const text = y.map((gri) => x.map((p) => {
      const hit = key(gri, p)
      const score = hit ? (SEVERITY_SCORE[hit.Severity] ?? 0) : 0
      return String(score || "")
    }))

    return { yLabels: y, xLabels: x, zMatrix: z, textMatrix: text }
  }, [rows])

  return (
    <div className="w-full">
      <Plot
        data={[
          {
            type: "heatmap",
            x: xLabels,
            y: yLabels,
            z: zMatrix,
            colorscale: "Reds",
            showscale: true,
            // overlay numbers like Streamlit text_auto=True
            text: textMatrix,
            texttemplate: "%{text}",
            textfont: { size: 12 },
            hovertemplate: "Priority: %{x}<br>GRI: %{y}<br>Severity score: %{z}<extra></extra>",
          } as any,
        ]}
        layout={{
          autosize: true,
          height: 400,
          margin: { l: 50, r: 20, t: 30, b: 40 },
          xaxis: { title: "Sector Priority", tickfont: { size: 12 } },
          yaxis: { title: "GRI Code", tickfont: { size: 12 }, automargin: true },
          font: { family: "inherit" },
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
      />
    </div>
  )
}
