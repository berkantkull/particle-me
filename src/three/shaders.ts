// GLSL for the GPGPU particle simulation (GPUComputationRenderer) and the point
// renderer. Every particle owns a fixed "home" coordinate inside an ellipse in
// face-crop space; its target is resolved on the GPU by sampling the face-crop
// texture there, so particle data never round-trips through the CPU.

const flowField = /* glsl */ `
vec3 flowField(vec3 p, float t) {
  return vec3(
    sin(p.y * 1.7 + t) + cos(p.z * 1.3 - t * 0.7),
    sin(p.z * 1.5 + t * 1.1) + cos(p.x * 1.9 + t * 0.6),
    sin(p.x * 1.2 - t * 0.8) + cos(p.y * 1.4 + t * 0.9)
  ) * 0.5;
}
`

const faceSample = /* glsl */ `
uniform sampler2D tFace;  // face crop of the camera frame (ordinary 2D texture)
uniform sampler2D tMask;  // soft face-oval mask, same crop space
uniform sampler2D tHome;
uniform float uHasFace;
uniform vec3 uHand;       // hand / pointer position in world space
uniform float uHandStrength;
uniform float uHandRadius;
uniform vec2 uLevels;     // face luminance range for auto-levels

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float levels(float l) { return clamp((l - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0); }
float faceMask(vec2 uv) { return uHasFace * texture2D(tMask, uv).r; }
`

export const velocityShader = /* glsl */ `
uniform float uTime;
uniform float uDelta;
uniform float uDisperse;
uniform float uImpulse;
uniform float uSize;
uniform vec2 uView;       // visible world size at z = 0
uniform float uAspect;
${faceSample}
${flowField}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(texturePosition, uv).xyz;
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  vec4 home = texture2D(tHome, uv);
  float dt = uDelta;

  float lum = levels(luma(texture2D(tFace, home.xy).rgb));
  float onFace = smoothstep(0.2, 0.6, faceMask(home.xy));

  // Face target: mirrored crop, dome-shaped relief plus brightness-driven depth.
  vec2 c = home.xy - 0.5;
  float dome = sqrt(max(0.0, 1.0 - dot(c, c) * 4.0));
  vec3 face = vec3(-c.x * uSize * uAspect, c.y * uSize, (dome * 0.22 + (lum - 0.5) * 0.14) * uSize);

  // Ambient target for particles outside the face: a slow orbiting halo while a
  // face is tracked, otherwise a faint drifting field spread over the screen.
  float a = home.z * 6.2831853 + uTime * (0.03 + 0.05 * home.w);
  float R = uSize * (0.62 + 0.5 * home.w);
  vec3 halo = vec3(cos(a) * R * 1.25, sin(a) * R * 0.8, (home.w - 0.5) * uSize * 0.6);
  // Depth comes from a hash: tying it to home.z (= x) made perspective open vertical gaps.
  float depth = fract(sin(dot(home.zw, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  vec3 field = vec3((home.z - 0.5) * uView.x * 1.1, (home.w - 0.5) * uView.y * 1.1, depth * 3.0);
  field += flowField(field * 0.3, uTime * 0.15) * 0.25;
  vec3 dust = mix(field, halo, uHasFace);

  vec3 target = mix(dust, face, onFace);

  // Staggered reassembly: each particle starts returning at its own moment.
  float form = smoothstep(home.z * 0.45, home.z * 0.45 + 0.55, 1.0 - uDisperse);
  // The idle field springs back quickly so cursor trails close within ~0.5 s.
  vec3 acc = (target - pos) * mix(mix(16.0, 6.0, uHasFace), 48.0, onFace) * form;

  // Dispersed: swirling flow field, held inside a soft spherical shell.
  float dc = length(pos) + 1e-4;
  vec3 radial = pos / dc;
  float shell = uSize * (0.75 + 0.9 * home.w);
  acc += (1.0 - form) * (flowField(pos * 0.45, uTime * 0.25) * 2.6 + radial * (shell - dc) * 0.9);

  // Hand: radial push plus a swirl around the palm.
  vec3 dh = pos - uHand;
  dh.z *= 0.35;
  float hd = length(dh) + 1e-4;
  float hf = uHandStrength * exp(-(hd * hd) / (uHandRadius * uHandRadius));
  acc += (dh / hd * 38.0 + vec3(-dh.y, dh.x, 0.0) / hd * 14.0) * hf;

  vel += acc * dt;
  // One-shot outward burst when a dispersal starts.
  vel += normalize(radial + (home.xyw - 0.5) * 0.8) * uImpulse * (0.4 + home.w);
  vel *= pow(mix(0.84, 0.97, 1.0 - form), dt * 60.0);

  gl_FragColor = vec4(vel, 1.0);
}
`

