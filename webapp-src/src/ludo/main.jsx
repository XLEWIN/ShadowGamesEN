import React from 'react';
import { createRoot } from 'react-dom/client';
import LudoApp from './LudoApp.jsx';
import { tgReady } from '../shared/telegram.js';
import '../index.css';

tgReady();
createRoot(document.getElementById('root')).render(<LudoApp />);
