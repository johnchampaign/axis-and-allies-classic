import { createRoot } from 'react-dom/client';
import { Lobby } from './Lobby';
import { PlayPage } from './PlayPage';

function App() {
  const q = new URLSearchParams(location.search);
  const g = q.get('g');
  const t = q.get('t');
  if (g && t) return <PlayPage gameId={g} token={t} />;
  return <Lobby />;
}

createRoot(document.getElementById('root')!).render(<App />);
