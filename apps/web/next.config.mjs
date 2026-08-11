/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The AI gateway is a workspace TypeScript package consumed as source.
  transpilePackages: ['@biina/ai-gateway'],
  eslint: {
    // Lint is run explicitly in CI via `npm run lint`; don't fail the build twice.
    ignoreDuringBuilds: false,
  },
  async headers() {
    // Baseline security headers. Production tightening (HSTS, CSP) lands in Phase 5.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
