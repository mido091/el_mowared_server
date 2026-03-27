import pool from '../config/db.js';
import MetricsCacheService from './MetricsCacheService.js';
import { env } from '../config/env.js';

class SeoService {
  _baseUrl() {
    return env.frontendOrigins[0]?.replace(/\/$/, '') || 'http://localhost:5173';
  }

  async getRobotsTxt() {
    return `User-agent: *\nAllow: /\nSitemap: ${this._baseUrl()}/sitemap.xml\n`;
  }

  async getSitemapXml() {
    return MetricsCacheService.withCache('seo:sitemap', async () => {
      const baseUrl = this._baseUrl();
      const [products] = await pool.query(`
        SELECT id, slug, updated_at, created_at
        FROM products
        WHERE deleted_at IS NULL
          AND COALESCE(lifecycle_status, status) = 'APPROVED'
      `);
      const [vendors] = await pool.query(`
        SELECT id, updated_at, created_at
        FROM vendor_profiles
        WHERE deleted_at IS NULL
      `);

      const staticUrls = [
        '/',
        '/about-us',
        '/contact-us',
        '/products',
        '/rfq'
      ];

      const urls = [
        ...staticUrls.map((path) => ({
          loc: `${baseUrl}${path}`,
          lastmod: new Date().toISOString()
        })),
        ...products.map((product) => ({
          loc: `${baseUrl}/products/${product.slug ? `${product.slug}-${product.id}` : product.id}`,
          lastmod: new Date(product.updated_at || product.created_at || Date.now()).toISOString()
        })),
        ...vendors.map((vendor) => ({
          loc: `${baseUrl}/vendor/${vendor.id}`,
          lastmod: new Date(vendor.updated_at || vendor.created_at || Date.now()).toISOString()
        }))
      ];

      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((url) => `  <url><loc>${url.loc}</loc><lastmod>${url.lastmod}</lastmod></url>`)
        .join('\n')}\n</urlset>`;

      return xml;
    }, 10 * 60 * 1000);
  }
}

export default new SeoService();
