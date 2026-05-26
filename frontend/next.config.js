/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
  swcMinify: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};
module.exports = nextConfig;
