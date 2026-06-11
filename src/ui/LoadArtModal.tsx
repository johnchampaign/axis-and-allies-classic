// "Load VASSAL art" modal (pattern from Rebellion's LoadArtModal): directs the
// player to download the official module themselves; we never distribute art.
import { useRef, useState } from 'react';
import {
  clearArt, loadVmodFromFile, useArtLoaded, VMOD_FILE_URL, VMOD_PAGE_URL,
  type LoadProgress,
} from './artCache';

export function LoadArtModal({ onClose }: { onClose: () => void }) {
  const loaded = useArtLoaded();
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setDone(null);
    try {
      const r = await loadVmodFromFile(file, setProgress);
      setDone(r.fileCount);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{ background: '#26323f', borderRadius: 10, padding: 20, maxWidth: 480, color: '#e8e4d8' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Classic board &amp; piece art</h3>
        <p style={{ fontSize: 14 }}>
          This site doesn't host or redistribute Milton Bradley's game art. You can load it
          from your own copy of the free{' '}
          <a href={VMOD_PAGE_URL} target="_blank" rel="noreferrer" style={{ color: '#8ec5ff' }}>
            Axis &amp; Allies VASSAL module
          </a>{' '}
          (<a href={VMOD_FILE_URL} style={{ color: '#8ec5ff' }}>direct download, ~9 MB</a>).
          The images are extracted in your browser and stay on your device — you only do
          this once per browser. (Heads-up: the cache is tied to the site address, so always
          use <code>axis-and-allies-classic.pages.dev</code>; deployment-preview URLs each
          have their own empty cache.)
        </p>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          style={{
            display: 'block', border: `2px dashed ${drag ? '#8ec5ff' : '#557'}`, borderRadius: 8,
            padding: '28px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 10,
          }}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".vmod,.zip,application/zip" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          Drag <code>Axis&amp;allies_2.5.vmod</code> here, or click to choose
          <div style={{ fontSize: 12, opacity: 0.7 }}>(a .vmod is a renamed .zip — we extract its images/ folder in-browser)</div>
        </label>
        {progress && (
          <div>
            {progress.phase}{progress.total ? ` ${progress.done}/${progress.total}` : '…'}
          </div>
        )}
        {error && <div style={{ color: '#f99' }}>⚠ {error}</div>}
        {done !== null && <div style={{ color: '#9f9' }}>✓ Loaded {done} images. Classic art is on.</div>}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {loaded && (
            <button onClick={() => void clearArt()} style={{ cursor: 'pointer' }}>
              Remove cached art
            </button>
          )}
          <button onClick={onClose} style={{ cursor: 'pointer', marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
