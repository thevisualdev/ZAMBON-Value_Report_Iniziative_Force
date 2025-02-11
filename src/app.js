import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import dat from 'dat.gui';
import { VisualizationController } from './js/simulation';
import './styles/main.css';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import ImageEditor from './components/ImageEditor';
import Visualization from './components/Visualization';
import Navigation from './components/Navigation';

const config = {
  width: window.innerWidth,
  height: window.innerHeight,
  colors: {
    superTypeColors: d3.scaleOrdinal()
      .range([
        '#559A69', '#E83D30', '#BB74EA', '#77247F',
        '#2A4E90', '#E77E9B', '#438FB5', '#D21F75'
      ].map(color => d3.color(color).toString()))
  }
};

// Helper function to clean up GUI
const cleanupGUI = () => {
  console.log('Cleaning up GUI...'); // Debug log
  const existingGUIs = document.querySelectorAll('.dg.ac');
  existingGUIs.forEach(gui => {
    console.log('Removing GUI:', gui); // Debug log
    gui.remove();
  });
};

// Route change handler component
function RouteChangeHandler() {
  const location = useLocation();
  
  useEffect(() => {
    console.log('Route changed, cleaning up GUI'); // Debug log
    cleanupGUI();
  }, [location]);
  
  return null;
}

function App() {
  const canvasRef = useRef(null);
  const visualizationRef = useRef(null);

  useEffect(() => {
    async function initVisualization() {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        // Imposta le dimensioni del canvas
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Crea l'istanza della visualizzazione
        const visualization = new VisualizationController(canvas, config);
        visualizationRef.current = visualization;
        
        // Carica i dati dal file JSON
        const response = await fetch('/initiatives.json');
        const initiatives = await response.json();
        
        // Inizializza la visualizzazione con i dati
        visualization.setData(initiatives);
        
        // NOTA: NON chiamare qui setupControls(gui) perché la GUI viene già configurata internamente
      } catch (error) {
        console.error('Error initializing visualization:', error);
      }
    }
    
    initVisualization();
    
    // Cleanup (se necessario)
    return () => {
      if (visualizationRef.current) {
        // Inserisci qui eventuale codice di cleanup
      }
    };
  }, []);

  // Clean up any existing GUI on mount
  useEffect(() => {
    cleanupGUI();
    return () => cleanupGUI();
  }, []);

  return (
    <Router>
      <Navigation />
      <RouteChangeHandler />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/visualization" element={<Visualization />} />
        <Route path="/editor" element={<ImageEditor />} />
      </Routes>
      <div id="visualization-container">
        <canvas ref={canvasRef} />
        <div id="modal" className="modal">
          <div className="modal-content">
            <button className="close-button">&times;</button>
            <div id="initiative-details"></div>
          </div>
        </div>
      </div>
    </Router>
  );
}

export default App;
