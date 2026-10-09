/**
 * GLSL for the signature hero (see signatureHero.ts). Raw sRGB values in and
 * out: none of these include three's colour chunks.
 */

export const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Glyph-tile field: the FIELD branch of the old ring's POST_FRAG (same tile
 * vocabulary, palette and baked saturate/contrast grade). The fluid shifts
 * WHICH glyph each cell prints (cells stay crisp squares); the trail dye only
 * thickens + warms glyphs (owner rejected a white "fireball" trail); the big
 * background signature is carved in as denser, lighter glyphs and lights up
 * under uLight (the mirrored spotlight / opening trace).
 */
export const FIELD_FRAG = /* glsl */ `
  uniform vec2 uGrid; uniform float uTime; uniform float uTileCount;
  uniform vec3 uFieldBase; uniform vec3 uFieldBlob;
  uniform sampler2D uVel; uniform sampler2D uDye; uniform float uSwirl;
  uniform sampler2D uBgSig; uniform float uBgSigAmt; uniform vec3 uSigTone;
  uniform float uAspect;
  uniform vec3 uLight; uniform float uLightR;
  varying vec2 vUv;

  float bayer2(vec2 p) { float x2 = mod(p.x, 2.0); float y2 = mod(p.y, 2.0); return 3.0 * y2 + x2 * (2.0 - 4.0 * y2); }
  float bayer4(vec2 p) { p = floor(p); return (4.0 * bayer2(floor(p / 2.0)) + bayer2(p) + 0.5) / 16.0; }
  float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = vhash(i); float b = vhash(i + vec2(1.0, 0.0)); float c = vhash(i + vec2(0.0, 1.0)); float d = vhash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float tileMask(float idx, vec2 p) {
    vec2 a = abs(p - 0.5);
    float box = max(a.x, a.y);
    float d1 = abs(p.x + p.y - 1.0);
    float d2 = abs(p.x - p.y);
    float inTile = step(box, 0.42);
    if (idx < 0.5) return 0.0;
    else if (idx < 1.5) return step(box, 0.13);
    else if (idx < 2.5) return step(d1, 0.11) * inTile;
    else if (idx < 3.5) return max(step(d1, 0.10), step(d2, 0.10)) * inTile;
    else if (idx < 4.5) return step(box, 0.40) - step(box, 0.26);
    else if (idx < 5.5) { float frame = step(box, 0.40) - step(box, 0.26); float slash = step(d1, 0.10) * step(box, 0.26); return clamp(frame + slash, 0.0, 1.0); }
    else if (idx < 6.5) return step(box, 0.30);
    return step(box, 0.44);
  }

  void main() {
    vec2 g = vUv * uGrid;
    vec2 cell = floor(g);
    vec2 cellUv = fract(g);
    float dith = bayer4(cell);

    // Flow at this cell's centre (texels/s of the sim -> cells of drift).
    vec2 vel = texture2D(uVel, (cell + 0.5) / uGrid).xy;
    vec2 src = cell - vel * uSwirl;

    float n = vnoise(src * 0.008 + uTime * vec2(0.018, 0.010)) * 0.6 + vnoise(src * 0.017 + uTime * vec2(-0.011, 0.015)) * 0.4;
    float sym = n * 0.7 + vnoise(src * 0.06 + uTime * vec2(0.02, -0.013)) * 0.3;
    float lit = smoothstep(0.10, 0.90, sym);
    // Cursor wake: no white (owner rejected the "fireball"). The flow only
    // thickens the glyphs it passes and warms them a shade, then settles.
    float ink = clamp(texture2D(uDye, (cell + 0.5) / uGrid).x, 0.0, 1.0);
    vec2 cc = (cell + 0.5) / uGrid;

    // The signature again, huge, carved into the field as denser, lighter glyphs.
    float bs = texture2D(uBgSig, cc).r * uBgSigAmt;
    // Light from the front signature: where the cursor touches the 3D one, the
    // same spot of the background one lights up (soft falloff, denser glyphs).
    float ld = length((cc - uLight.xy) * vec2(uAspect, 1.0));
    float lightK = uLight.z * (1.0 - smoothstep(0.0, uLightR, ld));
    lightK *= lightK * (3.0 - 2.0 * lightK);
    float bsLit = bs * lightK;

    float fIdx = 2.0 + lit * (uTileCount - 3.0) + ink * 2.0 + bs * 3.0 + bsLit * 2.0;
    float idx = clamp(floor(fIdx + (dith - 0.5)), 2.0, uTileCount - 1.0);
    float mask = tileMask(idx, cellUv);
    vec3 glyph = mix(mix(uFieldBlob, uSigTone, max(bs, ink * 0.55)), vec3(1.0), clamp(bsLit * 1.15, 0.0, 1.0));
    vec3 col = mix(uFieldBase, glyph, mask);
    col = mix(col, uSigTone, bsLit * 0.22 * (1.0 - mask)); // faint glow between the lit glyphs
    col = mix(col, uSigTone, lightK * 0.26 * mask); // the light's spill on the rest of the field

    col = mix(vec3(dot(col, vec3(0.213, 0.715, 0.072))), col, 1.28);
    col = (col - 0.5) * 1.2 + 0.5;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

/** Opaque "inflated" white tube: refracts the field behind it with an RGB
 *  split, white -> pale peach tint, sky/floor reflection, fresnel, speculars. */
export const SIG_VERT = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView; varying float vY;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vY = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;

export const SIG_FRAG = /* glsl */ `
  uniform sampler2D uBg; uniform vec2 uRes; uniform float uRefract; uniform float uInk;
  uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uFloor; uniform vec3 uDeep;
  varying vec3 vNormal; varying vec3 vView; varying float vY;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    vec2 suv = gl_FragCoord.xy / uRes;
    vec2 o = n.xy * uRefract;
    vec3 refr = vec3(
      texture2D(uBg, suv - o * 1.00).r,
      texture2D(uBg, suv - o * 1.12).g,
      texture2D(uBg, suv - o * 1.24).b);

    float h = clamp(vY + 0.5, 0.0, 1.0);
    vec3 tint = mix(uBottom, uTop, smoothstep(0.1, 0.9, h));
    vec3 body = mix(refr, tint, uInk);

    // Fake environment: bright sky overhead, the orange page as the floor.
    vec3 r = reflect(-v, n);
    vec3 env = mix(uFloor, vec3(1.0), smoothstep(-0.35, 0.45, r.y));
    env = mix(env, uDeep, smoothstep(0.2, -0.9, r.y) * 0.55);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
    vec3 col = mix(body, env, 0.1 + fres * 0.55);

    vec3 L1 = normalize(vec3(-0.45, 0.75, 0.55));
    vec3 L2 = normalize(vec3(0.7, 0.25, 0.65));
    float s1 = pow(max(dot(n, normalize(L1 + v)), 0.0), 90.0);
    float s2 = pow(max(dot(n, normalize(L2 + v)), 0.0), 40.0) * 0.35;
    // Broad balloon sheen under the tight hotspot: reads inflated, not tubular.
    float sheen = pow(max(dot(n, normalize(L1 + v)), 0.0), 14.0) * 0.22;
    col += vec3(s1 + s2 + sheen);
    // Soft self-shadow on the underside so the tube reads round, not flat white.
    col *= mix(0.84, 1.0, smoothstep(-0.9, 0.5, n.y));
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

/** Field + signature layer; the signature smeared by the flow with a
 *  per-channel split (haoqi.design's chromatic push). */
export const COMP_FRAG = /* glsl */ `
  uniform sampler2D uBg; uniform sampler2D uSig; uniform sampler2D uVel;
  uniform vec2 uTexel; uniform float uWarp; uniform float uSplit;
  varying vec2 vUv;
  void main() {
    vec2 vel = texture2D(uVel, vUv).xy * uTexel;
    vec2 o = vel * uWarp;
    float sp = 1.0 + uSplit;
    vec4 sr = texture2D(uSig, vUv - o * sp);
    vec4 sg = texture2D(uSig, vUv - o);
    vec4 sb = texture2D(uSig, vUv - o / sp);
    vec3 bg = texture2D(uBg, vUv).rgb;
    vec3 col = vec3(mix(bg.r, sr.r, sr.a), mix(bg.g, sg.g, sg.a), mix(bg.b, sb.b, sb.a));
    gl_FragColor = vec4(col, 1.0);
  }
`;
