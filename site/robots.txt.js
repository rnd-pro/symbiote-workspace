const origin = process.env.ORIGIN || 'https://rnd-pro.github.io';
const basePath = process.env.BASE_PATH || '/';
const baseUrl = process.env.BASE_URL || (origin + (basePath.endsWith('/') ? basePath : basePath + '/'));

export default `User-agent: *
Allow: /

Sitemap: ${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/sitemap.xml
`;
