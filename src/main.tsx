import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The installed Windows/Android/iOS apps ship their files locally and need no service worker.
const isNativeShell = 'Capacitor' in window || location.protocol === 'app:';
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeShell) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
