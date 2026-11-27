import React from 'react';
import { createRoot } from 'react-dom/client';
import HubApp from './HubApp.jsx';
import { tgReady } from '../shared/telegram.js';
import './HubV4.css';

tgReady();
createRoot(document.getElementById('root')).render(<HubApp />);
