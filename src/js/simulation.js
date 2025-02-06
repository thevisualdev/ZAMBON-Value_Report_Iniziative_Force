// src/js/simulation.js

import { CanvasEffects } from './effects.js';

export function initializeSimulation(initiatives, config) {
  // Setup dell'SVG
  const svg = d3.select("#main-svg")
    .attr("width", config.width)
    .attr("height", config.height);

  // Rimuovi eventuali nodi esistenti
  svg.selectAll(".nodes-container").remove();

  const svgGroup = svg.append("g")
    .attr("class", "nodes-container");

  // Inizializzazione dei dati: posizione e raggio
  initiatives.forEach(d => {
    d.radius = 20;
    d.x = config.width / 2;
    d.y = config.height / 2;
  });

  // Definizione dei centri per il raggruppamento per supertype
  const superTypes = [...new Set(initiatives.map(d => d.supertype))];
  const centers = {};
  const padding = 100;
  const usableWidth = config.width - (padding * 2);
  const usableHeight = config.height - (padding * 2);

  superTypes.forEach((type, i) => {
    const angle = (i / superTypes.length) * 2 * Math.PI;
    const radius = Math.min(usableWidth, usableHeight) / 3;
    centers[type] = {
      x: (config.width / 2) + radius * Math.cos(angle),
      y: (config.height / 2) + radius * Math.sin(angle)
    };
  });

  // Creazione dei nodi
  const nodes = svgGroup.selectAll(".node")
    .data(initiatives)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("r", d => d.radius)
    .attr("fill", d => config.colors.superTypeColors(d.supertype))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1)
    .attr("opacity", 1);

  // Setup della simulazione con forze bilanciate
  const simulation = d3.forceSimulation(initiatives)
    .force("center", d3.forceCenter(config.width / 2, config.height / 2).strength(0.01))
    .force("charge", d3.forceManyBody().strength(-150).distanceMin(30).distanceMax(500))
    .force("collision", d3.forceCollide().radius(d => d.radius * 1.2).strength(0.7))
    .force("x", d3.forceX(config.width / 2).strength(0.05))
    .force("y", d3.forceY(config.height / 2).strength(0.05))
    .alphaTarget(0)
    .alphaDecay(0.02)
    .velocityDecay(0.4);

  // Inizializza gli effetti sullo sfondo
  const effects = new CanvasEffects('background-canvas', config);

  // Funzione di aggiornamento (tick) della simulazione
  function ticked() {
    nodes
      .attr("cx", d => d.x = Math.max(d.radius, Math.min(config.width - d.radius, d.x)))
      .attr("cy", d => d.y = Math.max(d.radius, Math.min(config.height - d.radius, d.y)));

    // Aggiorna gli effetti visivi con le posizioni attuali dei nodi
    effects.update(nodes);
  }

  simulation.on("tick", ticked);

  return {
    simulation,
    nodes,
    centers,
    effects,
    activateGrouping: (strength = 0.3) => {
      simulation
        .force("x", d3.forceX(d => centers[d.supertype]?.x || config.width / 2).strength(strength))
        .force("y", d3.forceY(d => centers[d.supertype]?.y || config.height / 2).strength(strength))
        .force("center", null) // Rimuove la forza centrale durante il raggruppamento
        .alpha(1)
        .restart();
    },
    deactivateGrouping: () => {
      simulation
        .force("x", d3.forceX(config.width / 2).strength(0.05))
        .force("y", d3.forceY(config.height / 2).strength(0.05))
        .force("center", d3.forceCenter(config.width / 2, config.height / 2).strength(0.01))
        .alpha(1)
        .restart();
    }
  };
}

export function spawnInitiatives(initiatives, nodes, simulation, config) {
  const delay = 500;
  const duration = 1000;

  // Nascondi inizialmente tutti i nodi
  nodes.attr("r", 0).attr("opacity", 0);

  initiatives.forEach((d, i) => {
    setTimeout(() => {
      // Posiziona il nodo al centro prima dell'animazione
      d.x = config.width / 2;
      d.y = config.height / 2;

      d3.select(nodes.nodes()[i])
        .transition()
        .duration(duration)
        .ease(d3.easeCubicOut)
        .attr("r", d.radius)
        .attr("opacity", 1)
        .on("end", () => {
          simulation.alpha(0.1).restart();
        });
    }, i * delay);
  });
}
