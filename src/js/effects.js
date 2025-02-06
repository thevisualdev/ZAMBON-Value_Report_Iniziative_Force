// src/js/effects.js

// Helper: converte un colore in formato RGBA utilizzando d3.color.
function colorToRgba(color, opacity) {
    const c = d3.color(color);
    if (!c) return `rgba(0,0,0,${opacity})`;
    return `rgba(${c.r},${c.g},${c.b},${opacity})`;
  }
  
  export class CanvasEffects {
    constructor(canvasId, config) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) {
        console.error('Canvas element not found:', canvasId);
        return;
      }
      this.ctx = this.canvas.getContext('2d');
      this.config = config;
  
      // Crea un buffer offscreen per le trail
      this.trailBuffer = document.createElement('canvas');
      this.trailBuffer.width = this.config.width;
      this.trailBuffer.height = this.config.height;
      this.trailCtx = this.trailBuffer.getContext('2d');
  
      // Configurazione effetti
      this.effects = {
        trail: {
          enabled: true,
          fadeOpacity: 0.02,
          radiusMultiplier: 4
        },
        dithering: {
          enabled: false,
          intensity: 0.2
        },
        // Per il compositing usiamo "source-over"
        blendMode: 'source-over',
        halftone: {
          enabled: true,
          patternSize: 20,
          dotSize: 1,
          scatter: 0,
          smooth: 1,
          shape: 1, // 1=dot, 2=ellipse, 3=line, 4=square
          angles: {
            r: Math.PI / 12,
            g: Math.PI / 6,
            b: Math.PI / 4
          }
        }
      };
  
      if (this.effects.halftone.enabled) {
        this.initHalftone();
      }
  
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.setupBackground();
    }
  
    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = this.config.width * dpr;
      this.canvas.height = this.config.height * dpr;
      this.canvas.style.width = `${this.config.width}px`;
      this.canvas.style.height = `${this.config.height}px`;
      this.ctx.scale(dpr, dpr);
  
      this.trailBuffer.width = this.config.width;
      this.trailBuffer.height = this.config.height;
      this.setupBackground();
  
      if (this.halftoneRenderer) {
        this.halftoneRenderer.setSize(this.config.width, this.config.height);
        this.halftoneCamera.left = 0;
        this.halftoneCamera.right = this.config.width;
        this.halftoneCamera.top = 0;
        this.halftoneCamera.bottom = this.config.height;
        this.halftoneCamera.updateProjectionMatrix();
        this.halftonePlane.scale.set(this.config.width, this.config.height, 1);
      }
    }
  
    setupBackground() {
      // Imposta uno sfondo neutro sia sul canvas principale che sul buffer
      this.ctx.fillStyle = '#f5f5f5';
      this.ctx.fillRect(0, 0, this.config.width, this.config.height);
      this.trailCtx.fillStyle = '#f5f5f5';
      this.trailCtx.fillRect(0, 0, this.config.width, this.config.height);
    }
  
    update(nodes) {
      const self = this;
      // 1. Fai sfumare gradualmente il buffer offscreen
      self.trailCtx.globalCompositeOperation = 'destination-out';
      self.trailCtx.fillStyle = `rgba(0, 0, 0, ${self.effects.trail.fadeOpacity})`;
      self.trailCtx.fillRect(0, 0, self.config.width, self.config.height);
      self.trailCtx.globalCompositeOperation = 'source-over';
  
      // 2. Disegna le trail solo per i nodi visibili (con raggio > 0)
      // In questo modo i nodi non ancora spawnati (raggio = 0) non generano trail.
      nodes.filter(d => d.radius > 0).each(function(d) {
        const elOpacity = parseFloat(d3.select(this).attr("opacity")) || 1;
        const color = self.config.colors.superTypeColors(d.supertype);
        const gradient = self.trailCtx.createRadialGradient(
          d.x, d.y, 0,
          d.x, d.y, d.radius * self.effects.trail.radiusMultiplier
        );
        gradient.addColorStop(0, colorToRgba(color, elOpacity));
        gradient.addColorStop(1, colorToRgba(color, 0));
        self.trailCtx.fillStyle = gradient;
        self.trailCtx.beginPath();
        self.trailCtx.arc(d.x, d.y, d.radius * self.effects.trail.radiusMultiplier, 0, Math.PI * 2);
        self.trailCtx.fill();
      });
  
      // 3. Pulisci il main canvas e disegna il buffer
      self.ctx.globalCompositeOperation = 'source-over';
      self.ctx.fillStyle = '#f5f5f5';
      self.ctx.fillRect(0, 0, self.config.width, self.config.height);
      self.ctx.globalCompositeOperation = self.effects.blendMode;
      self.ctx.drawImage(self.trailBuffer, 0, 0, self.config.width, self.config.height);
      self.ctx.globalCompositeOperation = 'source-over';
  
      // 4. Se il halftone è abilitato, aggiorna l'overlay WebGL (senza interferire con le trail)
      if (self.effects.halftone.enabled && self.halftoneComposer) {
        self.updateHalftone();
      } else if (self.effects.dithering.enabled) {
        self.applyDithering();
      }
    }
  
    applyDithering() {
      const imageData = this.ctx.getImageData(0, 0, this.config.width, this.config.height);
      const data = imageData.data;
      const intensity = this.effects.dithering.intensity;
      const width = imageData.width;
      const height = imageData.height;
      for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          for (let c = 0; c < 3; c++) {
            const oldValue = data[idx + c];
            const newValue = oldValue < 128 ? 0 : 255;
            data[idx + c] = newValue;
            const error = (oldValue - newValue) * intensity;
            if (x + 1 < width) data[idx + 4 + c] += error * 7 / 16;
            if (y + 1 < height) {
              if (x > 0) data[idx + (width - 1) * 4 - 4 + c] += error * 3 / 16;
              data[idx + width * 4 + c] += error * 5 / 16;
              if (x + 1 < width) data[idx + width * 4 + 4 + c] += error * 1 / 16;
            }
          }
        }
      }
      this.ctx.putImageData(imageData, 0, 0);
    }
  
    // --- Nuovo sistema Halftone basato su Three.js e postprocessing ---
    initHalftone() {
      if (typeof POSTPROCESSING === "undefined" || !POSTPROCESSING.HalftoneEffect) {
        console.error("POSTPROCESSING o HalftoneEffect non disponibile");
        this.effects.halftone.enabled = false;
        return;
      }
  
      // Setup canvas overlay
      this.halftoneCanvas = document.createElement('canvas');
      this.halftoneCanvas.style.position = 'absolute';
      this.halftoneCanvas.style.top = '0';
      this.halftoneCanvas.style.left = '0';
      this.halftoneCanvas.style.pointerEvents = 'none';
      document.getElementById('visualization-container').appendChild(this.halftoneCanvas);
  
      // Setup Three.js renderer
      this.halftoneRenderer = new THREE.WebGLRenderer({
        canvas: this.halftoneCanvas,
        alpha: true
      });
      this.halftoneRenderer.setSize(this.config.width, this.config.height);
  
      // Setup camera e scena
      this.halftoneCamera = new THREE.OrthographicCamera(
        0, this.config.width,
        0, this.config.height,
        -1, 1
      );
      this.halftoneScene = new THREE.Scene();
  
      // Setup texture e piano
      this.halftoneTexture = new THREE.CanvasTexture(this.canvas);
      this.halftoneTexture.minFilter = THREE.LinearFilter;
      const geometry = new THREE.PlaneGeometry(this.config.width, this.config.height);
      const material = new THREE.MeshBasicMaterial({ map: this.halftoneTexture });
      this.halftonePlane = new THREE.Mesh(geometry, material);
      this.halftonePlane.position.set(this.config.width / 2, this.config.height / 2, 0);
      this.halftoneScene.add(this.halftonePlane);
  
      // Setup EffectComposer e HalftoneEffect
      this.halftoneComposer = new POSTPROCESSING.EffectComposer(this.halftoneRenderer);
      
      const halftoneEffect = new POSTPROCESSING.HalftoneEffect({
        shape: this.effects.halftone.shape,
        radius: this.effects.halftone.patternSize * this.effects.halftone.dotSize,
        rotateR: this.effects.halftone.angles.r,
        rotateG: this.effects.halftone.angles.g,
        rotateB: this.effects.halftone.angles.b,
        scatter: this.effects.halftone.scatter,
        blending: 1.0,
        blendingMode: 1,
        greyscale: false,
        disable: false
      });
  
      this.halftonePass = new POSTPROCESSING.EffectPass(
        this.halftoneCamera,
        halftoneEffect
      );
      this.halftoneComposer.addPass(this.halftonePass);
    }
  
    updateHalftone() {
      // Aggiorna la texture in modo che rifletta il contenuto attuale del main canvas.
      this.halftoneTexture.needsUpdate = true;
      this.halftoneComposer.render();
    }
  
    addDebugControls(gui) {
      const effectsFolder = gui.addFolder('Visual Effects');
  
      const trailFolder = effectsFolder.addFolder('Trail Effect');
      trailFolder.add(this.effects.trail, 'enabled').name('Abilita Trail');
      trailFolder.add(this.effects.trail, 'fadeOpacity', 0, 0.5).step(0.001).name('Velocità fade');
      trailFolder.add(this.effects.trail, 'radiusMultiplier', 1, 10).step(0.1).name('Ampiezza trail');
  
      effectsFolder.add(this.effects, 'blendMode', ['source-over', 'screen', 'overlay', 'lighter'])
        .name('Modalità di blending');
  
      const halftoneFolder = effectsFolder.addFolder('Halftone');
      halftoneFolder.add(this.effects.halftone, 'enabled').name('Abilita Halftone').onChange((val) => {
        if (val && !this.halftoneComposer) {
          this.initHalftone();
        } else if (!val && this.halftoneCanvas) {
          this.halftoneCanvas.remove();
          if (this.halftoneRenderer) {
            this.halftoneRenderer.dispose();
          }
          this.halftoneComposer = null;
          this.halftoneRenderer = null;
        }
      });
      halftoneFolder.add(this.effects.halftone, 'patternSize', 10, 50).step(1).name('Dimensione pattern');
      halftoneFolder.add(this.effects.halftone, 'dotSize', 0.1, 3).step(0.1).name('Dimensione dot');
      halftoneFolder.add(this.effects.halftone, 'scatter', 0, 5).step(0.1).name('Scatter');
      halftoneFolder.add(this.effects.halftone, 'smooth', 0, 2).step(0.1).name('Smooth');
  
      const ditheringFolder = effectsFolder.addFolder('Dithering');
      ditheringFolder.add(this.effects.dithering, 'enabled').name('Abilita Dithering');
      ditheringFolder.add(this.effects.dithering, 'intensity', 0, 1).step(0.05).name('Intensità dithering');
  
      effectsFolder.open();
    }
  }
  