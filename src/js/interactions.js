// src/js/interactions.js

export function setupInteractions(simulationController, config) {
    // Assicura che l'elemento tooltip esista
    const tooltip = d3.select("#tooltip");
  
    simulationController.nodes
      .on("mouseover", function(event, d) {
        tooltip.style("visibility", "visible")
               .html(d.name);
        d3.select(this)
          .transition()
          .duration(200)
          .attr("r", d.radius * 1.2)
          .attr("stroke-width", 2);
      })
      .on("mousemove", function(event, d) {
        tooltip.style("left", (event.pageX + 10) + "px")
               .style("top", (event.pageY - 10) + "px");
      })
      .on("mouseout", function(event, d) {
        tooltip.style("visibility", "hidden");
        d3.select(this)
          .transition()
          .duration(200)
          .attr("r", d.radius)
          .attr("stroke-width", 1);
      })
      .on("click", function(event, d) {
        // Al click, ingrandisci il nodo selezionato, opacizza gli altri e apri la modale
        simulationController.nodes
          .transition()
          .duration(300)
          .attr("opacity", 0.2);
        d3.select(this)
          .transition()
          .duration(300)
          .attr("opacity", 1)
          .attr("r", d.radius * 1.5);
        openModal(d);
      });
  
    // Logica per il pulsante di raggruppamento
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
  
    // Gestione della modale
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
  
    closeButton.addEventListener("click", () => {
      modal.classList.remove("visible");
      simulationController.nodes
        .transition()
        .duration(300)
        .attr("opacity", 1)
        .attr("r", d => d.radius);
    });
  
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeButton.click();
      }
    });
  }
  