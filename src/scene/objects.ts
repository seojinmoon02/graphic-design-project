import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetResolver, ObjectSettings } from '../types';

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    const list = Array.isArray(child.material) ? child.material : [child.material];
    list.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); });
    });
  });
  const bitmaps = new Set<ImageBitmap>();
  textures.forEach((texture) => {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  });
  bitmaps.forEach((bitmap) => bitmap.close());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  root.removeFromParent();
}

function vaseGeometry() {
  // A closed cross section includes the inner neck and cavity: this is an open vessel.
  const outline = [
    [0, 0], [0.15, 0], [0.24, 0.03], [0.32, 0.15],
    [0.36, 0.3], [0.35, 0.49], [0.29, 0.65], [0.18, 0.78],
    [0.13, 0.86], [0.13, 0.98], [0.125, 1], [0.105, 1],
    [0.105, 0.87], [0.155, 0.78], [0.26, 0.64], [0.315, 0.48],
    [0.325, 0.3], [0.285, 0.16], [0.2, 0.07], [0, 0.07],
  ];
  const curve = new THREE.SplineCurve(outline.map(([r, y]) => new THREE.Vector2(r, y)));
  return new THREE.LatheGeometry(curve.getPoints(120), 96);
}

export async function createObject(settings: ObjectSettings, resolveAsset: AssetResolver) {
  const holder = new THREE.Group();
  let content: THREE.Object3D;
  if (settings.kind === 'upload') {
    if (!settings.assetId) throw new Error('3D 모델 파일을 먼저 선택해 주세요.');
    const blob = await resolveAsset(settings.assetId);
    if (!blob) throw new Error('저장된 3D 모델을 찾을 수 없습니다. 파일을 다시 업로드해 주세요.');
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(await blob.arrayBuffer(), '');
      content = gltf.scene;
    } catch {
      throw new Error('3D 모델을 읽을 수 없습니다. 텍스처가 포함된 올바른 GLB 파일인지 확인해 주세요.');
    }
  } else {
    let geometry: THREE.BufferGeometry;
    switch (settings.kind) {
      case 'sphere': geometry = new THREE.SphereGeometry(0.4, 64, 48); break;
      case 'cube': geometry = new THREE.BoxGeometry(0.76, 0.76, 0.76); break;
      case 'torus': geometry = new THREE.TorusGeometry(0.29, 0.105, 32, 96); break;
      case 'sculpture': geometry = new THREE.TorusKnotGeometry(0.235, 0.095, 160, 32, 2, 3); break;
      default: geometry = vaseGeometry();
    }
    const material = new THREE.MeshPhysicalMaterial({
      color: settings.color, roughness: settings.roughness, metalness: 0,
      clearcoat: settings.gloss, clearcoatRoughness: 0.22, side: THREE.DoubleSide,
    });
    content = new THREE.Mesh(geometry, material);
  }

  content.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(content);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x, size.y, size.z) === 0) {
    disposeObject(content);
    throw new Error('이 모델에는 표시할 수 있는 3D 메쉬가 없습니다.');
  }
  const targetHeight = settings.kind === 'upload' ? 1.8 : 1;
  const fit = Math.min(0.8 / Math.max(size.x, size.z), targetHeight / size.y);
  const center = bounds.getCenter(new THREE.Vector3());
  content.position.x -= center.x;
  content.position.y -= bounds.min.y;
  content.position.z -= center.z;
  const normalization = new THREE.Group();
  normalization.add(content);
  normalization.scale.setScalar(fit);
  holder.add(normalization);
  holder.userData.baseHeight = size.y * fit;
  holder.userData.uploaded = settings.kind === 'upload';
  content.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  updateObject(holder, settings);
  return holder;
}

export function updateObject(object: THREE.Group, settings: ObjectSettings) {
  const safeScale = Math.min(Math.max(0.1, settings.scale), 2.35 / object.userData.baseHeight);
  object.scale.setScalar(safeScale);
  object.position.set(0, 2.5, 0);
  object.rotation.y = THREE.MathUtils.degToRad(settings.rotation);
  if (!object.userData.uploaded) {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshPhysicalMaterial;
      material.color.set(settings.color);
      material.roughness = settings.roughness;
      material.clearcoat = settings.gloss;
    });
  }
}
