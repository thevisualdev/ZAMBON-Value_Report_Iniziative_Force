// src/js/interactions.js

export function setupInteractions(simulationController, config) {
    const nodes = simulationController.nodes;
    const tooltip = d3.select("#tooltip");
    
    // Gestione hover
    nodes
        .on("mouseover", (event, d) => {
            const [x, y] = d3.pointer(event);
            
            tooltip
                .style("display", "block")
                .style("left", `${x + 10}px`)
                .style("top", `${y + 10}px`)
                .html(d.name);
                
            // Evidenzia il nodo
            d3.select(event.currentTarget)
                .transition()
                .duration(200)
                .attr("stroke-width", 2);
        })
        .on("mouseout", (event) => {
            tooltip.style("display", "none");
            
            d3.select(event.currentTarget)
                .transition()
                .duration(200)
                .attr("stroke-width", 1);
        })
        .on("click", (event, d) => {
            event.stopPropagation();
            
            // Evidenzia il nodo selezionato e opacizza gli altri
            nodes
                .transition()
                .duration(300)
                .attr("opacity", nd => nd === d ? 1 : 0.2)
                .attr("r", nd => nd === d ? d.radius * 1.5 : d.radius);
                
            openModal(d);
        });
    
    // Click sullo sfondo per resettare
    d3.select("body").on("click", () => {
        nodes
            .transition()
            .duration(300)
            .attr("opacity", 1)
            .attr("r", d => d.radius);
            
        closeModal();
    });
    
    // Gestione pulsante di raggruppamento
    let isGrouped = false;
    const groupButton = d3.select("#group-by-supertype")
        .on("click", () => {
            isGrouped = !isGrouped;
            if (isGrouped) {
                simulationController.activateGrouping();
                groupButton.text("Disattiva Raggruppamento");
            } else {
                simulationController.deactivateGrouping();
                groupButton.text("Raggruppa per Supertype");
            }
        });
    
    // Gestione modale
    const modal = document.getElementById("modal");
    const closeButton = modal.querySelector(".close-button");
    
    function openModal(data) {
        const detailsContainer = document.getElementById("initiative-details");
        detailsContainer.innerHTML = `
            <h2>${data.name}</h2>
            <div class="initiative-type">
                <span class="badge" style="background-color: ${config.colors.superTypeColors(data.supertype)}">
                    ${data.supertype}
                </span>
                ${data.type ? `<span class="badge">${data.type}</span>` : ''}
            </div>
            <p class="description">${data.whatSimplified || 'Nessuna descrizione disponibile.'}</p>
            ${data.tags ? `
                <div class="tags">
                    ${data.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
            ` : ''}
        `;
        modal.classList.add("visible");
    }
    
    function closeModal() {
        modal.classList.remove("visible");
    }
    
    closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeModal();
        nodes
            .transition()
            .duration(300)
            .attr("opacity", 1)
            .attr("r", d => d.radius);
    });
}
  