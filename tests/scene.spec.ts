import { test, expect } from '@playwright/test';

/** A deliberately offset, rotated and nonuniformly scaled GLB; no external assets. */
function transformedBoxGlb(): number[] {
  const positions = new Float32Array([
    -1, -2, -0.5, 1, -2, -0.5, 1, 2, -0.5, -1, 2, -0.5,
    -1, -2, 0.5, 1, -2, 0.5, 1, 2, 0.5, -1, 2, 0.5,
  ]);
  const indices = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [9, 2, -7], rotation: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)], scale: [1, 2, 0.5] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.95, 0.25, 0.1, 1], metallicFactor: 0.1, roughnessFactor: 0.5 } }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, -2, -0.5], max: [1, 2, 0.5] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }],
  }));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const jsonChunk = Buffer.concat([json, jsonPadding]);
  const result = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonChunk.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + jsonChunk.length);
  result.writeUInt32LE(0x004e4942, 24 + jsonChunk.length);
  binary.copy(result, 28 + jsonChunk.length);
  return Array.from(result);
}

test('all built-in objects rest exactly on the pedestal; the vase is one unit tall', async ({ page }) => {
  await page.goto('/');
  const bounds = await page.evaluate(async () => {
    const objectPath = '/src/scene/objects.ts';
    const defaultsPath = '/src/defaults.ts';
    const threePath = '/node_modules/three/build/three.module.js';
    const { createObject, disposeObject } = await import(objectPath) as typeof import('../src/scene/objects');
    const { createExperiment } = await import(defaultsPath) as typeof import('../src/defaults');
    const THREE = await import(threePath) as typeof import('three');
    const kinds = ['vase', 'sphere', 'cube', 'torus', 'sculpture'] as const;
    const measured = [];
    for (const kind of kinds) {
      const object = await createObject({ ...createExperiment().object, kind }, async () => undefined);
      object.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      measured.push({ kind, minY: bounds.min.y, centerX: center.x, centerZ: center.z, width: size.x, depth: size.z, height: size.y });
      disposeObject(object);
    }
    return measured;
  });
  expect(bounds).toHaveLength(5);
  for (const result of bounds) {
    expect(result.minY, result.kind).toBeCloseTo(2.5, 5);
    expect(result.centerX, result.kind).toBeCloseTo(0, 5);
    expect(result.centerZ, result.kind).toBeCloseTo(0, 5);
    expect(result.width, result.kind).toBeLessThanOrEqual(0.80001);
    expect(result.depth, result.kind).toBeLessThanOrEqual(0.80001);
  }
  expect(bounds.find((item) => item.kind === 'vase')!.height).toBeCloseTo(1, 5);
});

test('transformed GLB keeps its proportions and original material, centered with its floor at 2.5', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (bytes) => {
    const objectPath = '/src/scene/objects.ts';
    const defaultsPath = '/src/defaults.ts';
    const threePath = '/node_modules/three/build/three.module.js';
    const { createObject, updateObject, disposeObject } = await import(objectPath) as typeof import('../src/scene/objects');
    const { createExperiment } = await import(defaultsPath) as typeof import('../src/defaults');
    const THREE = await import(threePath) as typeof import('three');
    const settings = { ...createExperiment().object, kind: 'upload' as const, assetId: 'test-glb' };
    const object = await createObject(settings, async () => new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' }));
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    let materialColor: number[] = [];
    object.traverse((child) => {
      if (child.type === 'Mesh') {
        const material = (child as import('three').Mesh).material as import('three').MeshStandardMaterial;
        materialColor = material.color.toArray();
      }
    });
    updateObject(object, { ...settings, rotation: 37, scale: 100 });
    object.updateMatrixWorld(true);
    const enlargedBounds = new THREE.Box3().setFromObject(object);
    const value = { minY: bounds.min.y, center: center.toArray(), size: size.toArray(), materialColor, enlargedMinY: enlargedBounds.min.y, enlargedMaxY: enlargedBounds.max.y };
    disposeObject(object);
    return value;
  }, transformedBoxGlb());
  expect(result.minY).toBeCloseTo(2.5, 5);
  expect(result.center[0]).toBeCloseTo(0, 5);
  expect(result.center[2]).toBeCloseTo(0, 5);
  expect(Math.max(result.size[0], result.size[2])).toBeLessThanOrEqual(0.80001);
  expect(result.size[1]).toBeLessThanOrEqual(1.80001);
  // Source extents: rotated 2 × 8 × 0.5 box has x=z=2.5/sqrt(2).
  expect(result.size[0] / result.size[1]).toBeCloseTo((2.5 / Math.sqrt(2)) / 8, 5);
  expect(result.materialColor).toEqual([0.95, 0.25, 0.1]);
  expect(result.enlargedMinY).toBeCloseTo(2.5, 5);
  expect(result.enlargedMaxY).toBeLessThanOrEqual(4.85001);
});

