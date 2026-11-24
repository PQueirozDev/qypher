import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import App from './App';
import './styles.css';
import './workbench.css';
import './terminal.css';
import './integration.css';
import './hacker.css';
import './review.css';
import './polish.css';
import './boot.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
