/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist"],
    outputFileTracingIncludes: {
      "/app/api/databricks/invoke/route": ["./lib/pdf-to-text.cjs"],
    },
  }
}

export default nextConfig
