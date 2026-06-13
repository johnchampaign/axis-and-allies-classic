import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Lobby } from './Lobby';
import { PlayPage } from './PlayPage';

// dev-only geometry audit — lazy so it never ships in the normal play bundle
const PolygonAudit = lazy(() =>
  import('./PolygonAudit').then((m) => ({ default: m.PolygonAudit })));

function App() {
  const q = new URLSearchParams(location.search);
  // dev override at the TOP: ?dev=polygons (or any ?dev=...) opens the audit
  if (q.get('dev')) {
    return <Suspense fallback={<div style={{ padding: 20 }}>loading audit…</div>}><PolygonAudit /></Suspense>;
  }
  const g = q.get('g');
  const t = q.get('t');
  if (g && t) return <PlayPage gameId={g} token={t} />;
  return <Lobby />;
}

createRoot(document.getElementById('root')!).render(<App />);
