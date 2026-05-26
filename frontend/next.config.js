/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
  // Skip typecheck/lint during `next build` — reduces peak RAM on Railway.
  // Run `npx tsc --noEmit` and `npm run lint` separately in CI if needed.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
    // No custom webpack config — keeps webpackBuildWorker enabled (lower main-process RAM).
    webpackBuildWorker: true,
    serverSourceMaps: false,
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@tiptap/react',
      '@tiptap/starter-kit',
      'react-markdown',
    ],
  },
};
module.exports = nextConfig;
