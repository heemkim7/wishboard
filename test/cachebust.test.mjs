import assert from 'node:assert/strict';
import { it } from 'node:test';
import { browserFiles, currentBuild, importsOf, stamp, workerModules } from '../tools/stamp.mjs';

// The browser and the Worker bundler both treat `x.js` and `x.js?v=1` as two different modules.
// A module loaded under two URLs runs twice and keeps two copies of its state.

it('loads every local module under exactly one URL', () => {
  const urls = new Map();
  for (const file of browserFiles()) {
    for (const { target, query } of importsOf(file)) {
      if (!urls.has(target)) urls.set(target, new Map());
      const by = urls.get(target);
      if (!by.has(query)) by.set(query, []);
      by.get(query).push(file);
    }
  }
  const split = [...urls].filter(([, by]) => by.size > 1).map(([target, by]) => target + ' <- ' + [...by].map(([q, who]) => (q || '(none)') + ' in ' + who.join('/')).join(' | '));
  assert.deepEqual(split, []);
});

it('uses one build id, and the same one index.html loads main.js with', () => {
  const build = currentBuild();
  assert.match(build, /^[0-9a-z]{6,20}$/);
  const others = new Set();
  for (const file of browserFiles()) for (const { query } of importsOf(file)) if (query && query !== '?v=' + build) others.add(file + ' ' + query);
  assert.deepEqual([...others], []);
});

it('imports the modules the Worker bundles without a query', () => {
  const shared = workerModules();
  assert.ok(shared.has('balance.js'));
  const wrong = [];
  for (const file of browserFiles().concat('worker.js')) {
    for (const { target, query } of importsOf(file)) {
      if (query && (file === 'worker.js' || shared.has(file) || shared.has(target))) wrong.push(file + ' -> ' + target + query);
    }
  }
  assert.deepEqual(wrong, []);
});

it('has nothing left for tools/stamp.mjs to rewrite', () => {
  assert.deepEqual(stamp(currentBuild(), { write: false }).changed, []);
});
