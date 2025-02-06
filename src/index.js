// src/index.js
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/main.css';

// (Opzionale) Se necessario, attiva il polyfill per process:
// import process from 'process';
// window.process = process;

const rootElement = document.getElementById('root');
const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
