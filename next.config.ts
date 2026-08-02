import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import { buildContentSecurityPolicy } from "./src/lib/security/security-headers";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  output: "standalone",
  // Gzip/Brotli réponses (Phase 11)
  compress: true,
  // Tree-shake packages lourds (lucide, radix)
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "@tanstack/react-query",
      "radix-ui",
    ],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96],
  },
  serverExternalPackages: ["pino", "pino-pretty", "bcryptjs", "ioredis", "bullmq"],
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const cspEnabled = process.env.CSP_ENABLED !== "false";
    const cspReportOnly = process.env.CSP_REPORT_ONLY === "true";
    const csp = buildContentSecurityPolicy(isProd);

    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-XSS-Protection", value: "1; mode=block" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
    ];

    if (cspEnabled) {
      securityHeaders.push({
        key: cspReportOnly
          ? "Content-Security-Policy-Report-Only"
          : "Content-Security-Policy",
        value: csp,
      });
    }

    if (isProd) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/api/health/live",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=5, stale-while-revalidate=15",
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
