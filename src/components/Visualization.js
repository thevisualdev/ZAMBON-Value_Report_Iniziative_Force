import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { VisualizationController } from '../js/simulation';
import { GUI } from 'dat.gui';

const config = {
  width: window.innerWidth,
  height: window.innerHeight,
  colors: {
    superTypeColors: d3.scaleOrdinal()
      .domain([
        'Zambon Pharma',      // Pharma division - 23 initiatives (Good Science & Industrial Business Operations)
        'Zambon',             // The Group - 13 initiatives (People Care & Benvivere)
        'Fondazione Zoe',     // Foundation - 9 initiatives
        'Zambon Biotech',     // Biotech division - 8 initiatives (Product Innovation & Valutazione)
        'Openzone',          // Scientific campus - 6 initiatives
        'Zambon Chemicals',   // Chemical division - 5 initiatives (Investimenti)
        'Zambon Open Venture', // Innovation hub - 4 initiatives (Corporate Venture & Open Accelerator)
        'ItaliAssistenza'    // Healthcare services - 2 initiatives (Careapt)
      ])
      .range([
        '#B3BC2C',  // Zambon Pharma (Lime)
        '#559A69',  // Zambon (Green)
        '#438FB5',  // Fondazione Zoe (Light Blue)
        '#2A4E90',  // Zambon Biotech (Royal Blue)
        '#68368C',  // Openzone (Navy Blue)
        '#77247F',  // Zambon Chemicals (Purple)
        '#D21F75',  // Zambon Open Venture (Pink)
        '#AD677A'   // ItaliAssistenza (Light Pink)
      ])
  }
};

// Remove any existing GUI instances before creating new ones
const cleanupGUI = () => {
  // Remove all dat.GUI instances
  const existingGUIs = document.querySelectorAll('.dg.ac');
  existingGUIs.forEach(gui => {
    if (gui.parentElement) {
      gui.parentElement.removeChild(gui);
    }
  });
};

function Visualization() {
  const canvasRef = useRef(null);
  const visualizationRef = useRef(null);

  useEffect(() => {
    // Clean up any existing GUIs before creating new visualization
    cleanupGUI();

    async function initVisualization() {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        const visualization = new VisualizationController(canvas, config);
        visualizationRef.current = visualization;
        
        const response = await fetch('/initiatives.json');
        if (!response.ok) {
          throw new Error('Failed to fetch initiatives data');
        }
        const initiatives = await response.json();
        visualization.setData(initiatives);
      } catch (error) {
        console.error('Error initializing visualization:', error);
      }
    }
    
    initVisualization();
    
    return () => {
      if (visualizationRef.current) {
        visualizationRef.current.dispose();
        visualizationRef.current = null;
      }
      cleanupGUI();
    };
  }, []);
  
  return (
    <div id="visualization-container">
      <canvas ref={canvasRef} />
      <div id="modal" className="modal">
        <div className="modal-content">
          <button className="close-button">&times;</button>
          <div id="initiative-details"></div>
        </div>
      </div>
    </div>
  );
}

export default Visualization; 