import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Lobby } from './Lobby';
import { PlayPage } from './PlayPage';
import { SplashScreen } from 'digital-boardgame-framework/client';

// dev-only tools — lazy so they never ship in the normal play bundle
const PolygonAudit = lazy(() =>
  import('./PolygonAudit').then((m) => ({ default: m.PolygonAudit })));
const BoxEditor = lazy(() =>
  import('./BoxEditor').then((m) => ({ default: m.BoxEditor })));
const AlignEditor = lazy(() =>
  import('./AlignEditor').then((m) => ({ default: m.AlignEditor })));

function App() {
  const q = new URLSearchParams(location.search);
  // dev overrides at the TOP. ?dev=boxes = adjust decoration boxes; ?dev=align =
  // align TripleA polygons to the VASSAL map; else the geometry audit
  const dev = q.get('dev');
  if (dev === 'align') {
    return <Suspense fallback={<div style={{ padding: 20 }}>loading…</div>}><AlignEditor /></Suspense>;
  }
  if (dev === 'boxes') {
    return <Suspense fallback={<div style={{ padding: 20 }}>loading…</div>}><BoxEditor /></Suspense>;
  }
  if (dev) {
    return <Suspense fallback={<div style={{ padding: 20 }}>loading audit…</div>}><PolygonAudit /></Suspense>;
  }
  const g = q.get('g');
  const t = q.get('t');
  if (g && t) return <PlayPage gameId={g} token={t} />;
  return <Lobby />;
}

createRoot(document.getElementById('root')!).render(<><SplashScreen title="Axis & Allies Classic" appId="axis-and-allies" /><App /></>);
