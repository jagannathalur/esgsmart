# ESGsmart

AI-powered ESG document analysis for PDF sustainability reports.

Upload a report, extract structured ESG insights, run benchmarking and gap analysis, and chat with an assistant grounded in your uploaded document context.

Production URL: [https://esgsmart.vercel.app](https://esgsmart.vercel.app)

## What this app does

- Uploads ESG/sustainability PDF reports from the UI.
- Extracts PDF text and sends it to Databricks serving endpoints.
- Triggers Databricks jobs for downstream artifact generation.
- Fetches and renders:
  - executive summary
  - SBTi benchmarking outputs
  - disclosure gap analysis (GRI/IFRS RE lens)
- Provides a chat interface that uses fetched artifacts as context.

## Tech stack

- Next.js 14 (App Router, API routes)
- TypeScript + React
- Tailwind CSS + shadcn/ui
- Databricks APIs (serving endpoints, DBFS, jobs)
- Vercel hosting

## Architecture (high level)

1. User uploads PDF in `/`.
2. Frontend calls `POST /api/databricks/invoke`.
3. Server:
   - parses PDF text (`pdf-parse`)
   - calls Databricks serving endpoint
   - writes prediction batch data to DBFS
   - optionally triggers Databricks `run-now` job
4. Frontend polls `GET /api/databricks/fetch/[pdfId]` until summary + benchmark + gap are ready.
5. Chat requests go to `POST /api/databricks/chat` with current document artifacts as context.

## API routes

- `POST /api/databricks/invoke`
  - Upload pipeline entrypoint from UI.
- `GET /api/databricks/fetch/[pdfId]?batch_path=...`
  - Unified artifact fetch: summary + benchmark + gap.
- `GET /api/databricks/benchmark/[pdfId]`
  - Reads benchmark JSON artifact from DBFS.
- `GET /api/databricks/gap/[pdfId]`
  - Reads gap JSON artifact from DBFS.
- `GET /api/databricks/dbfs-read`
  - Low-level DBFS read helper endpoint.
- `GET /api/databricks/run-status?run_id=...`
  - Databricks job status check.
- `POST /api/databricks/chat`
  - Context-aware assistant response via Databricks chat endpoint.

## Environment variables

Set these in local `.env.local` and in Vercel project settings.

### Required

- `DATABRICKS_HOST`  
  Base Databricks workspace URL (e.g. `https://adb-...databricks.com`)
- `DATABRICKS_TOKEN`  
  Databricks PAT/service token

### Optional (with defaults in code)

- `DATABRICKS_ENDPOINT` (default: `esgsmart_chatbot`)
- `DATABRICKS_CHAT_ENDPOINT` (default: `databricks-claude-sonnet-4`)
- `DATABRICKS_JOB_ID` (default: `0`, which skips job trigger)
- `DATABRICKS_TARGET_TABLE` (default: `esgsmart.pdf_extraction.report_extractions`)
- `DATABRICKS_DBFS_BASE` (default: `dbfs:/tmp/pdf_extractions`)
- `DATABRICKS_BENCHMARK_DIR` (default: `dbfs:/tmp/sbti_benchmarks`)
- `DATABRICKS_GAP_DIR` (default: `dbfs:/tmp/gap_analysis`)

## Local development

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
npm run build
npm run start
```

## Deployment (Vercel)

This repo is configured for Vercel deployment from GitHub.

1. Import/connect the repository in Vercel.
2. Add environment variables in Vercel project settings.
3. Deploy production.

Current production: [https://esgsmart.vercel.app](https://esgsmart.vercel.app)

## Security notes

- Secrets are read only from environment variables (`process.env`) in server routes.
- Do not prefix secrets with `NEXT_PUBLIC_`.
- Keep `.env*` files out of git (already ignored).
- Use least-privilege Databricks tokens and rotate them regularly.

## Package manager

This project is standardized on **npm**.

- `packageManager`: `npm@10.9.2`
- Use `package-lock.json` for deterministic installs.

