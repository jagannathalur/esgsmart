import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function need(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

// Shorten text to fit within token limits
function shortenText(text: string, maxChars: number = 6000): string {
  if (!text || text.length <= maxChars) return text
  const head = text.slice(0, Math.floor(maxChars * 0.6))
  const tail = text.slice(-Math.floor(maxChars * 0.2))
  const omitted = text.length - head.length - tail.length
  return `${head}\n\n... [${omitted} chars omitted] ...\n\n${tail}`
}

// Build context from summary, benchmark, and gap data
function buildContextFromData(summary: any, benchmark: any, gap: any[]): string {
  const company = summary?.company_name || summary?.json_schema?.company_name || "Unknown"
  const year = summary?.reporting_year || summary?.json_schema?.reporting_year || "N/A"
  const sector = summary?.sector || summary?.json_schema?.sector || "Real Estate"
  const country = summary?.main_country || summary?.json_schema?.main_country || "N/A"
  const region = summary?.main_region || summary?.json_schema?.main_region || "N/A"
  
  const scope1 = summary?.scope_1_emissions || summary?.json_schema?.scope_1_emissions || "N/A"
  const scope2 = summary?.scope_2_emissions || summary?.json_schema?.scope_2_emissions || "N/A"
  const scope3 = summary?.scope_3_emissions || summary?.json_schema?.scope_3_emissions || "N/A"

  // Extract full PDF text if available
  const pdfText = summary?.pdf_doc || summary?.extracted_text || ""
  const textSnippet = shortenText(pdfText, 6000)

  // SBTi data
  const sbtiCompany = benchmark?.company || {}
  const sbtiYear = sbtiCompany?.sbti_target_year || "N/A"
  const sbtiReduction = sbtiCompany?.sbti_scope_1_2_reduction_pct || "N/A"
  const sbtiBase = sbtiCompany?.sbti_scope_1_2 || "N/A"
  const sbtiTarget = sbtiCompany?.sbti_scope_1_2_target || "N/A"

  const peersCountry = benchmark?.peers_country || []
  const peersRegion = benchmark?.peers_region || []

  // Gap data
  const topGaps = (gap || []).slice(0, 10).map((g: any) => {
    const sev = g.severity ?? "?"
    const code = g.framework_question_code || g.source_question_code || "Code"
    const title = g.framework_question_name || ""
    return `  - ${sev} | ${code} | ${title.slice(0, 100)}`
  }).join("\n")

  const missingCount = (gap || []).filter((g: any) => g.severity === 3).length
  const totalGaps = (gap || []).length

  return `
DOCUMENT SCOPE
Company: ${company}
Year: ${year}
Sector: ${sector}
Country/Region: ${country}/${region}

KEY NUMBERS
Scope 1: ${scope1}
Scope 2: ${scope2}
Scope 3: ${scope3}

SBTi SNAPSHOT
Target year: ${sbtiYear}
S1+S2 base: ${sbtiBase}
S1+S2 target: ${sbtiTarget}
Reduction: ${sbtiReduction}

PEERS SNAPSHOT
Country peers: ${peersCountry.length} companies
Regional peers: ${peersRegion.length} companies

TOP GAPS (SEVERITY DESC, MAX 10)
${topGaps || "No gaps data available"}

MISSING DISCLOSURES
Total gaps: ${totalGaps}
Severity 3 (Missing): ${missingCount}

EXTRACTED REPORT TEXT SNIPPET
${textSnippet}

ANSWERING INSTRUCTIONS
- You are an ESG reporting assistant for a Singapore real estate corporation.
- Answer using the above context.
- When the user asks about missing disclosures or internal data, refer to the gaps list above.
- Use standard phrasing: "Available in financial records", "Available in HR records", "Available in operational systems", "Disclosed in sustainability report", or "Not disclosed".
- If information is not in the context, say so honestly.
`.trim()
}

// Singapore regulatory facts
const REGULATORY_FACTS = `
SINGAPORE REGULATORY FACTS

Summary:
- SGX Listing Rules 711A and 711B require every listed issuer to publish an annual sustainability report on a "comply or explain" basis (within 4-5 months after FY end).
- GRI is NOT mandated by SGX. Issuers may report with reference to frameworks like GRI or TCFD voluntarily.
- The SGX Sustainability Reporting Guide provides structure but does not require GRI compliance.
- From FY2025, all SGX-listed issuers must provide climate-related disclosures aligned with IFRS S2 (ISSB), including Scope 1 and 2 GHG emissions (Scope 3 is phased).

Citations:
- SGX Rulebook 711A: https://rulebook.sgx.com/rulebook/711a
- SGX Rulebook 711B: https://rulebook.sgx.com/rulebook/711b
- SGX Sustainability Reporting: https://www.sgx.com/sustainable-finance/sustainability-reporting
- IFRS S2 Climate Reporting: https://www.sgxgroup.com/media-centre/20250825-extended-timelines-most-climate-reporting-requirements-support
`.trim()

const DATA_SOURCES_INFO = `
ESGsmart Primary Data Sources & Accuracy

Primary data sources:
1. SBTi target-setting methodology: https://sciencebasedtargets.org
2. SBTi validated companies: https://sciencebasedtargets.org/companies-taking-action
3. Disclosure frameworks: GRI, IFRS Sustainability (ISSB IFRS S2), IFRS Real Estate, CDP, DJSI
4. Internal standards-to-Essentials mapping (proprietary)

Accuracy controls:
- Use only authoritative sources (official SBTi, standard-setter sites)
- Automated ETL + human QA, schema checks, unit/number normalization
- Databricks-hosted versioned Delta tables with source URIs/IDs
- Entity resolution & normalization rules for companies and codes

LLMs used:
- Meta LLaMA 3-Instruct (70B/8B) for sustainability report extraction
- Claude Sonnet 4 (via Anthropic) for conversational explanations and ESG reasoning
- All models securely deployed via MLflow on Databricks
- No client PDFs sent to public APIs - all inference happens within Databricks environment
`.trim()

export async function POST(req: NextRequest) {
  try {
    const host = need("DATABRICKS_HOST")
    const token = need("DATABRICKS_TOKEN")

    const body = await req.json()
    const { pdfId, messages, temperature, max_tokens, summary, benchmark, gap } = body

    // Build context if data is provided
    let contextMessages: any[] = []
    
    // System prompt
    contextMessages.push({
      role: "system",
      content: `You are a helpful ESG reporting assistant supporting a Singapore-based sustainability reporting company. Your job is to answer questions clearly, naturally, and accurately - just like a well-informed analyst.

You'll be provided with:
- A structured context block based on the uploaded sustainability report
- Optional Singapore regulatory facts (SGX, IFRS S2)
- Background information about ESGsmart's data sources and verification process
- Background information about ESGsmart's LLMs

If the user asks about ESGsmart's data sources or how the data is verified, explain in your own words - avoid copying or listing them mechanically. Guide the user with examples and relevant links when helpful.

If the user asks about SGX requirements, GRI mandates, or IFRS/ISSB rules, refer to the regulatory context. Be careful to distinguish between what's actually reported vs. what is required.

If the data is not in the provided context, say so honestly - don't guess or make assumptions.

Always prioritize clarity, accuracy, and helpfulness.

When providing answers about missing disclosures or internal data sources, use consistent phrasing:
- "Available in financial records"
- "Available in HR records"
- "Available in governance documentation"
- "Disclosed in sustainability report"
- "Not disclosed"

Avoid variations like "should be in...", "may be in...", or "likely found in...".`
    })

    // Add document context if available
    if (summary || benchmark || gap) {
      const docContext = buildContextFromData(summary, benchmark, gap)
      contextMessages.push({
        role: "system",
        content: docContext
      })
    }

    // Add data sources context
    contextMessages.push({
      role: "system",
      content: `The following information describes the primary ESG data sources and accuracy controls used by ESGsmart. Use this as factual background to guide your answers when the user asks about data sources, how the data is verified, or what LLMs we use.\n\n${DATA_SOURCES_INFO}`
    })

    // Check if this is a regulatory question
    const lastUserMessage = messages[messages.length - 1]?.content?.toLowerCase() || ""
    const isRegulatoryQuestion = /sgx|711a|711b|issb|ifrs s1|ifrs s2|mandatory|comply or explain|regulation|listing rule|does singapore|is it required|mandate|law|rules/.test(lastUserMessage)

    if (isRegulatoryQuestion) {
      contextMessages.push({
        role: "system",
        content: REGULATORY_FACTS
      })
    }

    // Add user messages
    contextMessages.push(...messages)

    // Call Databricks chat endpoint
    const chatEndpoint = process.env.DATABRICKS_CHAT_ENDPOINT || "databricks-claude-sonnet-4"
    const servingPath = `/serving-endpoints/${chatEndpoint}/invocations`
    const url = `${host}${servingPath}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000) // 120s timeout

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: contextMessages,
          temperature: temperature ?? 0.1,
          max_tokens: max_tokens ?? 1200,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!r.ok) {
        const t = await r.text()
        return NextResponse.json(
          { error: `Chat endpoint error ${r.status}: ${t.slice(0, 600)}` },
          { status: 502 }
        )
      }

      const j = await r.json()

      // Handle both OpenAI-like & simple shapes
      const content =
        j?.choices?.[0]?.message?.content ??
        j?.message?.content ??
        j?.content ??
        j?.choices?.[0]?.text ??
        ""

      return NextResponse.json({ ok: true, content })
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === "AbortError") {
        return NextResponse.json({ error: "Chat request timed out" }, { status: 504 })
      }
      throw err
    }
  } catch (err: any) {
    console.error("[chat] error:", err)
    return NextResponse.json(
      { error: err?.message || "Chat failed" },
      { status: 500 }
    )
  }
}
