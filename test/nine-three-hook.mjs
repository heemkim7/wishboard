// Resolves the browser import map ('three', 'three/addons/') to the vendored build, so ts3d/screens.js loads in Node
// (test/nine.test.mjs).
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return next(new URL('../vendor/three/build/three.module.js', import.meta.url).href, ctx);
  if (spec.startsWith('three/addons/')) return next(new URL('../vendor/three/examples/jsm/' + spec.slice(13), import.meta.url).href, ctx);
  return next(spec, ctx);
}
