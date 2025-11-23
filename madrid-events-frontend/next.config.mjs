/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['www.madrid.es', 'a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org', 'www.tea-tron.com'],
    unoptimized: true,
  },
  output: 'standalone',
};

export default nextConfig;
