/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg'],
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
};
export default nextConfig;
