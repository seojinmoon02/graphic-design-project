import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { AssetResolver, PatternKind, PatternSettings } from '../types';

const INK = '#343a34';
const TILE_SIZE = 512;
const builtinSources = new Map<PatternKind, HTMLCanvasElement>();

/** Transparent, seamless source tiles. Wall colour is composited separately. */
export function generatePatternCanvas(kind: PatternKind): HTMLCanvasElement {
  const cached = builtinSources.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('패턴을 그릴 수 없습니다. 브라우저의 그래픽 설정을 확인해 주세요.');
  context.fillStyle = INK;
  context.strokeStyle = INK;
  switch (kind) {
    case 'stripe':
      context.fillRect(0, 0, TILE_SIZE * 0.32, TILE_SIZE);
      break;
    case 'check':
      context.fillRect(0, 0, TILE_SIZE / 2, TILE_SIZE / 2);
      context.fillRect(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2);
      break;
    case 'dot':
      context.beginPath();
      context.arc(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.125, 0, Math.PI * 2);
      context.fill();
      break;
    case 'grid':
      context.lineWidth = 10;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(TILE_SIZE, 0);
      context.moveTo(0, 0);
      context.lineTo(0, TILE_SIZE);
      context.moveTo(TILE_SIZE, 0);
      context.lineTo(TILE_SIZE, TILE_SIZE);
      context.moveTo(0, TILE_SIZE);
      context.lineTo(TILE_SIZE, TILE_SIZE);
      context.stroke();
      break;
    case 'wave':
      context.lineWidth = 66;
      context.lineCap = 'butt';
      // Extending past both tile borders keeps the repeating wave seamless.
      for (let offset = -1; offset <= 1; offset++) {
        context.beginPath();
        for (let y = -8; y <= TILE_SIZE + 8; y += 2) {
          const x = TILE_SIZE * (0.5 + offset) + Math.sin(y / TILE_SIZE * Math.PI * 2) * 91;
          if (y === -8) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
      break;
    default:
      break;
  }
  builtinSources.set(kind, canvas);
  return canvas;
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('이미지의 크기를 확인할 수 없습니다. 다른 파일을 선택해 주세요.'));
        } else resolve(image);
      };
      image.onerror = () => reject(new Error('이미지를 불러올 수 없습니다. PNG, JPG, WEBP 또는 SVG 파일인지 확인해 주세요.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Returns an owned GPU texture. The caller disposes it when replaced.
 * On a square wall, repeatY = repeatX * imageAspect preserves source proportions.
 */
export async function createPatternTexture(
  settings: PatternSettings,
  resolveAsset: AssetResolver,
): Promise<CanvasTexture | null> {
  if (settings.kind === 'none') return null;
  let source: HTMLCanvasElement | HTMLImageElement;
  if (settings.kind === 'upload') {
    if (!settings.assetId) throw new Error('선택한 패턴 파일이 없습니다. 패턴을 다시 업로드해 주세요.');
    const blob = await resolveAsset(settings.assetId);
    if (!blob) throw new Error('저장한 패턴 파일을 찾을 수 없습니다. 파일을 다시 업로드해 주세요.');
    source = await loadImage(blob);
  } else {
    source = generatePatternCanvas(settings.kind);
  }
  const originalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const originalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const factor = Math.min(1, 2048 / Math.max(originalWidth, originalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(originalWidth * factor));
  canvas.height = Math.max(1, Math.round(originalHeight * factor));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('패턴을 그릴 수 없습니다. 브라우저의 그래픽 설정을 확인해 주세요.');
  context.fillStyle = settings.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = Math.max(0, Math.min(1, settings.opacity / 100));
  context.filter = `brightness(${Math.max(0, settings.brightness)}%) saturate(${Math.max(0, settings.saturation)}%)`;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  const repeats = Math.max(0.1, settings.repeat);
  const aspect = originalWidth / originalHeight;
  texture.repeat.set(repeats, repeats * aspect);
  texture.center.set(0.5, 0.5);
  texture.rotation = -settings.rotation * Math.PI / 180;
  // Rotate in square wall coordinates before converting to source-image UVs.
  // Applying rotation after aspect correction would stretch non-square images.
  // The same centered transform on both walls keeps their corner phase aligned.
  const c = Math.cos(texture.rotation);
  const s = Math.sin(texture.rotation);
  texture.matrixAutoUpdate = false;
  texture.matrix.set(
    repeats * c, repeats * s, 0.5 - repeats * (c + s) * 0.5,
    -repeats * aspect * s, repeats * aspect * c, 0.5 + repeats * aspect * (s - c) * 0.5,
    0, 0, 1,
  );
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
