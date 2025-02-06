// src/js/effects.js

// Helper: converte un colore in formato RGBA utilizzando d3.color.
function colorToRgba(color, opacity) {
    const c = d3.color(color);
    if (!c) return `rgba(0,0,0,${opacity})`;
    return `rgba(${c.r},${c.g},${c.b},${opacity})`;
  }
  
  export class CanvasEffects {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.ctx = canvas.getContext('2d');
      
      // Imposta le dimensioni del canvas
      this.canvas.width = config.width;
      this.canvas.height = config.height;
      
      this.effects = {
        halftone: {
          enabled: true,
          size: 4,
          spacing: 4,
          angle: Math.PI / 6,
          blur: 2
        }
      };
      
      // Inizializza il gradiente trail
      this.trails = [];
      this.maxTrails = 50;
      
      this.animate = this.animate.bind(this);
      requestAnimationFrame(this.animate);
    }
    
    initHalftone() {
      // Setup del canvas per l'effetto halftone
      this.halftoneCanvas = document.createElement('canvas');
      this.halftoneCanvas.style.position = 'absolute';
      this.halftoneCanvas.style.top = '0';
      this.halftoneCanvas.style.left = '0';
      this.halftoneCanvas.style.pointerEvents = 'none';
      this.halftoneCanvas.width = this.config.width;
      this.halftoneCanvas.height = this.config.height;
      
      document.getElementById('visualization-container').appendChild(this.halftoneCanvas);
      this.halftoneCtx = this.halftoneCanvas.getContext('2d');
    }
    
    addTrail(x, y, color) {
      this.trails.push({
        x, y,
        color: d3.color(color).brighter(0.2),
        age: 0,
        maxAge: 60
      });
      
      if (this.trails.length > this.maxTrails) {
        this.trails.shift();
      }
    }
    
    drawHalftone() {
      const ctx = this.halftoneCtx;
      const { size, spacing, angle } = this.effects.halftone;
      
      ctx.clearRect(0, 0, this.config.width, this.config.height);
      
      // Applica l'effetto halftone ai trails
      this.trails.forEach(trail => {
        const alpha = 1 - (trail.age / trail.maxAge);
        ctx.fillStyle = `rgba(${trail.color.r}, ${trail.color.g}, ${trail.color.b}, ${alpha})`;
        
        for (let x = 0; x < this.config.width; x += spacing) {
          for (let y = 0; y < this.config.height; y += spacing) {
            const distance = Math.hypot(x - trail.x, y - trail.y);
            const dotSize = Math.max(0, size * (1 - distance / 200) * alpha);
            
            if (dotSize > 0) {
              ctx.beginPath();
              ctx.arc(x, y, dotSize / 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      });
    }
    
    animate() {
      // Aggiorna l'età dei trails
      this.trails = this.trails.filter(trail => {
        trail.age++;
        return trail.age < trail.maxAge;
      });
      
      // Disegna gli effetti
      this.drawHalftone();
      
      requestAnimationFrame(this.animate);
    }
  }
  