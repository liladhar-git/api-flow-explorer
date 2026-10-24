import './zodConfig';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './shared/shared.css';
import './styles/app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
