import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const pattern = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#f4dfbe"/><path d="M0 75H300M150 0V150" stroke="#bc4323" stroke-width="20"/><circle cx="75" cy="37" r="16" fill="#264c7b"/></svg>');

/** A self-contained GLB with an off-center node and a 2 × 4 × 1 box. */
function offsetModel(): Buffer {
  const faces: [number[][], number[]][] = [
    [[[1, -2, -.5], [1, 2, -.5], [1, 2, .5], [1, -2, .5]], [1, 0, 0]],
    [[[-1, -2, .5], [-1, 2, .5], [-1, 2, -.5], [-1, -2, -.5]], [-1, 0, 0]],
    [[[-1, 2, -.5], [-1, 2, .5], [1, 2, .5], [1, 2, -.5]], [0, 1, 0]],
    [[[-1, -2, .5], [-1, -2, -.5], [1, -2, -.5], [1, -2, .5]], [0, -1, 0]],
    [[[-1, -2, .5], [1, -2, .5], [1, 2, .5], [-1, 2, .5]], [0, 0, 1]],
    [[[1, -2, -.5], [-1, -2, -.5], [-1, 2, -.5], [1, 2, -.5]], [0, 0, -1]],
  ];
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  faces.forEach(([vertices, normal], index) => {
    vertices.forEach(vertex => { positions.push(...vertex); normals.push(...normal); });
    indices.push(index * 4, index * 4 + 1, index * 4 + 2, index * 4, index * 4 + 2, index * 4 + 3);
  });
  const geometry = Buffer.alloc(positions.length * 4 + normals.length * 4 + indices.length * 2);
  positions.forEach((n, i) => geometry.writeFloatLE(n, i * 4));
  normals.forEach((n, i) => geometry.writeFloatLE(n, positions.length * 4 + i * 4));
  indices.forEach((n, i) => geometry.writeUInt16LE(n, (positions.length + normals.length) * 4 + i * 2));
  const document = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [9, 2, -7] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [.95, .25, .1, 1], metallicFactor: .1, roughnessFactor: .5 } }],
    buffers: [{ byteLength: geometry.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length * 4, target: 34962 },
      { buffer: 0, byteOffset: positions.length * 4, byteLength: normals.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (positions.length + normals.length) * 4, byteLength: indices.length * 2, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-1, -2, -.5], max: [1, 2, .5] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  const rawJson = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, ' ')]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + geometry.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(geometry.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, binaryHeader, geometry]);
}

