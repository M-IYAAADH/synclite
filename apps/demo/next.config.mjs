/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace packages so Next.js can handle their TypeScript/ESM source
  transpilePackages: ['@nexsync/core', '@nexsync/react'],
}

export default nextConfig
