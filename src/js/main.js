import { VisualizationController } from './simulation.js';

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
    }
};

async function loadData() {
    try {
        const response = await fetch('initiatives.json');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Errore nel caricamento dei dati:', error);
        return [];
    }
}

export async function init() {
    const initiatives = await loadData();
    
    // Inizializza con opacità 0
    initiatives.forEach(d => {
        d.opacity = 0;
        d.radius = 20;
    });
    
    const canvas = document.getElementById('visualization-canvas');
    const visualization = new VisualizationController(canvas, config);
    
    // Inizializza con i dati
    visualization.setData(initiatives);
    
    // Setup controlli GUI
    const gui = new dat.GUI({ name: 'Controls' });
    visualization.setupControls(gui);
}