test('uploaded pattern and GLB survive A/B snapshots, cleanup and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();

  await page.getByLabel('패턴 이미지 파일', { exact: true }).setInputFiles({ name: 'asymmetric-pattern.svg', mimeType: 'image/svg+xml', buffer: pattern });
  await expect(page.getByText('패턴을 불러왔습니다.', { exact: true })).toBeVisible();
  await expect(page.locator('.file-name').filter({ hasText: 'asymmetric-pattern.svg' })).toBeVisible();
  const model = offsetModel();
  await page.getByLabel('GLB 모델 파일', { exact: true }).setInputFiles({ name: 'offset-box.glb', mimeType: 'model/gltf-binary', buffer: model });
  await expect(page.getByText('모델을 불러왔습니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '이미지 저장', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('관찰 노트', { exact: false }).first().fill('업로드한 패턴과 오프셋 모델: 실험 A');
  await page.getByRole('button', { name: 'A 저장', exact: false }).click();

  await page.getByRole('button', { name: '도트 패턴', exact: true }).click();
  await page.getByRole('button', { name: '큐브 오브젝트', exact: true }).click();
  await page.getByLabel('관찰 노트', { exact: false }).first().fill('기본 도트와 큐브: 실험 B');
  await page.getByRole('button', { name: 'B 저장', exact: false }).click();
  await page.getByRole('button', { name: 'A/B 비교', exact: true }).click();
  await expect(page.locator('.compare-labels')).toBeVisible();
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const modulePath = '/src/lib/storage.ts';
    const storage = await import(modulePath);
    const state = await storage.loadWorkspace();
    await storage.pruneAssets(storage.assetIds(state));
    const patternBlob = await storage.resolveAsset(state.a.left.assetId);
    const modelBlob = await storage.resolveAsset(state.a.object.assetId);
    return {
      compare: state.compare,
      a: [state.a.left.kind, state.a.back.kind, state.a.object.kind, state.a.note],
      b: [state.b.left.kind, state.b.object.kind, state.b.note],
      patternText: await patternBlob?.text(),
      modelSize: modelBlob?.size,
      modelHeader: modelBlob ? Array.from(new Uint8Array(await modelBlob.slice(0, 4).arrayBuffer())) : [],
    };
  });
  expect(persisted.compare).toBe(true);
  expect(persisted.a).toEqual(['upload', 'upload', 'upload', '업로드한 패턴과 오프셋 모델: 실험 A']);
  expect(persisted.b).toEqual(['dot', 'cube', '기본 도트와 큐브: 실험 B']);
  expect(persisted.patternText).toBe(pattern.toString());
  expect(persisted.modelSize).toBe(model.length);
  expect(persisted.modelHeader).toEqual([103, 108, 84, 70]);

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.compare-labels')).toBeVisible();
  await expect(page.getByLabel('A의 관찰 노트', { exact: true })).toHaveValue('업로드한 패턴과 오프셋 모델: 실험 A');
  await expect(page.getByLabel('B의 관찰 노트', { exact: true })).toHaveValue('기본 도트와 큐브: 실험 B');
  await expect(page.getByRole('button', { name: '이미지 저장', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain('pattern-room-compare-');
  const path = await download.path();
  expect(path).not.toBeNull();
  const png = await readFile(path!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBeGreaterThan(100);
  expect(png.readUInt32BE(20)).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('invalid uploads explain the error in Korean without changing the experiment', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  await page.getByLabel('패턴 이미지 파일', { exact: true }).setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(page.getByRole('alert')).toContainText('스크립트');
  await page.getByLabel('GLB 모델 파일', { exact: true }).setInputFiles({ name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('not a model') });
  await expect(page.getByRole('alert')).toContainText('GLB 파일이 비어 있거나 손상');
  await page.getByLabel('패턴 이미지 파일', { exact: true }).setInputFiles({ name: 'not-image.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert')).toContainText('PNG, JPG, WEBP 또는 SVG');
  await expect(page.getByRole('button', { name: '웨이브 패턴', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '화병 오브젝트', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const state = await page.evaluate(async () => {
    const modulePath = '/src/lib/storage.ts';
    const { loadWorkspace } = await import(modulePath);
    const saved = await loadWorkspace();
    return [saved.current.left.kind, saved.current.back.kind, saved.current.object.kind];
  });
  expect(state).toEqual(['wave', 'wave', 'vase']);
});

test('an immediate reload keeps the latest note and uploaded asset references', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  await page.getByLabel('패턴 이미지 파일', { exact: true }).setInputFiles({ name: 'quick-reload.svg', mimeType: 'image/svg+xml', buffer: pattern });
  await expect(page.getByText('패턴을 불러왔습니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '이미지 저장', exact: true })).toBeEnabled();
  const note = '저장 지연을 기다리지 않고 바로 새로고침한 관찰';
  // Fill and navigate in the same browser task: do not wait for the 350ms autosave.
  await page.evaluate((value) => {
    const textarea = document.querySelector<HTMLTextAreaElement>('#experiment-note')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, note);
  await page.reload();
  await expect(page.getByLabel('관찰 노트', { exact: false }).first()).toHaveValue(note);
  await expect(page.locator('.file-name').filter({ hasText: 'quick-reload.svg' })).toBeVisible();
  await expect(page.getByRole('button', { name: '이미지 저장', exact: true })).toBeEnabled();
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/storage.ts';
    const storage = await import(modulePath);
    const saved = await storage.loadWorkspace();
    const blob = await storage.resolveAsset(saved.current.left.assetId);
    return { note: saved.current.note, kind: saved.current.left.kind, bytes: await blob?.text() };
  });
  expect(result).toEqual({ note, kind: 'upload', bytes: pattern.toString() });
});
