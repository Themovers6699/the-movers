import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import App from './App';import ProposalPage from './ProposalPage';import './style.css';
// Customers open their Written Proposal from the email link (?agree=...) without logging in.
const agree=new URLSearchParams(location.search).get('agree');
createRoot(document.getElementById('root')!).render(<StrictMode>{agree?<ProposalPage token={agree}/>:<App/>}</StrictMode>);
// Lets phones and tablets install the app. The worker caches nothing (see public/sw.js).
if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{})});