import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const artwork = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><circle cx="40" cy="40" r="28" fill="${color}"/><path d="M95 10h50v60H95z" fill="${color}"/></svg>`;

async function uploadPattern(page: Page, name: string, color: string) {
  await page.getByLabel('패턴 이미지 파일', { exact: true }).setInputFiles({
    name, mimeType: 'image/svg+xml', buffer: Buffer.from(artwork(color)),
  });
  await expect(page.getByRole('button', { name: `${name} 패턴 선택`, exact: true })).toBeVisible();
}

test('uploaded images remain selectable after switching patterns, cleanup, and reopening the page', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await uploadPattern(page, '나의 파란 패턴.svg', '#264dc4');
  await uploadPattern(page, '나의 붉은 패턴.svg', '#c4482b');
  await expect(page.getByRole('button', { name: '나의 붉은 패턴.svg 패턴 선택', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '체크 패턴', exact: true }).click();
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  const stored = await page.evaluate(async () => {
    const path = '/src/lib/storage.ts';
    const storage = await import(path) as typeof import('../src/lib/storage');
    await storage.pruneAssets([]);
    return (await storage.listSavedPatterns()).map(asset => ({ id: asset.id, name: asset.name, bytes: asset.blob.size }));
  });
  expect(stored.map(asset => asset.name)).toEqual(['나의 붉은 패턴.svg', '나의 파란 패턴.svg']);
  expect(stored.every(asset => asset.bytes > 0)).toBe(true);

  const reopened = await context.newPage();
  await page.close();
  await reopened.goto('/');
  const first = reopened.getByRole('button', { name: '나의 파란 패턴.svg 패턴 선택', exact: true });
  const second = reopened.getByRole('button', { name: '나의 붉은 패턴.svg 패턴 선택', exact: true });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const thumbnails = reopened.locator('.pattern-library-grid img');
  await expect(thumbnails).toHaveCount(2);
  await expect.poll(() => thumbnails.evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const canvas = reopened.locator('canvas');
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before);
  await expect(reopened.getByText('자동 저장됨', { exact: true })).toBeVisible();
  await reopened.getByRole('complementary', { name: '패턴 설정' }).getByRole('button', { name: '왼쪽 벽', exact: true }).click();
  await second.click();
  await expect(reopened.getByText('자동 저장됨', { exact: true })).toBeVisible();
  const applied = await reopened.evaluate(async () => {
    const path = '/src/lib/storage.ts';
    const { loadWorkspace } = await import(path) as typeof import('../src/lib/storage');
    const saved = (await loadWorkspace())!;
    return { left: saved.current.left.fileName, back: saved.current.back.fileName, camera: saved.current.camera };
  });
  expect(applied.left).toBe('나의 붉은 패턴.svg');
  expect(applied.back).toBe('나의 파란 패턴.svg');
  expect(applied.camera.position).toEqual([9, 7.5, 10]);
  expect(errors).toEqual([]);
});

test('resetting an experiment keeps the pattern library and its images', async ({ page }) => {
  await page.goto('/');
  await uploadPattern(page, '보관할 패턴.svg', '#46662c');
  await page.getByRole('button', { name: 'A 저장', exact: true }).click();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('내 패턴에 보관한 이미지는 그대로 남습니다.');
  await page.getByRole('button', { name: '전체 초기화', exact: true }).click();
  await expect(page.getByRole('button', { name: '웨이브 패턴', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  const savedPattern = page.getByRole('button', { name: '보관할 패턴.svg 패턴 선택', exact: true });
  await expect(savedPattern).toBeVisible();
  await savedPattern.click();
  await expect(savedPattern).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이미지 저장', exact: true })).toBeEnabled();
});

test('removing a library item preserves the active scene and A/B snapshots', async ({ page }) => {
  await page.goto('/');
  await uploadPattern(page, '기록에 남길 패턴.svg', '#7e418e');
  await page.getByRole('button', { name: 'A 저장', exact: true }).click();
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  const assetId = await page.evaluate(async () => {
    const path = '/src/lib/storage.ts';
    const { loadWorkspace } = await import(path) as typeof import('../src/lib/storage');
    return (await loadWorkspace())!.current.left.assetId!;
  });
  await page.getByRole('button', { name: '기록에 남길 패턴.svg 내 패턴에서 삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: '기록에 남길 패턴.svg 패턴 선택', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '도트 패턴', exact: true }).click();
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  const preserved = await page.evaluate(async id => {
    const path = '/src/lib/storage.ts';
    const storage = await import(path) as typeof import('../src/lib/storage');
    await storage.pruneAssets([]);
    return { image: !!(await storage.resolveAsset(id)), listed: (await storage.listSavedPatterns()).some(asset => asset.id === id) };
  }, assetId);
  expect(preserved).toEqual({ image: true, listed: false });
  await page.reload();
  await expect(page.getByRole('button', { name: '기록에 남길 패턴.svg 패턴 선택', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'A/B 비교', exact: true }).click();
  await expect(page.locator('.compare-labels')).toBeVisible();
  await expect(page.getByRole('button', { name: '이미지 저장', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('existing uploaded assets are adopted by the gallery without including models', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  await page.evaluate(async svg => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pattern-room');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('workspace', 'readwrite');
      const store = transaction.objectStore('workspace');
      store.put({ id: 'legacy-pattern', name: '이전 버전 패턴.svg', type: 'pattern', blob: new Blob([svg], { type: 'image/svg+xml' }) }, 'asset:legacy-pattern');
      store.put({ id: 'legacy-model', name: 'model.glb', type: 'model', blob: new Blob(['not displayed']) }, 'asset:legacy-model');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    const path = '/src/lib/storage.ts';
    const { pruneAssets } = await import(path) as typeof import('../src/lib/storage');
    await pruneAssets([]);
  }, artwork('#9b5a20'));
  await page.reload();
  const migrated = page.getByRole('button', { name: '이전 버전 패턴.svg 패턴 선택', exact: true });
  await expect(migrated).toBeVisible();
  await expect(page.getByRole('button', { name: 'model.glb 패턴 선택', exact: true })).toHaveCount(0);
  await migrated.click();
  await expect(migrated).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
