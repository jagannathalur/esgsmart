import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

export const metadata: Metadata = {
  title: "ESGsmart",
  description: "Powered by ESGpedia",
  generator: "ESG SMART",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/cropped-ESGpedia-favicon-2024-final-32x32.png" />
      </head>
      <body
        className={`min-h-screen flex flex-col bg-white text-gray-900 antialiased ${GeistSans.variable} ${GeistMono.variable}`}
      >
        <main className="flex-1">{children}</main>

        <footer className="mt-auto w-full border-t border-gray-200">
          <div className="mx-auto max-w-7xl px-4 py-6">
            <div className="flex items-center justify-end">
              <span className="text-xs md:text-sm text-black-500">Powered by</span>
              <img
                src="/esgpedia-logo.svg"
                alt="ESGpedia"
                className="ml-2 h-4 md:h-5 lg:h-6 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
            </div>
          </div>
        </footer>

        <Analytics />
      </body>
    </html>
  )
}
