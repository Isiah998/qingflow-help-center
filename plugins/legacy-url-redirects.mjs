import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const redirectsFile = path.join(process.cwd(), 'data', 'legacy-url-redirects.json');
const outlineRoutesFile = path.join(process.cwd(), 'data', 'outline-route-map.json');

function withBaseUrl(baseUrl, route) {
  if (baseUrl === '/') return route;
  return `${baseUrl.replace(/\/$/, '')}${route}`;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function canonicalOutlineRoute(urlId) {
  const normalized = String(urlId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error('Active legacy route has no usable Outline urlId.');
  return `/outline/${normalized}`;
}

export function buildLegacyRoutePlan(redirects, outlineRouteMap) {
  if (outlineRouteMap?.version !== 2 || !Array.isArray(outlineRouteMap.legacyRoutes)) {
    throw new Error('Outline route map must use version 2.');
  }

  const routes = new Map();
  const add = (from, record) => {
    const existing = routes.get(from);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new Error(`Conflicting legacy route: ${from}`);
    }
    routes.set(from, record);
  };

  for (const entry of outlineRouteMap.legacyRoutes) {
    if (entry.status === 'active') {
      add(entry.from, {status: 'redirect', to: canonicalOutlineRoute(entry.outlineUrlId)});
    } else if (entry.status === 'redirect') {
      add(entry.from, {status: 'redirect', to: entry.to});
    } else if (entry.status === 'deleted') {
      add(entry.from, {status: 'deleted', removedAt: entry.removedAt});
    } else {
      throw new Error(`Unsupported legacy route status: ${entry.status}`);
    }
  }
  for (const entry of redirects) add(entry.from, {status: 'redirect', to: entry.to});

  const resolve = (from) => {
    const visited = new Set([from]);
    let record = routes.get(from);
    while (record?.status === 'redirect' && routes.has(record.to)) {
      if (visited.has(record.to)) throw new Error(`Legacy redirect cycle detected at ${record.to}`);
      visited.add(record.to);
      record = routes.get(record.to);
    }
    return record;
  };

  return [...routes.keys()]
    .map((from) => ({from, ...resolve(from)}))
    .sort((left, right) => left.from.localeCompare(right.from, 'zh-CN'));
}

function renderRedirect({target, canonicalUrl}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex,follow">
  <meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <title>页面已迁移 | 轻流帮助中心</title>
</head>
<body>
  <p>页面已迁移，正在跳转到<a href="${escapeHtml(target)}">新地址</a>。</p>
  <script>location.replace(new URL(${JSON.stringify(target)} + location.search + location.hash, location.origin).href);</script>
</body>
</html>
`;
}

function renderDeleted(removedAt) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex,nofollow">
  <title>页面已下线 | 轻流帮助中心</title>
</head>
<body>
  <main><h1>页面已下线</h1><p>该帮助文档已于 ${escapeHtml(removedAt.slice(0, 10))} 下线。</p></main>
</body>
</html>
`;
}

export default function legacyUrlRedirectsPlugin(context, options = {}) {
  const {baseUrl, url} = context.siteConfig;
  const includeOutlineRoutes = options.includeOutlineRoutes !== false;

  return {
    name: 'qingflow-legacy-url-redirects',
    async postBuild({outDir, routesPaths}) {
      const redirects = await readFile(redirectsFile, 'utf8').then(JSON.parse);
      const plan = includeOutlineRoutes
        ? buildLegacyRoutePlan(
            redirects,
            await readFile(outlineRoutesFile, 'utf8').then(JSON.parse),
          )
        : redirects.map((entry) => ({...entry, status: 'redirect'}));
      const currentRoutes = new Set(routesPaths.map((route) => route.replace(/\/$/, '')));

      await Promise.all(plan.map(async (entry) => {
        const oldRoute = `/docs${entry.from}`;
        if (currentRoutes.has(oldRoute.replace(/\/$/, ''))) {
          throw new Error(`Legacy redirect conflicts with a current route: ${oldRoute}`);
        }
        const outputPath = path.join(outDir, ...oldRoute.split('/').filter(Boolean), 'index.html');
        let html;
        if (entry.status === 'deleted') {
          html = renderDeleted(entry.removedAt);
        } else {
          const newRoute = `/docs${entry.to}/`.replace(/\/{2,}/g, '/');
          if (!currentRoutes.has(newRoute.replace(/\/$/, ''))) {
            throw new Error(`Legacy redirect target is not a generated route: ${newRoute}`);
          }
          const target = withBaseUrl(baseUrl, newRoute);
          html = renderRedirect({
            target,
            canonicalUrl: `${url.replace(/\/$/, '')}${target}`,
          });
        }
        await mkdir(path.dirname(outputPath), {recursive: true});
        await writeFile(outputPath, html);
      }));

      const deleted = plan.filter((entry) => entry.status === 'deleted').length;
      console.log(`Generated ${plan.length - deleted} legacy redirects and ${deleted} retired pages`);
    },
  };
}
