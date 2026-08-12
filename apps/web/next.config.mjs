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
    // Baseline security headers applied to every response. HSTS is emitted only
    // in production (it must never be sent over plain-HTTP local dev, where it
    // would wrongly pin localhost to HTTPS). A strict CSP is deferred to the
    // Phase 7 production-deploy hardening, where the asset origins are fixed.
    const isProd = process.env.NODE_ENV === 'production';
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
    ];
    if (isProd) {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' });
    }
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
