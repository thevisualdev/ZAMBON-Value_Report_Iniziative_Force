import { initializeSimulation } from './simulation.js';
import { setupInteractions } from './interactions.js';
import { setupDebugPanel } from './debug.js';
import { spawnInitiatives } from './simulation.js';

const config = {
    width: window.innerWidth,
    height: window.innerHeight,
    colors: {
        superTypeColors: d3.scaleOrdinal()
            .range([
                '#FF6B6B', '#4ECDC4', '#45B7D1', 
                '#96CEB4', '#FFEEAD', '#FF9F1C',
                '#2EC4B6', '#E71D36', '#011627'
            ].map(color => d3.color(color).brighter(0.2).toString()))
    },
    forces: {
        center: 0.01,
        collision: 0.7,
        grouping: 0.3
    }
};

async function loadData() {
    try {
        const response = await fetch('src/data/initiatives.json');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Errore nel caricamento dei dati:', error);
        return [];
    }
}

async function init() {
    const initiatives = await loadData();
    
    // Inizializza con opacità 0
    initiatives.forEach(d => {
        d.opacity = 0;
        d.radius = 20;
    });
    
    const simulationController = initializeSimulation(initiatives, config);
    setupInteractions(simulationController, config);
    setupDebugPanel(simulationController, config);
    
    // Avvia lo spawn sequenziale
    spawnInitiatives(initiatives, simulationController.nodes, simulationController.simulation, config);
}

// Avvia l'applicazione quando il DOM è pronto
document.addEventListener('DOMContentLoaded', init);