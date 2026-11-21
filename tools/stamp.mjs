// One module, one URL.
// Browser-only modules are always imported as `./x.js?v=BUILD` with a single BUILD value.
// Modules the Worker bundles too (anything reachable from worker.js) are imported with no query everywhere,
// because the bundler and the browser both treat `x.js` and `x.js?v=1` as two different modules.
//
//   node tools/stamp.mjs            rewrite every import to today's build id
//   node tools/stamp.mjs 20261201a  rewrite to this build id
//   node tools/stamp.mjs --check    change nothing, exit 1 if something is out of line
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?\s]+\.js)(\?v=[^'"]*)?\2/g;
const HTML_SRC = /(<script\b[^>]*\bsrc=)(['"])((?:\.{1,2}\/)?[^'"?\s:]+\.js)(\?v=[^'"]*)?\2/g;

const posix = (p) => p.split(path.sep).join('/');

export function browserFiles(root = ROOT) {
  const top = fs.readdirSync(root).filter((f) => (f.endsWith('.js') && f !== 'worker.js' && f !== 'sw.js') || f === 'index.html' || f === 'admin.html');
  const scene = fs.existsSync(path.join(root, 'ts3d')) ? fs.readdirSync(path.join(root, 'ts3d')).filter((f) => f.endsWith('.js')).map((f) => 'ts3d/' + f) : [];
  return top.concat(scene).sort();
}

function targetOf(file, spec) {
  return posix(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
}

// Every local module reachable from worker.js through static imports.
export function workerModules(root = ROOT) {
  const seen = new Set();
  const todo = ['worker.js'];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file) || !fs.existsSync(path.join(root, file))) continue;
    seen.add(file);
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(JS_IMPORT)) todo.push(targetOf(file, m[3]));
  }
  seen.delete('worker.js');
  return seen;
}

// Every local import in a file: { spec, query, target }.
export function importsOf(file, root = ROOT) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const out = [];
  for (const re of patternsFor(file)) for (const m of src.matchAll(re)) {
    const target = targetOf(file, m[3]);
    if (target.startsWith('vendor/') || target === 'sw.js') continue;
    out.push({ spec: m[3], query: m[4] || '', target });
  }
  return out;
}

// An HTML page loads modules two ways: <script src> and imports inside an inline module script.
function patternsFor(file) { return file.endsWith('.html') ? [HTML_SRC, JS_IMPORT] : [JS_IMPORT]; }

export function stamp(build, { root = ROOT, write = true } = {}) {
  const shared = workerModules(root);
  const changed = [];
  const files = browserFiles(root).concat('worker.js');
  for (const file of files) {
    const full = path.join(root, file);
    const src = fs.readFileSync(full, 'utf8');
    const fix = (all, head, quote, spec, query = '') => {
      const target = targetOf(file, spec);
      if (target.startsWith('vendor/') || target === 'sw.js') return all;
      const want = file === 'worker.js' || shared.has(file) || shared.has(target) ? '' : '?v=' + build;
      return query === want ? all : head + quote + spec + want + quote;
    };
    const next = patternsFor(file).reduce((text, re) => text.replace(re, fix), src);
    if (next !== src) {
      changed.push(file);
      if (write) fs.writeFileSync(full, next);
    }
  }
  return { build, changed, shared: [...shared].sort() };
}

export function currentBuild(root = ROOT) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return (html.match(/main\.js\?v=([^'"]+)/) || [])[1] || '';
}

function today() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return kst.slice(0, 10).replace(/-/g, '') + kst.slice(11, 16).replace(':', '');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2] || '';
  if (arg === '--check') {
    const out = stamp(currentBuild(), { write: false });
    if (out.changed.length) {
      console.error('out of line: ' + out.changed.join(', ') + '\nrun: node tools/stamp.mjs');
      process.exit(1);
    }
    console.log('ok ' + out.build);
  } else {
    const build = /^[0-9a-z]{6,20}$/.test(arg) ? arg : today();
    const out = stamp(build);
    console.log('build ' + out.build + '\nrewrote ' + out.changed.length + ' file(s)' + (out.changed.length ? ': ' + out.changed.join(', ') : '') + '\nno query (Worker bundles these too): ' + out.shared.join(', '));
  }
}
