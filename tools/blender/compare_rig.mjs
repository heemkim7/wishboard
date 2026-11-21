// Is the skeleton and animation of a new avatar GLB the same as the reference (Mousey.glb)?
// usage: node compare_rig.mjs src/Mousey.glb bear.glb
// Compares joint names, the rest pose (inverse bind matrices) and every clip sampled on the reference's key times.
import { readFileSync } from 'node:fs';

function load(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const ct = a.componentType;
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5126: 4 }[ct];
    const read = { 5120: (d, o) => d.getInt8(o), 5121: (d, o) => d.getUint8(o), 5122: (d, o) => d.getInt16(o, true), 5123: (d, o) => d.getUint16(o, true), 5126: (d, o) => d.getFloat32(o, true) }[ct];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[ct] : 1;
    const stride = bv.byteStride || n * size;
    const out = new Float32Array(a.count * n);
    const dv = new DataView(bin.buffer, off);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = Math.max(read(dv, i * stride + k * size) / norm, -1e30);
    return { data: out, n, count: a.count };
  };
  return { json, acc };
}

function sample(times, values, n, t) {
  const c = times.length;
  if (t <= times[0]) return values.slice(0, n);
  if (t >= times[c - 1]) return values.slice((c - 1) * n, c * n);
  let i = 0;
  while (times[i + 1] < t) i++;
  const u = (t - times[i]) / (times[i + 1] - times[i]);
  const a = values.slice(i * n, i * n + n), b = values.slice((i + 1) * n, (i + 1) * n + n);
  if (n === 4) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const s = dot < 0 ? -1 : 1;
    const q = a.map((v, k) => v * (1 - u) + s * b[k] * u);
    const len = Math.hypot(...q);
    return q.map((v) => v / len);
  }
  return a.map((v, k) => v * (1 - u) + b[k] * u);
}

const [refPath, newPath] = process.argv.slice(2);
const R = load(refPath), N = load(newPath);
const names = (g) => g.json.skins[0].joints.map((j) => g.json.nodes[j].name);
const rn = names(R), nn = names(N);
console.log('joints', rn.length, 'vs', nn.length, '| same set of names:', rn.length === nn.length && [...rn].sort().join() === [...nn].sort().join());

// rest pose: inverse bind matrices, compared bone by bone (the glTF root may carry a different node scale, so compare as-is and report)
const ibR = R.acc(R.json.skins[0].inverseBindMatrices).data, ibN = N.acc(N.json.skins[0].inverseBindMatrices).data;
let worst = 0, worstName = '';
for (let i = 0; i < rn.length; i++) {
  const j = nn.indexOf(rn[i]);
  for (let k = 0; k < 16; k++) {
    const d = Math.abs(ibR[i * 16 + k] - ibN[j * 16 + k]);
    if (d > worst) { worst = d; worstName = rn[i]; }
  }
}
console.log('rest pose: largest inverse-bind difference', worst.toExponential(2), worstName ? `(${worstName})` : '');

// parent of every joint
const parentOf = (g) => { const p = {}; g.json.nodes.forEach((n) => (n.children || []).forEach((c) => (p[g.json.nodes[c].name] = n.name))); return p; };
const pR = parentOf(R), pN = parentOf(N);
console.log('hierarchy: same parents:', rn.every((n) => (rn.includes(pR[n]) ? pR[n] : null) === (nn.includes(pN[n]) ? pN[n] : null)));

const clips = (g) => Object.fromEntries((g.json.animations || []).map((a) => [a.name, a]));
const cR = clips(R), cN = clips(N);
const restRot = (g, name) => g.json.nodes.find((n) => n.name === name).rotation || [0, 0, 0, 1];
for (const name of Object.keys(cR)) {
  const a = cR[name], b = cN[name];
  if (!b) { console.log(name, 'MISSING'); continue; }
  const chan = (g, anim) => {
    const m = {};
    for (const c of anim.channels) {
      const s = anim.samplers[c.sampler];
      m[g.json.nodes[c.target.node].name + '/' + c.target.path] = { t: g.acc(s.input).data, v: g.acc(s.output).data };
    }
    return m;
  };
  const ca = chan(R, a), cb = chan(N, b);
  let maxAngle = 0, maxWhere = '', maxPos = 0, missing = [];
  let dur = [0, 0];
  for (const k of Object.keys(ca)) dur[0] = Math.max(dur[0], ca[k].t[ca[k].t.length - 1]);
  for (const k of Object.keys(cb)) dur[1] = Math.max(dur[1], cb[k].t[cb[k].t.length - 1]);
  for (const key of Object.keys(ca)) {
    const [bone, path] = key.split('/');
    const n = path === 'rotation' ? 4 : 3;
    for (const t of ca[key].t) {
      const va = sample(ca[key].t, ca[key].v, n, t);
      let vb;
      if (cb[key]) vb = sample(cb[key].t, cb[key].v, n, t);
      else { if (!missing.includes(key)) missing.push(key); vb = path === 'rotation' ? restRot(N, bone) : (N.json.nodes.find((x) => x.name === bone)[path] || [0, 0, 0]); }
      if (n === 4) {
        const dot = Math.min(1, Math.abs(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2] + va[3] * vb[3]));
        const ang = (2 * Math.acos(dot) * 180) / Math.PI;
        if (ang > maxAngle) { maxAngle = ang; maxWhere = `${bone} @${t.toFixed(3)}s`; }
      } else if (path === 'translation') {
        maxPos = Math.max(maxPos, Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]));
      }
    }
  }
  const extra = Object.keys(cb).filter((k) => !ca[k]);
  console.log(`${name.padEnd(9)} duration ${dur[0].toFixed(3)} vs ${dur[1].toFixed(3)} | max rotation diff ${maxAngle.toFixed(3)} deg ${maxWhere} | max translation diff ${maxPos.toFixed(4)} | ref channels missing in new: ${missing.length}${missing.length ? ' (' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? ', …' : '') + ')' : ''} | extra in new: ${extra.length}`);
}
