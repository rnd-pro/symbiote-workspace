import { routes } from './manifest.js';

const origin = process.env.ORIGIN || 'https://rnd-pro.github.io';
const basePath = process.env.BASE_PATH || '/';
const baseUrl = process.env.BASE_URL || (origin + (basePath.endsWith('/') ? basePath : basePath + '/'));
const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

const paths = routes.filter(r => r.inSitemap).map(r => r.path);

export default `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map(p => `  <url>
    <loc>${base}${p}</loc>
    <changefreq>weekly</changefreq>
    <priority>${p === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`;
