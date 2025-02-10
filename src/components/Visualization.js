import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { VisualizationController } from '../js/simulation';
import { GUI } from 'dat.gui';

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

// Remove any existing GUI instances before creating new ones
const cleanupGUI = () => {
  const existingGUI = document.querySelector('.dg.ac');
  if (existingGUI) {
    existingGUI.remove();
  }
};

function Visualization() {
  const canvasRef = useRef(null);
  const visualizationRef = useRef(null);

  useEffect(() => {
    cleanupGUI(); // Clean up existing GUI instances
    
    async function initVisualization() {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        const visualization = new VisualizationController(canvas, config);
        visualizationRef.current = visualization;
        
        const response = await fetch('/initiatives.json');
        const initiatives = await response.json();
        
        visualization.setData(initiatives);
      } catch (error) {
        console.error('Error initializing visualization:', error);
      }
    }
    
    initVisualization();
    
    return () => {
      cleanupGUI(); // Clean up when component unmounts
      if (visualizationRef.current) {
        // Additional cleanup if needed
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