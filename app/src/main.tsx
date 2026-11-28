import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import App from './App';import ProposalPage from './ProposalPage';import ProblemPage from './ProblemPage';import './style.css';
// Customers open these from email links without logging in: Written Proposal (?agree=...), problem report (?problem=...).
const params=new URLSearchParams(location.search),agree=params.get('agree'),problem=params.get('problem');
createRoot(document.getElementById('root')!).render(<StrictMode>{agree?<ProposalPage token={agree}/>:problem?<ProblemPage token={problem}/>:<App/>}</StrictMode>);
// Lets phones and tablets install the app. The worker caches nothing (see public/sw.js).
if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{})});