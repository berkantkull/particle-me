import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { pointsFragmentShader, pointsVertexShader, positionShader, velocityShader } from './shaders'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export interface Simulation {
  points: THREE.Points
  velUniforms: Record<string, THREE.IUniform>
  posUniforms: Record<string, THREE.IUniform>
  renderUniforms: Record<string, THREE.IUniform>
  step(): void
  scatter(): void
  dispose(): void
}

/**
 * Per-particle constants: xy = home position on a Vogel (golden-angle) spiral
 * inside the crop ellipse — an even, blue-noise-like sampling of the face;
 * zw = random seeds.
 */
function createHomeTexture(size: number): THREE.DataTexture {
  const n = size * size
  const data = new Float32Array(n * 4)
  // A little jitter breaks up the spiral's moiré without clumping.
  const jitter = 0.45 / size
  for (let i = 0; i < n; i++) {
    const r = 0.5 * Math.sqrt((i + 0.5) / n)
    const t = i * GOLDEN_ANGLE
    data[i * 4] = 0.5 + r * Math.cos(t) + (Math.random() - 0.5) * jitter
    data[i * 4 + 1] = 0.5 + r * Math.sin(t) + (Math.random() - 0.5) * jitter
    data[i * 4 + 2] = Math.random()
    data[i * 4 + 3] = Math.random()
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  return tex
}

function fillScatter(tex: THREE.DataTexture) {
  const data = tex.image.data as Float32Array
  for (let i = 0; i < data.length; i += 4) {
    // Random points in a wide shell: a fresh start that reassembles cinematically.
    const u = Math.random() * 2 - 1
    const phi = Math.random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const r = 6 + Math.random() * 8
    data[i] = s * Math.cos(phi) * r
    data[i + 1] = u * r
    data[i + 2] = s * Math.sin(phi) * r - 4
    data[i + 3] = 1
  }
  tex.needsUpdate = true
}

export function createSimulation(gl: THREE.WebGLRenderer, size: number, halfFloat: boolean): Simulation {
  const gpu = new GPUComputationRenderer(size, size, gl)
  if (halfFloat) gpu.setDataType(THREE.HalfFloatType)

  const pos0 = gpu.createTexture()
  const vel0 = gpu.createTexture()
  fillScatter(pos0)
  const home = createHomeTexture(size)

  const posVar: Variable = gpu.addVariable('texturePosition', positionShader, pos0)
  const velVar: Variable = gpu.addVariable('textureVelocity', velocityShader, vel0)
  gpu.setVariableDependencies(posVar, [posVar, velVar])
  gpu.setVariableDependencies(velVar, [posVar, velVar])

  const shared = {
    tFace: { value: null as THREE.Texture | null },
    tMask: { value: null as THREE.Texture | null },
    tHome: { value: home },
    uHasFace: { value: 0 },
    uHand: { value: new THREE.Vector3(0, 0, -100) },
    uHandStrength: { value: 0 },
    uHandRadius: { value: 1.2 },
    uLevels: { value: new THREE.Vector2(0, 1) },
    uTime: { value: 0 },
  }
  const velUniforms = velVar.material.uniforms
  Object.assign(velUniforms, shared, {
    uDelta: { value: 0 },
    uDisperse: { value: 0 },
    uImpulse: { value: 0 },
    uSize: { value: 6 },
    uAspect: { value: 0.75 },
    uView: { value: new THREE.Vector2(10, 8) },
  })
  const posUniforms = posVar.material.uniforms
  posUniforms.uDelta = { value: 0 }

  const error = gpu.init()
  if (error) throw new Error(error)

  const count = size * size
  const geometry = new THREE.BufferGeometry()
  const reference = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    reference[i * 2] = ((i % size) + 0.5) / size
    reference[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size
  }
  // `position` is only needed so three.js knows the draw count.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('reference', new THREE.BufferAttribute(reference, 2))

  const renderUniforms: Record<string, THREE.IUniform> = {
    ...shared,
    texturePosition: { value: null },
    textureVelocity: { value: null },
    uPointSize: { value: 3 },
    uPointScale: { value: 10 },
    uColorMode: { value: 0 },
    uTexel: { value: new THREE.Vector2(1.5 / 256, 1.5 / 256) },
  }
  const material = new THREE.ShaderMaterial({
    uniforms: renderUniforms,
    vertexShader: pointsVertexShader,
    fragmentShader: pointsFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  return {
    points,
    velUniforms,
    posUniforms,
    renderUniforms,
    step() {
      gpu.compute()
      renderUniforms.texturePosition.value = gpu.getCurrentRenderTarget(posVar).texture
      renderUniforms.textureVelocity.value = gpu.getCurrentRenderTarget(velVar).texture
    },
    scatter() {
      fillScatter(pos0)
      for (const rt of posVar.renderTargets) gpu.renderTexture(pos0, rt)
      for (const rt of velVar.renderTargets) gpu.renderTexture(vel0, rt)
    },
    dispose() {
      gpu.dispose()
      home.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
