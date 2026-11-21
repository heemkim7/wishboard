// Parse the JSON chunk of a GLB and print the numbers the game cares about.
// usage: node inspect_glb.mjs bear.glb
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const buf = readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

let tris = 0, verts = 0, prims = 0;
const perMesh = [];
for (const mesh of json.meshes || []) {
  let mt = 0;
  for (const p of mesh.primitives) {
    prims++;
    const mode = p.mode ?? 4;
    const count = p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count;
    if (mode === 4) mt += count / 3;
    verts += json.accessors[p.attributes.POSITION].count;
  }
  tris += mt;
  perMesh.push(`${mesh.name}: ${mt} tris, ${mesh.primitives.length} primitive(s)`);
}
const pos = (json.meshes || []).flatMap(m => m.primitives.map(p => json.accessors[p.attributes.POSITION]));
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const a of pos) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]); }

console.log('file            ', path, `(${(buf.length / 1024).toFixed(0)} KB)`);
console.log('triangles       ', tris);
console.log('vertices (split)', verts);
console.log('meshes          ', (json.meshes || []).length, '/ primitives', prims);
for (const l of perMesh) console.log('   ', l);
console.log('materials       ', (json.materials || []).map(m => m.name).join(', '));
for (const m of json.materials || []) {
  const p = m.pbrMetallicRoughness || {};
  console.log('   ', m.name, 'base', JSON.stringify(p.baseColorFactor), 'rough', p.roughnessFactor, 'metal', p.metallicFactor, p.baseColorTexture ? 'TEXTURE' : '');
}
console.log('skins           ', (json.skins || []).length, 'joints', (json.skins || []).map(s => s.joints.length).join(','));
console.log('clips           ', (json.animations || []).map(a => a.name).join(', '));
console.log('images/textures ', (json.images || []).length, '/', (json.textures || []).length);
console.log('cameras/lights  ', (json.cameras || []).length, '/', (json.extensions?.KHR_lights_punctual?.lights || []).length);
console.log('local bbox min  ', min.map(v => v.toFixed(3)).join(' '));
console.log('local bbox max  ', max.map(v => v.toFixed(3)).join(' '));
console.log('scene roots     ', (json.scenes?.[0]?.nodes || []).map(i => json.nodes[i].name).join(', '));
if (process.argv.includes('--nodes')) {
  for (const n of json.nodes) console.log('   node', n.name, n.mesh !== undefined ? 'mesh' : '', n.skin !== undefined ? 'skin' : '', n.scale ? 'scale ' + n.scale : '', n.rotation ? 'rot ' + n.rotation.map(v => v.toFixed(3)) : '', n.translation ? 'tr ' + n.translation.map(v => v.toFixed(3)) : '');
}
if (process.argv.includes('--anims')) {
  for (const a of json.animations || []) {
    const times = a.samplers.map(s => json.accessors[s.input]);
    const tmax = Math.max(...times.map(t => t.max[0]));
    console.log('   ', a.name, 'channels', a.channels.length, 'duration', tmax.toFixed(3));
  }
}

// ---- skin data sanity: every vertex has weights that sum to 1, at most 4 joints, unit normals
{
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const get = { 5121: (d, o) => d.getUint8(o), 5123: (d, o) => d.getUint16(o, true), 5125: (d, o) => d.getUint32(o, true), 5126: (d, o) => d.getFloat32(o, true) }[a.componentType];
    const norm = a.normalized ? { 5121: 255, 5123: 65535 }[a.componentType] : 1;
    const stride = bv.byteStride || n * size;
    const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0));
    const out = [];
    for (let k = 0; k < a.count; k++) { const row = []; for (let c = 0; c < n; c++) row.push(get(dv, k * stride + c * size) / norm); out.push(row); }
    return out;
  };
  let worstSum = 0, maxInfl = 0, maxJoint = 0, worstN = 0, verts = 0, used = new Set(), sets = 0;
  for (const mesh of json.meshes || []) for (const p of mesh.primitives) {
    if (p.attributes.JOINTS_0 === undefined) continue;
    if (p.attributes.JOINTS_1 !== undefined) sets++;
    const J = read(p.attributes.JOINTS_0), W = read(p.attributes.WEIGHTS_0), N = read(p.attributes.NORMAL);
    for (let i = 0; i < W.length; i++) {
      verts++;
      const s = W[i].reduce((a, b) => a + b, 0);
      worstSum = Math.max(worstSum, Math.abs(s - 1));
      maxInfl = Math.max(maxInfl, W[i].filter((w) => w > 0).length);
      W[i].forEach((w, k) => { if (w > 0) { used.add(J[i][k]); maxJoint = Math.max(maxJoint, J[i][k]); } });
      worstN = Math.max(worstN, Math.abs(Math.hypot(...N[i]) - 1));
    }
  }
  if (verts) console.log('skin check      ', `${verts} verts, weight sum error <= ${worstSum.toExponential(1)}, max influences ${maxInfl}, joints actually used ${used.size}, highest joint index ${maxJoint}, normal length error <= ${worstN.toExponential(1)}, extra weight sets ${sets}`);
}