export const positionShader = /* glsl */ `
uniform float uDelta;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(texturePosition, uv);
  p.xyz += texture2D(textureVelocity, uv).xyz * uDelta;
  gl_FragColor = p;
}
`

export const pointsVertexShader = /* glsl */ `
attribute vec2 reference;
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float uPointSize;
uniform float uPointScale;
uniform float uTime;
uniform float uColorMode;
uniform vec2 uTexel;
${faceSample}
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 pos = texture2D(texturePosition, reference).xyz;
  float speed = length(texture2D(textureVelocity, reference).xyz);
  vec4 home = texture2D(tHome, reference);

  vec2 vuv = home.xy;
  vec3 cam = texture2D(tFace, vuv).rgb;
  float tone = smoothstep(0.0, 1.0, levels(luma(cam)));
  // Cheap gradient magnitude so contours (eyes, brows, lips, jaw) read crisply.
  float gx = luma(texture2D(tFace, vuv + vec2(uTexel.x, 0.0)).rgb) - luma(texture2D(tFace, vuv - vec2(uTexel.x, 0.0)).rgb);
  float gy = luma(texture2D(tFace, vuv + vec2(0.0, uTexel.y)).rgb) - luma(texture2D(tFace, vuv - vec2(0.0, uTexel.y)).rgb);
  float edge = clamp(length(vec2(gx, gy)) / (uLevels.y - uLevels.x) * 2.5, 0.0, 1.0);
  float onFace = smoothstep(0.2, 0.6, faceMask(vuv));

  float bright = mix(0.12, 1.0, tone) + edge * 0.9;
  vec3 col;
  if (uColorMode < 0.5) {          // cyan
    col = mix(vec3(0.05, 0.25, 0.85), vec3(0.35, 0.95, 1.0), tone);
    col = mix(col, vec3(0.9, 1.0, 1.0), edge * 0.5 + smoothstep(0.75, 1.0, tone) * 0.4);
  } else if (uColorMode < 1.5) {   // natural camera colours
    col = (cam - uLevels.x) / (uLevels.y - uLevels.x) * 0.9 + 0.1 + edge * 0.12;
    bright = 0.8 + edge * 0.4;
  } else if (uColorMode < 2.5) {   // aurora
    float w = 0.5 + 0.5 * sin(home.y * 5.0 + home.x * 2.0 + uTime * 0.6);
    col = mix(vec3(0.2, 0.9, 1.0), vec3(0.75, 0.35, 1.0), w);
  } else {                         // mono
    col = vec3(0.92, 0.96, 1.0);
  }

  vColor = mix(vec3(0.35, 0.7, 1.0), col, onFace) + vec3(0.2, 0.5, 0.7) * min(speed * 0.06, 0.6);
  // Dust twinkles softly and lights up while it is being pushed around.
  // Phase from a hash, not from home.z (which also sets the x position and
  // would turn the twinkle into sweeping vertical bands).
  float twinkle = 0.65 + 0.35 * sin(uTime * 1.5 + fract(home.w * 91.7 + home.z * 37.3) * 6.2831853);
  float dustAlpha = mix(0.3, 0.2, uHasFace) * twinkle + min(speed * 0.1, 0.6);
  // Glowing rim where particles pile up around the hand / cursor.
  float hd = length((pos - uHand).xy) / uHandRadius;
  float rim = uHandStrength * exp(-pow((hd - 1.15) * 2.5, 2.0));
  vAlpha = (mix(dustAlpha, bright, onFace) + rim * 0.5) * 0.9;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float dustSize = mix(0.9 + 1.0 * fract(home.w * 13.7), 0.7, uHasFace);
  gl_PointSize = uPointSize * mix(dustSize, 0.55 + tone * 0.75, onFace) * uPointScale / -mv.z;
}
`

export const pointsFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  if (d2 > 1.0) discard;
  // Bright core plus a faint halo gives a soft glow under additive blending.
  float a = vAlpha * (exp(-d2 * 6.0) + (1.0 - d2) * 0.25);
  gl_FragColor = vec4(vColor, a);
}
`
