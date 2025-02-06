export function setupDebugPanel(simulationController, config) {
    // Usa la versione globale di dat.GUI invece dell'import
    const gui = new window.dat.GUI({ name: 'Debug Controls' });
    
    // Cartella per le forze
    const forcesFolder = gui.addFolder('Forces');
    
    const forceControls = {
        center: config.forces.center,
        collision: config.forces.collision,
        grouping: config.forces.grouping
    };
    
    forcesFolder.add(forceControls, 'center', 0, 2)
        .name('Center Force')
        .onChange(value => {
            config.forces.center = value;
            if (simulationController.simulation.force("center")) {
                simulationController.simulation.force("center").strength(value);
                simulationController.simulation.alpha(1).restart();
            }
        });
        
    forcesFolder.add(forceControls, 'collision', 0, 1)
        .name('Collision Force')
        .onChange(value => {
            config.forces.collision = value;
            simulationController.simulation.force("collision").strength(value);
            simulationController.simulation.alpha(1).restart();
        });
        
    forcesFolder.add(forceControls, 'grouping', 0, 1)
        .name('Grouping Force')
        .onChange(value => {
            config.forces.grouping = value;
            if (simulationController.simulation.force("group")) {
                simulationController.simulation.force("group").strength(value);
                simulationController.simulation.force("group-y").strength(value);
                simulationController.simulation.alpha(1).restart();
            }
        });
    
    // Cartella per la visualizzazione
    const visualFolder = gui.addFolder('Visual');
    
    const visualControls = {
        nodeRadius: 20,
        nodeOpacity: 1,
        strokeWidth: 1
    };
    
    visualFolder.add(visualControls, 'nodeRadius', 5, 50)
        .name('Node Size')
        .onChange(value => {
            simulationController.nodes
                .attr("r", value);
            simulationController.simulation.force("collision").radius(value);
            simulationController.simulation.alpha(1).restart();
        });
        
    visualFolder.add(visualControls, 'nodeOpacity', 0, 1)
        .name('Node Opacity')
        .onChange(value => {
            simulationController.nodes
                .attr("opacity", value);
        });
        
    visualFolder.add(visualControls, 'strokeWidth', 0, 5)
        .name('Stroke Width')
        .onChange(value => {
            simulationController.nodes
                .attr("stroke-width", value);
        });
    
    // Cartella per le utility
    const utilsFolder = gui.addFolder('Utils');
    
    const utilsControls = {
        resetSimulation: () => {
            simulationController.simulation.alpha(1).restart();
            simulationController.nodes
                .attr("opacity", 1)
                .attr("r", visualControls.nodeRadius);
        },
        toggleGrouping: () => {
            const button = document.getElementById('group-by-supertype');
            if (button) button.click();
        }
    };
    
    utilsFolder.add(utilsControls, 'resetSimulation')
        .name('Reset Simulation');
        
    utilsFolder.add(utilsControls, 'toggleGrouping')
        .name('Toggle Grouping');
    
    // Apri le cartelle di default
    forcesFolder.open();
    visualFolder.open();
    utilsFolder.open();
    
    // Posiziona il pannello in alto a destra
    gui.domElement.style.position = 'absolute';
    gui.domElement.style.top = '0';
    gui.domElement.style.right = '0';
    
    return gui;
}