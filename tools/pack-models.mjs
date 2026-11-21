// Re-encodes the avatar GLBs without anything that needs a decoder (no Draco, no Meshopt).
// glTF-Transform is not a dependency of this repo; install it somewhere outside and point GLTF_DEPS there:
//   npm i --prefix %TEMP%\kts\gltf @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 sharp
//   set GLTF_DEPS=%TEMP%\kts\gltf
//   git show df5a739:assets/models/Cat.glb > %TEMP%\kts\Cat.glb      (run on the originals, not on packed files)
//   node tools/pack-models.mjs %TEMP%\kts\Cat.glb assets/models/Cat.glb
// Steps:
//  - node extras stripped; weld (Mousey was an unindexed triangle soup); resample (drops redundant keys);
//  - animation tracks that hold the node's rest value for the whole clip are dropped (three's mixer restores the
//    rest value of a property no running clip binds, so this is exact);
//  - prune; dedup of accessors, meshes and textures only, so every material keeps its own name;
//  - textures as WebP (EXT_texture_webp, read by the vendored GLTFLoader), at most 1024 px;
//  - rotation keys as normalized int16 (core glTF 2.0);
//  - KHR_mesh_quantization for NORMAL (int8), JOINTS_0 (uint8), WEIGHTS_0 (uint8). POSITION and UVs stay float:
//    quantizing POSITION moves the scale into a node transform and clones one skin per mesh.
// test/load.test.mjs checks the result: clip names, material names, joint names.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const DEPS = process.env.GLTF_DEPS;
if (!DEPS) { console.error('set GLTF_DEPS to the folder where @gltf-transform/* and sharp are installed'); process.exit(2); }
const req = createRequire(path.join(path.resolve(DEPS), 'noop.js'));
const dep = async (n) => { const m = await import(pathToFileURL(req.resolve(n)).href); return m.default && !m.NodeIO && !m.weld && !m.ALL_EXTENSIONS ? m.default : m; };
const { NodeIO, PropertyType } = await dep('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRMeshQuantization } = await dep('@gltf-transform/extensions');
const { weld, resample, prune, dedup, quantize, textureCompress } = await dep('@gltf-transform/functions');
const sharp = await dep('sharp');

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node tools/pack-models.mjs <in.glb> <out.glb>'); process.exit(2); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);

const stripExtras = () => (d) => { for (const n of d.getRoot().listNodes()) n.setExtras({}); };
const dropRestTracks = () => (d) => {
  let dropped = 0;
  for (const anim of d.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode(), p = ch.getTargetPath(), s = ch.getSampler();
      if (!node || !s || p === 'weights') continue;
      const rest = p === 'translation' ? node.getTranslation() : p === 'rotation' ? node.getRotation() : node.getScale();
      const o = s.getOutput(), el = [];
      let same = true;
      for (let i = 0; i < o.getCount() && same; i++) {
        o.getElement(i, el);
        const flip = p === 'rotation' && el.reduce((a, v, k) => a + v * rest[k], 0) < 0 ? -1 : 1;
        for (let k = 0; k < el.length && same; k++) if (Math.abs(el[k] - flip * rest[k]) > 1e-5 * Math.max(1, Math.abs(rest[k]))) same = false;
      }
      if (same) { ch.dispose(); dropped++; }
    }
    const used = new Set(anim.listChannels().map((c) => c.getSampler()));
    for (const s of anim.listSamplers()) if (!used.has(s)) s.dispose();
  }
  console.log('rest tracks dropped', dropped);
};
const rotationsToInt16 = () => (d) => {
  const done = new Set();
  for (const anim of d.getRoot().listAnimations()) for (const ch of anim.listChannels()) {
    const o = ch.getTargetPath() === 'rotation' ? ch.getSampler()?.getOutput() : null;
    if (!o || done.has(o) || o.getComponentType() !== 5126) continue;
    done.add(o);
    const a = o.getArray(), q = new Int16Array(a.length);
    for (let i = 0; i < a.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, a[i])) * 32767);
    o.setArray(q).setNormalized(true);
  }
};
const keepPrune = () => prune({ keepAttributes: true, keepLeaves: true, keepSolidTextures: true });

await doc.transform(
  stripExtras(),
  weld(),
  resample({ tolerance: 1e-4 }),
  dropRestTracks(),
  keepPrune(),
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  rotationsToInt16(),
  quantize({ pattern: /^(NORMAL|JOINTS_\d+|WEIGHTS_\d+)$/, quantizeNormal: 8, quantizeWeight: 8, cleanup: false }),
  keepPrune(),
);
// int8 normals are only legal with KHR_mesh_quantization declared.
doc.createExtension(KHRMeshQuantization).setRequired(true);
await io.write(out, doc);
console.log('wrote', out);
