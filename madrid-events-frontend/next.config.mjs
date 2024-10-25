/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['www.madrid.es', 'a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org', 'www.tea-tron.com'],
  },
  output: 'export',
  experimental: {
    appDir: false,
    forceEdgeRender: true // fuerza la renderización en cliente
  },
};

export default nextConfig;