test('non-square uploaded patterns retain pixel aspect after 0, 45 and 90 degree rotations', async ({ page }) => {
  await page.goto('/');
  const transformed = await page.evaluate(async () => {
    const patternsPath = '/src/scene/patterns.ts';
    const defaultsPath = '/src/defaults.ts';
    const threePath = '/node_modules/three/build/three.module.js';
    const { createPatternTexture } = await import(patternsPath) as typeof import('../src/scene/patterns');
    const { DEFAULT_PATTERN } = await import(defaultsPath) as typeof import('../src/defaults');
    const THREE = await import(threePath) as typeof import('three');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="100" cy="50" r="25" fill="black"/></svg>';
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const results = [];
    for (const rotation of [0, 45, 90]) {
      const texture = (await createPatternTexture({ ...DEFAULT_PATTERN, kind: 'upload', assetId: 'test-image', repeat: 3.5, rotation }, async () => blob))!;
      const inverse = texture.matrix.clone().invert();
      const origin = new THREE.Vector2(0.5, 0.5).applyMatrix3(inverse);
      // One source pixel in either axis must have the same physical wall length.
      const horizontal = new THREE.Vector2(0.5 + 1 / 200, 0.5).applyMatrix3(inverse).sub(origin);
      const vertical = new THREE.Vector2(0.5, 0.5 + 1 / 100).applyMatrix3(inverse).sub(origin);
      results.push({ rotation, pixelRatio: horizontal.length() / vertical.length(), dot: horizontal.dot(vertical), repeat: texture.repeat.toArray(), fixedMatrix: !texture.matrixAutoUpdate });
      texture.dispose();
    }
    return results;
  });
  for (const result of transformed) {
    expect(result.pixelRatio, `${result.rotation}°`).toBeCloseTo(1, 6);
    expect(result.dot, `${result.rotation}°`).toBeCloseTo(0, 8);
    expect(result.repeat).toEqual([3.5, 7]);
    expect(result.fixedMatrix).toBe(true);
  }
});

test('actual room meshes have exact proportions and the two wall patterns unfold without mirroring', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const enginePath = '/src/scene/engine.ts';
    const threePath = '/node_modules/three/build/three.module.js';
    const { SceneEngine } = await import(enginePath) as typeof import('../src/scene/engine');
    const THREE = await import(threePath) as typeof import('three');
    const host = document.createElement('div');
    Object.assign(host.style, { width: '400px', height: '400px', position: 'fixed', left: '-1000px' });
    document.body.appendChild(host);
    const engine = new SceneEngine(host, { onCameraChange() {}, onError() {}, onLoading() {} });
    const scene = (Reflect.get(engine, 'rooms') as { scene: import('three').Scene }[])[0].scene;
    scene.updateMatrixWorld(true);
    const measure = (name: string) => {
      const mesh = scene.getObjectByName(name)!;
      const box = new THREE.Box3().setFromObject(mesh);
      return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
    };
    const left = scene.getObjectByName('room-left-wall') as import('three').Mesh;
    const back = scene.getObjectByName('room-back-wall') as import('three').Mesh;
    const coordinates = (mesh: import('three').Mesh) => {
      const positions = mesh.geometry.attributes.position;
      const uvs = mesh.geometry.attributes.uv;
      return Array.from({ length: positions.count }, (_, index) => {
        const p = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
        return { x: p.x, y: p.y, z: p.z, u: uvs.getX(index), v: uvs.getY(index) };
      });
    };
    const value = { floor: measure('room-floor'), pedestal: measure('room-pedestal'), back: measure('room-back-wall'), left: measure('room-left-wall'), leftUVs: coordinates(left), backUVs: coordinates(back), opaqueMeshCount: scene.children.filter(item => item.type === 'Mesh').length };
    engine.dispose(); host.remove();
    return value;
  });
  expect(result.floor.size[0]).toBeCloseTo(5);
  expect(result.floor.size[2]).toBeCloseTo(5);
  expect(result.back.size[0]).toBeCloseTo(5);
  expect(result.back.size[1]).toBeCloseTo(5);
  expect(result.left.size[2]).toBeCloseTo(5);
  expect(result.left.size[1]).toBeCloseTo(5);
  expect(result.pedestal.size).toEqual([1, 2.5, 1]);
  expect(result.pedestal.min).toEqual([-.5, 0, -.5]);
  expect(result.pedestal.max).toEqual([.5, 2.5, .5]);
  expect(result.opaqueMeshCount).toBe(4);
  for (const point of result.leftUVs) {
    expect(point.u).toBeCloseTo((-point.z - 2.5) / 5);
    if (Math.abs(point.z + 2.5) < 0.001) expect(point.u).toBe(0);
  }
  for (const point of result.backUVs) expect(point.u).toBeCloseTo((point.x + 2.5) / 5);
});
