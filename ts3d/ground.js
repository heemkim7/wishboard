// Rain-soaked streets: the wet-street shader patch (puddle mask, damp albedo, glossy puddles) and the
// planar mirror pass that reflects the billboards and towers in the puddles and the rivers.
import * as THREE from 'three';

export const GROUND_LAYER = 1;

export function createReflection(renderer, { enabled = true, scale = 0.5 } = {}) {
  const target = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  const uniforms = {
    map: { value: enabled ? target.texture : black },
    matrix: { value: new THREE.Matrix4() },
    on: { value: enabled ? 1 : 0 },
  };
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(0);
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const camPos = new THREE.Vector3(), dir = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3();
  const N = new THREE.Vector3(0, 1, 0), O = new THREE.Vector3();
  let size = [2, 2];
  return {
    uniforms,
    get enabled() { return uniforms.on.value > 0.5; },
    setEnabled(v) {
      uniforms.on.value = v ? 1 : 0;
      uniforms.map.value = v ? target.texture : black;
    },
    setSize(w, h) {
      size = [Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale))];
      target.setSize(size[0], size[1]);
    },
    setScale(s, w, h) { scale = s; this.setSize(w, h); },
    update(scene, camera) {
      if (uniforms.on.value < 0.5) return;
      camera.getWorldPosition(camPos);
      if (camPos.y < 0.05) return;
      camera.getWorldDirection(dir);
      cam.position.set(camPos.x, -camPos.y, camPos.z);
      look.copy(camPos).add(dir);
      look.y = -look.y;
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      up.y = -up.y;
      cam.up.copy(up);
      cam.lookAt(look);
      cam.fov = camera.fov;
      cam.aspect = camera.aspect;
      cam.near = camera.near;
      cam.far = camera.far;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      const m = uniforms.matrix.value;
      m.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      m.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      plane.setFromNormalAndCoplanarPoint(N, O).applyMatrix4(cam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = cam.projectionMatrix.elements;
      q.x = (Math.sign(clip.x) + e[8]) / e[0];
      q.y = (Math.sign(clip.y) + e[9]) / e[5];
      q.z = -1;
      q.w = (1 + e[10]) / e[14];
      clip.multiplyScalar(2 / clip.dot(q));
      e[2] = clip.x;
      e[6] = clip.y;
      e[10] = clip.z + 1 - 0.003;
      e[14] = clip.w;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setRenderTarget(prev);
    },
    dispose() { target.dispose(); black.dispose(); },
  };
}

/**
 * Wet-street shader patch for MeshStandardMaterial: puddle mask, darker damp albedo, glossy puddles, planar reflection.
 * `pave: [sizeX, sizeZ, strength, bond]` draws large low-contrast paver joints in world space (bond 1 = running bond);
 * the joints and the slight per-slab value change fade out once a slab is under a few pixels, so the far field is flat.
 * `vary` is the amplitude of a very soft wet/dry value variation (two octaves of value noise, 23 m and 7.7 m).
 * Without the reflection pass (low tier) puddles darken the albedo to 0.62 instead of 0.3, so they do not read as holes.
 */
export function patchWet(mat, refl, puddleTex, { wet = 0.7, puddles = 1, reflect = 1, pave = [1, 1, 0, 0], vary = 0 } = {}) {
  const puddleU = { value: puddleTex };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRefl = refl.uniforms.map;
    sh.uniforms.uReflMat = refl.uniforms.matrix;
    sh.uniforms.uReflOn = refl.uniforms.on;
    sh.uniforms.uPuddle = puddleU;
    sh.uniforms.uWet = { value: wet };
    sh.uniforms.uPud = { value: puddles };
    sh.uniforms.uReflK = { value: reflect };
    sh.uniforms.uPave = { value: new THREE.Vector4(...pave) };
    sh.uniforms.uVary = { value: vary };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uReflMat;\nvarying vec4 vReflUv;\nvarying vec2 vWxz;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n{ vec4 wp = modelMatrix * vec4( transformed, 1.0 ); vWxz = wp.xz; vReflUv = uReflMat * wp; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRefl;\nuniform sampler2D uPuddle;\nuniform float uReflOn;\nuniform float uWet;\nuniform float uPud;\nuniform float uReflK;\nuniform vec4 uPave;\nuniform float uVary;\nvarying vec4 vReflUv;\nvarying vec2 vWxz;\nfloat gPud = 0.0;\nfloat gVar = 0.0;\nfloat gH( vec2 p ) { p = fract( p * vec2( 0.1031, 0.1137 ) ); p += dot( p, p.yx + 33.33 ); return fract( ( p.x + p.y ) * p.x ); }\nfloat gN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( gH( i ), gH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gH( i + vec2( 0.0, 1.0 ) ), gH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }')
      .replace('#include <map_fragment>', `#include <map_fragment>
if ( uPave.z > 0.0 ) {
  vec2 pc = vWxz / uPave.xy;
  pc.x += uPave.w * 0.5 * floor( pc.y );
  vec2 pf = fwidth( pc );
  vec2 d = abs( fract( pc + 0.5 ) - 0.5 );
  vec2 lw = 0.03 / uPave.xy;
  vec2 ln = 1.0 - smoothstep( lw, lw + pf * 1.5, d );
  float nearK = 1.0 - smoothstep( 0.12, 0.35, max( pf.x, pf.y ) );
  vec2 sid = fract( floor( pc ) * vec2( 0.1031, 0.1137 ) );
  sid += dot( sid, sid.yx + 33.33 );
  float slab = fract( ( sid.x + sid.y ) * sid.x ) - 0.5;
  diffuseColor.rgb *= ( 1.0 - uPave.z * max( ln.x, ln.y ) * nearK ) * ( 1.0 + 0.1 * slab * nearK );
}
{
  float p1 = texture2D( uPuddle, vWxz * 0.031 ).r;
  float p2 = texture2D( uPuddle, vWxz * 0.0123 + vec2( 0.37, 0.71 ) ).r;
  gPud = smoothstep( 0.42, 0.64, p1 * 0.55 + p2 * 0.65 ) * uPud;
  diffuseColor.rgb *= mix( 1.0 - 0.38 * uWet, mix( 0.62, 0.3, uReflOn ), gPud );
}
if ( uVary > 0.0 ) {
  float wv = gN( vWxz / 23.0 ) * 0.65 + gN( vWxz / 7.7 + 3.1 ) * 0.35;
  gVar = uVary * 2.0 * ( wv - 0.5 );
  diffuseColor.rgb *= 1.0 + gVar;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor * ( 1.0 - 0.5 * uWet ) * ( 1.0 + gVar ), 0.03, gPud );`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize( mix( normal, nonPerturbedNormal, gPud * 0.92 ) );`)
      .replace('#include <opaque_fragment>', `if ( uReflOn > 0.5 ) {
  vec2 ruv = vReflUv.xy / vReflUv.w;
  ruv += ( normal.xy - nonPerturbedNormal.xy ) * 0.04;
  float lod = clamp( roughnessFactor * 9.0, 0.0, 6.5 );
  vec3 rc = textureLod( uRefl, ruv, lod ).rgb;
  float ndv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float fres = 0.05 + 0.95 * pow( 1.0 - ndv, 5.0 );
  float k = mix( 0.24 * uWet, 0.95, gPud ) * uReflK;
  outgoingLight += rc * k * mix( 0.35, 1.0, fres ) * ( 1.0 - roughnessFactor * 0.7 );
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'kts-wet-street';
  return mat;
}

