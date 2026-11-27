import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import LudoApp from './LudoApp.jsx';
import { tgReady } from '../shared/telegram.js';

tgReady();
createRoot(document.getElementById('root')).render(<LudoApp />);
