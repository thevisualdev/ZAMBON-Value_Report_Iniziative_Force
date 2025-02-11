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
        'Italiassistenza',
        'Zcube',
        'Openzone',
        'Zach',
        'Zambon Pharma',
        'The Group',
        'Zambon Biotech',
        'Zoé Foundation'
      ])
      .range([
        '#C3CF19',  // Italiassistenza
        '#559A69',  // Zcube
        '#438FB5',  // Openzone
        '#2A4E90',  // Zach
        '#282C68',  // Zambon Pharma
        '#77247F',  // The Group
        '#D21F75',  // Zambon Biotech
        '#E77E9B'   // Zoé Foundation
      ])
  }
};

// Remove any existing GUI instances before creating new ones
const cleanupGUI = () => {
  const existingGUI = document.querySelector('.dg.visualization-gui');
  if (existingGUI) {
    existingGUI.remove();
  }
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

        // Force GUI to be visible and properly positioned
        const guiElement = document.querySelector('.dg.visualization-gui');
        if (guiElement) {
          guiElement.style.display = 'block';
          guiElement.style.position = 'fixed';
          guiElement.style.top = '20px';
          guiElement.style.right = '20px';
          guiElement.style.zIndex = '1000';
        }
      } catch (error) {
        console.error('Error initializing visualization:', error);
      }
    }
    
    initVisualization();
    
    return () => {
      if (visualizationRef.current) {
        visualizationRef.current.dispose();
        visualizationRef.current = null;
        cleanupGUI();
      }
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