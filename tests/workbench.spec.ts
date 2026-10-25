import { test, expect } from '@playwright/test';

test('실제 장면 조절, A/B 비교, 카메라 잠금과 PNG 내보내기', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const canvas = page.locator('.three-viewport canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-room-size', '5 × 5 × 5');
  await expect(canvas).toHaveAttribute('data-pedestal-size', '1 × 1 × 2.5');
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.getByRole('button', { name: '체크 패턴', exact: true }).click();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before);

  await page.getByRole('spinbutton', { name: '패턴 크기 값', exact: true }).fill('200');
  await page.getByRole('spinbutton', { name: '패턴 크기 값', exact: true }).blur();
  await expect(page.getByRole('spinbutton', { name: '가로 반복 수 값' })).toHaveValue('2');
  await page.getByRole('spinbutton', { name: '가로 반복 수 값' }).fill('8');
  await page.getByRole('spinbutton', { name: '가로 반복 수 값' }).blur();
  await expect(page.getByRole('spinbutton', { name: '패턴 크기 값', exact: true })).toHaveValue('50');

  await page.getByRole('button', { name: 'A 저장', exact: true }).click();
  await page.getByRole('button', { name: '도트 패턴', exact: true }).click();
  await page.getByRole('button', { name: 'B 저장', exact: true }).click();
  await page.getByRole('button', { name: 'A/B 비교', exact: true }).click();
  await expect(page.getByRole('button', { name: '패턴만 비교', exact: true })).toBeVisible();
  await expect(page.locator('.compare-labels > span')).toHaveCount(2);
  await page.getByRole('button', { name: '시점 잠금', exact: true }).click();
  await expect(page.getByRole('button', { name: '시점 잠금', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '이미지 저장', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pattern-room-compare-\d+\.png$/);
  expect(await download.failure()).toBeNull();
  const filePath = await download.path();
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(filePath!);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const dimensions = await canvas.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }));
  expect(png.readUInt32BE(16)).toBe(dimensions.width);
  expect(png.readUInt32BE(20)).toBe(dimensions.height);
  expect(png.length).toBeGreaterThan(10000);
  expect(errors).toEqual([]);
});

test('벽별 패턴과 메모를 유지하고 집중 보기와 초기화를 제공한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: '왼쪽 벽', exact: true }).first().click();
  await page.getByRole('button', { name: '격자 패턴', exact: true }).click();
  await expect(page.getByRole('switch', { name: '두 벽 설정 연결' })).toHaveAttribute('aria-checked', 'false');
  await page.getByLabel('관찰 노트', { exact: false }).first().fill('격자가 화병의 부드러운 곡선을 강조한다.');
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('관찰 노트', { exact: false }).first()).toHaveValue('격자가 화병의 부드러운 곡선을 강조한다.');
  await expect(page.getByRole('button', { name: '격자 패턴', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '집중 보기', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '패턴 설정' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: '패턴 설정' })).toBeVisible();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.getByRole('button', { name: '전체 초기화', exact: true }).click();
  await expect(page.getByLabel('관찰 노트', { exact: false }).first()).toHaveValue('');
  await expect(page.getByRole('button', { name: '웨이브 패턴', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('좁은 화면에서도 패널을 열고 장면을 조작할 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '패턴', exact: true }).click();
  await page.getByRole('button', { name: '스트라이프 패턴', exact: true }).click();
  await page.getByRole('button', { name: '패턴 패널 닫기', exact: true }).click();
  await page.getByRole('button', { name: '오브젝트', exact: true }).click();
  await page.getByRole('button', { name: '링 오브젝트', exact: true }).click();
  await expect(page.getByRole('button', { name: '링 오브젝트', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '오브젝트 패널 닫기', exact: true }).click();
  await page.screenshot({ path: '/tmp/pattern-room-mobile.png', fullPage: true });
});
