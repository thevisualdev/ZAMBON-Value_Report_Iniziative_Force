export function setupDebugPanel(simulationController, config) {
    // Rimuovi eventuali GUI esistenti
    const existingGui = document.querySelector('.dg.ac');
    if (existingGui) {
        existingGui.remove();
    }

    const gui = new dat.GUI();
    const params = {
        forces: {
            center: config.forces.center,
            nodeRepulsion: -200,
            collisionStrength: config.forces.collision
        },
        visual: {
            nodeRadius: 20,
            nodeOpacity: 1,
            strokeWidth: 1
        },
        utils: {
            reheat: () => {
                simulationController.simulation.alpha(1).restart();
            },
            resetForces: () => {
                resetToDefaults();
            },
            pauseSimulation: false
        },
        grouping: {
            isGrouped: false,
            strength: 0.3,
            centerForce: 0.01
        }
    };

    // Folder per le forze
    const forcesFolder = gui.addFolder('Forces');
    forcesFolder.open();
    
    forcesFolder.add(params.forces, 'center', -1, 1)
        .name('Center Attraction')
        .step(0.01)
        .onChange(value => {
            simulationController.simulation.force("center").strength(value);
            simulationController.simulation.alpha(0.3).restart();
        });

    forcesFolder.add(params.forces, 'nodeRepulsion', -200, 200)
        .name('Node Repulsion')
        .step(1)
        .onChange(value => {
            simulationController.simulation.force("charge").strength(value);
            simulationController.simulation.alpha(0.3).restart();
        });

    forcesFolder.add(params.forces, 'collisionStrength', 0, 2)
        .name('Collision')
        .step(0.01)
        .onChange(value => {
            simulationController.simulation.force("collision").strength(value);
            simulationController.simulation.alpha(0.3).restart();
        });

    // Folder per aspetti visivi
    const visualFolder = gui.addFolder('Visual');
    
    visualFolder.add(params.visual, 'nodeRadius', 5, 50)
        .name('Node Size')
        .step(1)
        .onChange(value => {
            simulationController.nodes
                .transition()
                .duration(300)
                .attr('r', value);
            simulationController.simulation.force("collision").radius(d => value + 2);
            simulationController.simulation.alpha(0.3).restart();
        });

    visualFolder.add(params.visual, 'nodeOpacity', 0, 1)
        .name('Node Opacity')
        .step(0.1)
        .onChange(value => {
            simulationController.nodes
                .transition()
                .duration(300)
                .attr('opacity', value);
        });

    visualFolder.add(params.visual, 'strokeWidth', 0, 5)
        .name('Stroke Width')
        .step(0.5)
        .onChange(value => {
            simulationController.nodes
                .transition()
                .duration(300)
                .attr('stroke-width', value);
        });

    // Folder per le utility
    const utilsFolder = gui.addFolder('Utils');
    
    utilsFolder.add(params.utils, 'reheat')
        .name('Reheat Simulation');
    
    utilsFolder.add(params.utils, 'resetForces')
        .name('Reset All Forces');
    
    utilsFolder.add(params.utils, 'pauseSimulation')
        .name('Pause Simulation')
        .onChange(value => {
            if (value) {
                simulationController.simulation.stop();
            } else {
                simulationController.simulation.restart();
            }
        });

    // Aggiungi i controlli per gli effetti
    simulationController.effects.addDebugControls(gui);

    // Aggiungi descrizioni ai folder
    forcesFolder.domElement.setAttribute('title', 'Controlla le forze che agiscono sui nodi');
    visualFolder.domElement.setAttribute('title', 'Modifica aspetto visivo dei nodi');
    utilsFolder.domElement.setAttribute('title', 'Strumenti di utilità per la simulazione');

    // Apri i folder più importanti di default
    forcesFolder.open();
    visualFolder.open();

    // Funzione per resettare tutti i parametri ai valori di default
    function resetToDefaults() {
        // Reset forces
        Object.assign(params.forces, {
            center: config.forces.center,
            collisionStrength: config.forces.collision,
            nodeRepulsion: -200
        });

        // Reset simulation params
        simulationController.simulation
            .force("center").strength(params.forces.center);
        simulationController.simulation
            .force("charge").strength(params.forces.nodeRepulsion);
        simulationController.simulation
            .force("collision").strength(params.forces.collisionStrength);
        
        // Reset visual params
        simulationController.nodes
            .transition()
            .duration(300)
            .attr('r', params.visual.nodeRadius)
            .attr('opacity', params.visual.nodeOpacity)
            .attr('stroke-width', params.visual.strokeWidth);

        // Aggiorna il display di dat.GUI
        gui.updateDisplay();

        // Riavvia la simulazione
        simulationController.simulation.alpha(1).restart();
    }

    const groupingFolder = gui.addFolder('Grouping');
    groupingFolder.open();

    groupingFolder.add(params.grouping, 'isGrouped')
        .name('Enable Grouping')
        .onChange(value => {
            if (value) {
                simulationController.activateGrouping(params.grouping.strength);
            } else {
                simulationController.deactivateGrouping();
            }
        });

    groupingFolder.add(params.grouping, 'strength', 0, 1)
        .name('Group Strength')
        .step(0.01)
        .onChange(value => {
            if (params.grouping.isGrouped) {
                simulationController.activateGrouping(value);
            }
        });

    return gui; // Ritorna il riferimento alla GUI
}