import { clear, createStore, delMany, get, keys, set } from 'idb-keyval';
import type { ExperimentState, StoredAsset, WorkspaceState } from '../types';

const store = createStore('pattern-room', 'workspace');
const WORKSPACE_KEY = 'workspace:v1';
const BACKUP_KEY = 'pattern-room:workspace:v1';
const ASSET_PREFIX = 'asset:';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const vector = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(finite);

function validPattern(value: unknown): boolean {
  if (!record(value)) return false;
  return ['wave', 'stripe', 'check', 'dot', 'grid', 'none', 'upload'].includes(String(value.kind))
    && ['repeat', 'rotation', 'brightness', 'saturation', 'opacity'].every((key) => finite(value[key]))
    && Number(value.repeat) > 0 && color(value.background)
    && (value.kind !== 'upload' || typeof value.assetId === 'string');
}

function validExperiment(value: unknown): value is ExperimentState {
  if (!record(value) || !record(value.object) || !record(value.camera)) return false;
  const object = value.object;
  const camera = value.camera;
  return validPattern(value.left) && validPattern(value.back)
    && typeof value.linked === 'boolean' && ['both', 'left', 'back'].includes(String(value.target))
    && ['vase', 'sphere', 'cube', 'torus', 'sculpture', 'upload'].includes(String(object.kind))
    && ['scale', 'rotation', 'roughness', 'gloss'].every((key) => finite(object[key]))
    && Number(object.scale) > 0 && color(object.color)
    && (object.kind !== 'upload' || typeof object.assetId === 'string')
    && finite(value.light) && typeof value.shadows === 'boolean'
    && color(value.floor) && color(value.pedestal)
    && vector(camera.position) && vector(camera.target) && finite(camera.zoom) && Number(camera.zoom) > 0
    && typeof value.cameraLocked === 'boolean' && typeof value.note === 'string';
}

function validWorkspace(value: unknown): value is WorkspaceState {
  if (!record(value)) return false;
  return value.version === 1 && validExperiment(value.current)
    && (value.a === null || validExperiment(value.a))
    && (value.b === null || validExperiment(value.b))
    && typeof value.compare === 'boolean' && typeof value.patternOnly === 'boolean';
}

function storageError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new Error('브라우저 저장 공간이 부족합니다. 더 작은 파일을 사용하거나 필요 없는 실험을 초기화해 주세요.');
  }
  return new Error('이 브라우저에 작업을 저장하지 못했습니다. 브라우저의 사이트 저장 공간 허용 여부를 확인해 주세요.');
}

function localWorkspace(): WorkspaceState | undefined {
  try {
    const json = localStorage.getItem(BACKUP_KEY);
    if (!json) return undefined;
    const value: unknown = JSON.parse(json);
    return validWorkspace(value) ? value : undefined;
  } catch {
    // Private browsing, a disabled Storage API, or a corrupt backup must not block IndexedDB.
    return undefined;
  }
}

/** Synchronous metadata backup closes the gap before the debounced IndexedDB write. */
export function rememberWorkspace(state: WorkspaceState): void {
  try {
    // State contains asset IDs only. Uploaded bytes always remain in IndexedDB.
    localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
  } catch {
    // Best effort: IndexedDB remains the primary durable store if localStorage is unavailable.
  }
}

/** Undefined is a first visit. An invalid saved record is reported, never trusted. */
export async function loadWorkspace(): Promise<WorkspaceState | undefined> {
  const backup = localWorkspace();
  if (backup) return backup;
  let saved: unknown;
  try {
    saved = await get<unknown>(WORKSPACE_KEY, store);
  } catch (error) {
    throw storageError(error);
  }
  if (saved === undefined) return undefined;
  if (!validWorkspace(saved)) {
    throw new Error('저장된 실험 형식을 읽을 수 없습니다. 새 실험으로 시작하거나 전체 초기화를 진행해 주세요.');
  }
  return saved;
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  // Also update the backup for direct callers, so it cannot mask newer durable data.
  rememberWorkspace(state);
  try {
    await set(WORKSPACE_KEY, structuredClone(state), store);
  } catch (error) {
    throw storageError(error);
  }
}

export async function saveAsset(asset: StoredAsset): Promise<void> {
  try {
    await set(`${ASSET_PREFIX}${asset.id}`, asset, store);
  } catch (error) {
    throw storageError(error);
  }
}

export async function resolveAsset(id: string): Promise<Blob | undefined> {
  try {
    const asset = await get<StoredAsset>(`${ASSET_PREFIX}${id}`, store);
    return asset?.blob instanceof Blob ? asset.blob : undefined;
  } catch (error) {
    throw storageError(error);
  }
}

/** Include every snapshot so swapping an object cannot invalidate a saved experiment. */
export function assetIds(state: WorkspaceState): string[] {
  const result = new Set<string>();
  for (const experiment of [state.current, state.a, state.b]) {
    if (!experiment) continue;
    for (const pattern of [experiment.left, experiment.back]) {
      if (pattern.kind === 'upload' && pattern.assetId) result.add(pattern.assetId);
    }
    if (experiment.object.kind === 'upload' && experiment.object.assetId) result.add(experiment.object.assetId);
  }
  return [...result];
}

export async function pruneAssets(keepIds: string[]): Promise<void> {
  try {
    // A caller may have unsaved state; always also protect the latest durable A/B snapshots.
    const saved = await get<unknown>(WORKSPACE_KEY, store);
    const retained = new Set(keepIds);
    if (validWorkspace(saved)) assetIds(saved).forEach((id) => retained.add(id));
    const backup = localWorkspace();
    if (backup) assetIds(backup).forEach((id) => retained.add(id));
    const allKeys = await keys(store);
    const obsolete = allKeys.filter((key) => typeof key === 'string'
      && key.startsWith(ASSET_PREFIX) && !retained.has(key.slice(ASSET_PREFIX.length)));
    if (obsolete.length) await delMany(obsolete, store);
  } catch (error) {
    throw storageError(error);
  }
}

export async function clearWorkspace(): Promise<void> {
  try { localStorage.removeItem(BACKUP_KEY); } catch { /* IndexedDB may still be available. */ }
  try {
    await clear(store);
  } catch (error) {
    throw storageError(error);
  }
}
