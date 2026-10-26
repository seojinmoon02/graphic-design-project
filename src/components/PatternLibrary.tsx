import { useEffect, useRef, useState } from 'react';
import { Check, ImageOff, Images, LoaderCircle, Trash2 } from 'lucide-react';
import type { StoredAsset } from '../types';

interface PatternLibraryProps {
  patterns: StoredAsset[];
  selectedAssetId?: string;
  onSelect: (asset: StoredAsset) => void;
  onRemove: (asset: StoredAsset) => Promise<void>;
}

interface PatternTileProps {
  asset: StoredAsset;
  selected: boolean;
  onSelect: PatternLibraryProps['onSelect'];
  onRemove: PatternLibraryProps['onRemove'];
}

function PatternTile({ asset, selected, onSelect, onRemove }: PatternTileProps) {
  const [preview, setPreview] = useState('');
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const currentBlob = useRef(asset.blob);
  currentBlob.current = asset.blob;

  useEffect(() => {
    const url = URL.createObjectURL(asset.blob);
    setPreview(url);
    setFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [asset.blob]);

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await onRemove(asset);
    } catch {
      // The owner reports storage errors and keeps the unchanged library entry.
    } finally {
      setRemoving(false);
    }
  };

  return <div className={`pattern-library-tile ${selected ? 'selected' : ''} ${removing ? 'removing' : ''}`}>
    <button type="button" className="pattern-library-select" aria-label={`${asset.name} 패턴 선택`} aria-pressed={selected}
      title={asset.name} onClick={() => onSelect(asset)} disabled={removing}>
      <span className="pattern-library-preview">
        {preview && !failed && <img src={preview} alt="" loading="lazy" decoding="async" onError={() => { if (currentBlob.current === asset.blob) setFailed(true); }} />}
        {failed && <span className="pattern-library-preview-error"><ImageOff size={17} strokeWidth={1.5} /><span>미리보기 없음</span></span>}
        {selected && <span className="pattern-selected"><Check size={10} strokeWidth={3} /></span>}
      </span>
      <span className="pattern-library-name">{asset.name}</span>
    </button>
    <button type="button" className="pattern-library-remove" aria-label={`${asset.name} 내 패턴에서 삭제`}
      title="내 패턴에서 삭제" onClick={() => void remove()} disabled={removing}>
      {removing ? <LoaderCircle size={12} className="spin" /> : <Trash2 size={12} strokeWidth={1.6} />}
    </button>
  </div>;
}

export default function PatternLibrary({ patterns, selectedAssetId, onSelect, onRemove }: PatternLibraryProps) {
  return <section className="pattern-library" aria-label="내 패턴 보관함">
    <div className="field-label pattern-library-heading"><span>내 패턴</span><span className="muted">{patterns.length > 0 ? `${patterns.length}개 보관` : '나만의 컬렉션'}</span></div>
    {patterns.length > 0 ? <div className="pattern-library-grid">{patterns.map(asset =>
      <PatternTile key={asset.id} asset={asset} selected={selectedAssetId === asset.id} onSelect={onSelect} onRemove={onRemove} />,
    )}</div> : <div className="pattern-library-empty"><Images size={18} strokeWidth={1.3} /><p>업로드한 패턴이 여기에 보관돼요.</p></div>}
    <p className="pattern-library-storage-note">이 브라우저에 자동 저장</p>
  </section>;
}
