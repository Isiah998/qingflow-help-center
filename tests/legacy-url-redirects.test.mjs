import assert from 'node:assert/strict';
import test from 'node:test';
import {buildLegacyRoutePlan} from '../plugins/legacy-url-redirects.mjs';

test('legacy route plan flattens old URL chains to the canonical Outline urlId', () => {
  const plan = buildLegacyRoutePlan(
    [{from: '/中文旧地址', to: '/product-guides/form'}],
    {
      version: 2,
      legacyRoutes: [
        {
          from: '/product-guides/form',
          status: 'active',
          outlineUrlId: 'Stable123',
        },
      ],
    },
  );

  assert.equal(plan.length, 2);
  assert.deepEqual(
    plan.map((entry) => [entry.from, entry.to]).sort(([left], [right]) => left.localeCompare(right)),
    [
      ['/product-guides/form', '/outline/stable123'],
      ['/中文旧地址', '/outline/stable123'],
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
});

test('legacy route plan preserves deleted records and rejects cycles', () => {
  const deleted = buildLegacyRoutePlan([], {
    version: 2,
    legacyRoutes: [{
      from: '/retired',
      status: 'deleted',
      removedAt: '2026-09-15T00:00:00.000Z',
    }],
  });
  assert.deepEqual(deleted, [{
    from: '/retired',
    status: 'deleted',
    removedAt: '2026-09-15T00:00:00.000Z',
  }]);

  assert.throws(() => buildLegacyRoutePlan(
    [{from: '/one', to: '/two'}],
    {
      version: 2,
      legacyRoutes: [{from: '/two', status: 'redirect', to: '/one'}],
    },
  ), /cycle/i);
});
