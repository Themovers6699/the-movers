import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import App from './App';import './style.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
// Lets phones and tablets install the app. The worker caches nothing (see public/sw.js).
if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{})});