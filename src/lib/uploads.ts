const IMAGE_LIMIT = 20 * 1024 * 1024;
const MODEL_LIMIT = 50 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
};

function extension(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

function localReference(value: string): boolean {
  return value.startsWith('#') || /^data:image\/(?:png|jpeg|webp);base64,[\da-z+/=\s]+$/i.test(value);
}

function validateSvg(text: string): void {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) {
    throw new Error('외부 문서나 엔티티를 포함한 SVG는 사용할 수 없습니다. 일반 SVG 이미지로 다시 저장해 주세요.');
  }
  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
    throw new Error('SVG 파일이 손상되었거나 올바른 SVG 이미지가 아닙니다.');
  }
  const blocked = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'animatetransform', 'animatemotion', 'set']);
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (blocked.has(element.localName.toLowerCase())) {
      throw new Error('스크립트·외부 콘텐츠·애니메이션이 없는 정적인 SVG 이미지를 사용해 주세요.');
    }
    const values = Array.from(element.attributes).map((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || /(?:javascript|vbscript)\s*:/i.test(value)) {
        throw new Error('스크립트가 포함된 SVG는 사용할 수 없습니다. 이미지 전용 SVG로 다시 저장해 주세요.');
      }
      if ((name === 'href' || name === 'xlink:href' || name === 'src') && value && !localReference(value)) {
        throw new Error('외부 파일을 참조하는 SVG는 사용할 수 없습니다. 이미지를 SVG 안에 포함해 주세요.');
      }
      return value;
    });
    if (element.localName.toLowerCase() === 'style') values.push(element.textContent ?? '');
    for (const value of values) {
      if (/@import|expression\s*\(/i.test(value) || (element.localName.toLowerCase() === 'style' && value.includes('\\'))) {
        throw new Error('외부 스타일이나 스크립트가 없는 SVG 이미지를 사용해 주세요.');
      }
      for (const match of value.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi)) {
        if (!localReference(match[1].trim())) {
          throw new Error('외부 리소스를 참조하는 SVG는 사용할 수 없습니다. 모든 리소스를 파일 안에 포함해 주세요.');
        }
      }
    }
  }
}

export async function validatePattern(file: File): Promise<void> {
  const type = IMAGE_TYPES[extension(file)];
  if (!type || (file.type && !Object.values(IMAGE_TYPES).includes(file.type) && file.type !== 'application/octet-stream')) {
    throw new Error('PNG, JPG, WEBP 또는 SVG 이미지 파일을 선택해 주세요.');
  }
  if (!file.size) throw new Error('비어 있는 이미지 파일입니다. 다른 파일을 선택해 주세요.');
  if (file.size > IMAGE_LIMIT) throw new Error('패턴 이미지는 최대 20MB까지 업로드할 수 있습니다.');
  if (type === 'image/svg+xml') validateSvg(await file.text());
  const image = new Image();
  const url = URL.createObjectURL(new Blob([file], { type }));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('이미지를 읽는 시간이 초과되었습니다. 더 작은 파일을 사용해 주세요.')), 15000);
      image.onload = () => {
        window.clearTimeout(timeout);
        if (!image.naturalWidth || !image.naturalHeight) reject(new Error('이미지의 크기를 확인할 수 없습니다.'));
        else if (image.naturalWidth > 16384 || image.naturalHeight > 16384) reject(new Error('이미지 한 변은 최대 16,384픽셀까지 사용할 수 있습니다.'));
        else resolve();
      };
      image.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('이미지를 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.'));
      };
      image.src = url;
    });
  } finally {
    image.onload = null;
    image.onerror = null;
    URL.revokeObjectURL(url);
  }
}

export async function validateModel(file: File): Promise<void> {
  if (extension(file) !== 'glb') throw new Error('3D 모델은 GLB 형식만 지원합니다. .glb 파일을 선택해 주세요.');
  if (file.size > MODEL_LIMIT) throw new Error('GLB 모델은 최대 50MB까지 업로드할 수 있습니다.');
  if (file.size < 20) throw new Error('GLB 파일이 비어 있거나 손상되었습니다.');
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('올바른 GLB 2.0 파일이 아닙니다. 모델을 GLB 형식으로 다시 내보내 주세요.');
  }
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a || jsonLength % 4 !== 0 || 20 + jsonLength > buffer.byteLength) {
    throw new Error('GLB 모델의 구조를 읽을 수 없습니다. 파일을 다시 내보내 주세요.');
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).replace(/\0+$/, '').trim());
  } catch {
    throw new Error('GLB 모델 정보가 손상되었습니다. 파일을 다시 내보내 주세요.');
  }
  if (typeof json !== 'object' || json === null || !('asset' in json)) {
    throw new Error('GLB 모델 정보가 누락되었습니다. 다른 파일을 선택해 주세요.');
  }
  const gltf = json as { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[]; extensionsRequired?: string[] };
  if (gltf.asset?.version !== '2.0') throw new Error('GLTF 2.0 모델을 포함하는 GLB 파일을 사용해 주세요.');
  if ((gltf.buffers !== undefined && !Array.isArray(gltf.buffers))
    || (gltf.images !== undefined && !Array.isArray(gltf.images))
    || (gltf.extensionsRequired !== undefined && !Array.isArray(gltf.extensionsRequired))) {
    throw new Error('GLB 모델의 리소스 목록이 올바르지 않습니다. 모델을 다시 내보내 주세요.');
  }
  for (const resource of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
    if (typeof resource !== 'object' || resource === null || (resource.uri !== undefined && typeof resource.uri !== 'string')) {
      throw new Error('GLB 모델의 리소스 정보가 손상되었습니다. 모델을 다시 내보내 주세요.');
    }
    if (resource.uri && !/^data:/i.test(resource.uri)) {
      throw new Error('외부 파일을 참조하는 모델입니다. 텍스처와 데이터를 모두 포함한 GLB로 내보내 주세요.');
    }
  }
  const unsupported = (gltf.extensionsRequired ?? []).find((item) => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(item));
  if (unsupported) {
    throw new Error('이 모델의 압축 형식은 지원하지 않습니다. Draco·Meshopt·KTX2 압축을 해제한 GLB로 내보내 주세요.');
  }
  let offset = 20 + jsonLength;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) throw new Error('GLB 데이터가 중간에서 끊어졌습니다.');
    const length = view.getUint32(offset, true);
    if (length % 4 !== 0 || offset + 8 + length > buffer.byteLength) throw new Error('GLB 데이터의 길이가 올바르지 않습니다.');
    offset += 8 + length;
  }
}
