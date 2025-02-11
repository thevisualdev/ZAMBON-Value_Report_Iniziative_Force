// src/js/simulation.js

import * as d3 from 'd3';
import { GUI } from 'dat.gui';

export class VisualizationController {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    // NOTE: Make sure that config.colors includes a "superTypeColors" property,
    // which is a D3 scale with a fixed domain and range.
    
    this.gl = canvas.getContext('webgl2');
    if (!this.gl) {
      console.error('WebGL2 not supported');
      return;
    }

    // Enable alpha blending for trails and nodes.
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    // Set up canvas dimensions
    this.canvas.width = config.width;
    this.canvas.height = config.height;

    // Define default parameters BEFORE creating the simulation.
    this.params = {
      nodeSize: 18,
      forceCenterStrength: 0.05,
      forceCollideRadius: 0,  // default collision extra radius set to 0
      grouping: false,        // start unchecked
      groupingStrength: 0.20,
      groupingRadius: 300,
      damping: 0.9,
      spawnDelay: 100,
      trail: {
        length: 50,
        opacity: 0.01,
        size: 300,
        interval: 3
      },
      halftone: {
        radius: 3.6,
        rotateR: 1.9,
        rotateG: 5.9,
        rotateB: 0.79,
        scatter: 0.0,
        shape: 1,
        blending: 1.0,
        blendingMode: 1,
        greyscale: false,
        disable: false
      }
    };

    // To store center force strength before grouping.
    this.prevCenterStrength = this.params.forceCenterStrength;

    // State for nodes, trails, etc.
    this.nodes = [];       // full dataset
    this.activeNodes = []; // nodes that have been spawned
    this.trails = [];      // each trail: { x, y, age, color }
    this.maxNodes = 70;
    this.currentSpawnIndex = 0;
    this.lastSpawnTime = 0;
    // Use spawnDelay from params:
    this.spawnDelay = this.params.spawnDelay;
    this.tickCount = 0;

    // Group centers (computed later in setData)
    this.groupCenters = {};

    // Initialize the color mapping for supertypes.
    this.supertypeColors = {};

    // Set up D3 simulation with continuous centering, collision, and custom grouping.
    this.simulation = d3.forceSimulation()
      .force("x", d3.forceX(config.width / 2).strength(this.params.forceCenterStrength))
      .force("y", d3.forceY(config.height / 2).strength(this.params.forceCenterStrength))
      .force("collide", d3.forceCollide(d => d.radius + this.params.forceCollideRadius))
      .force("group", this.groupingForce.bind(this))
      .velocityDecay(this.params.damping)
      .alphaDecay(0.005)
      .alphaMin(0.005)
      .on("tick", () => this.updateNodePositions());

    // Allocate buffers for nodes (positions and colors)
    this.nodePositions = new Float32Array(this.maxNodes * 2);
    this.nodeColors = new Float32Array(this.maxNodes * 4);

    // Initialize programs, buffers, and offscreen framebuffer.
    this.initPrograms();
    this.setupBuffers();
    this.initFramebuffer();

    // Setup GUI only once in the constructor.
    this.setupGUI();

    // Bind animate and start the loop.
    this.animate = this.animate.bind(this);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  /* ==========================================================================
     Custom Grouping Force
     Pulls each active node toward its group's center.
  ========================================================================== */
  groupingForce(alpha) {
    if (!this.params.grouping) return;
    this.activeNodes.forEach(node => {
      const center = this.groupCenters[node.supertype];
      if (center) {
        node.vx += (center.x - node.x) * this.params.groupingStrength * alpha;
        node.vy += (center.y - node.y) * this.params.groupingStrength * alpha;
      }
    });
  }

  /* ==========================================================================
     Shader and Program Initialization
     NOTE: We add a uniform bool u_isTrail to control radial gradient for trails.
  ========================================================================== */
  initPrograms() {
    // --- Nodes Program (for rendering nodes and trails) ---
    const nodesVSSource = `#version 300 es
      in vec2 a_position;
      in vec4 a_color;
      uniform vec2 u_resolution;
      uniform float u_pointSize;
      // Pass u_isTrail to fragment shader.
      uniform bool u_isTrail;
      out vec4 v_color;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        gl_PointSize = u_pointSize;
        v_color = a_color;
      }
    `;
    const nodesFSSource = `#version 300 es
      precision mediump float;
      in vec4 v_color;
      uniform bool u_isTrail;
      out vec4 outColor;
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        if(u_isTrail) {
          // For trails, use a radial gradient: full alpha at center, 0 at rim.
          float gradient = smoothstep(0.5, 0.0, dist);
          outColor = vec4(v_color.rgb, v_color.a * gradient);
        } else {
          if(dist > 0.5) discard;
          outColor = v_color;
        }
      }
    `;
    this.nodesProgram = this.createProgram(nodesVSSource, nodesFSSource);
    if (!this.nodesProgram) throw new Error("Error creating nodesProgram");
    this.nodesAttribLocations = {
      position: this.gl.getAttribLocation(this.nodesProgram, "a_position"),
      color: this.gl.getAttribLocation(this.nodesProgram, "a_color")
    };
    this.nodesUniformLocations = {
      resolution: this.gl.getUniformLocation(this.nodesProgram, "u_resolution"),
      pointSize: this.gl.getUniformLocation(this.nodesProgram, "u_pointSize"),
      isTrail: this.gl.getUniformLocation(this.nodesProgram, "u_isTrail")
    };

    // --- Halftone Program (for post-processing) ---
    const halftoneVSSource = `#version 300 es
      precision mediump float;
      layout(location = 0) in vec2 a_position;
      out vec2 vUV;
      void main() {
        vUV = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0, 1);
      }
    `;
    const halftoneFSSource = `#version 300 es
      precision highp float;
      in vec2 vUV;
      out vec4 outColor;
      
      #define SQRT2_MINUS_ONE 0.41421356
      #define SQRT2_HALF_MINUS_ONE 0.20710678
      #define PI22 6.28318531
      #define SHAPE_DOT 1
      #define SHAPE_ELLIPSE 2
      #define SHAPE_LINE 3
      #define SHAPE_SQUARE 4
      #define BLENDING_LINEAR 1
      #define BLENDING_MULTIPLY 2
      #define BLENDING_ADD 3
      #define BLENDING_LIGHTER 4
      #define BLENDING_DARKER 5

      uniform sampler2D u_inputBuffer;
      uniform float u_radius;
      uniform float u_rotateR;
      uniform float u_rotateG;
      uniform float u_rotateB;
      uniform float u_scatter;
      uniform float u_width;
      uniform float u_height;
      uniform int u_shape;
      uniform bool u_disable;
      uniform float u_blending;
      uniform int u_blendingMode;
      uniform bool u_greyscale;

      float blend(float a, float b, float t) {
        return a * (1.0 - t) + b * t;
      }
      float hypot(float x, float y) {
        return sqrt(x*x + y*y);
      }
      float rand(vec2 seed) {
        return fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
      }
      float distanceToDotRadius(float channel, vec2 coord, vec2 normal, vec2 p, float angle, float rad_max) {
        float dist = hypot(coord.x - p.x, coord.y - p.y);
        float rad = channel;
        if (u_shape == SHAPE_DOT) {
          rad = pow(abs(rad), 1.125) * rad_max;
        } else if (u_shape == SHAPE_ELLIPSE) {
          rad = pow(abs(rad), 1.125) * rad_max;
          if (dist != 0.0) {
            float dot_p = abs((p.x - coord.x)/dist * normal.x + (p.y - coord.y)/dist * normal.y);
            dist = (dist * (1.0 - SQRT2_HALF_MINUS_ONE)) + dot_p * dist * SQRT2_MINUS_ONE;
          }
        } else if (u_shape == SHAPE_LINE) {
          rad = pow(abs(rad), 1.5) * rad_max;
          float dot_p = (p.x - coord.x)*normal.x + (p.y - coord.y)*normal.y;
          dist = hypot(normal.x*dot_p, normal.y*dot_p);
        } else if (u_shape == SHAPE_SQUARE) {
          float theta = atan(p.y - coord.y, p.x - coord.x) - angle;
          float sin_t = abs(sin(theta));
          float cos_t = abs(cos(theta));
          rad = pow(abs(rad), 1.4);
          rad = rad_max * (rad + ((sin_t > cos_t) ? rad - sin_t*rad : rad - cos_t*rad));
        }
        return rad - dist;
      }
      struct Cell {
        vec2 normal;
        vec2 p1;
        vec2 p2;
        vec2 p3;
        vec2 p4;
      };
      vec4 getSample(vec2 point) {
        vec4 tex = texture(u_inputBuffer, vec2(point.x / u_width, point.y / u_height));
        float base = rand(vec2(floor(point.x), floor(point.y)))* PI22;
        float step = PI22 / 8.0;
        float dist = u_radius * 0.66;
        for (int i = 0; i < 8; ++i) {
          float r = base + step * float(i);
          vec2 coord = point + vec2(cos(r)*dist, sin(r)*dist);
          tex += texture(u_inputBuffer, vec2(coord.x / u_width, coord.y / u_height));
        }
        tex /= 9.0;
        return tex;
      }
      Cell getReferenceCell(vec2 p, vec2 origin, float grid_angle, float step) {
        Cell c;
        vec2 n = vec2(cos(grid_angle), sin(grid_angle));
        float threshold = step * 0.5;
        float dot_normal = n.x*(p.x - origin.x) + n.y*(p.y - origin.y);
        float dot_line = -n.y*(p.x - origin.x) + n.x*(p.y - origin.y);
        vec2 offset = vec2(n.x*dot_normal, n.y*dot_normal);
        float offset_normal = mod(length(offset), step);
        float normal_dir = (dot_normal < 0.0) ? 1.0 : -1.0;
        float normal_scale = ((offset_normal < threshold) ? -offset_normal : step-offset_normal)*normal_dir;
        float offset_line = mod(length(p-offset-origin), step);
        float line_dir = (dot_line < 0.0) ? 1.0 : -1.0;
        float line_scale = ((offset_line < threshold) ? -offset_line : step-offset_line)*line_dir;
        c.normal = n;
        c.p1 = p - n*normal_scale + vec2(n.y, -n.x)*line_scale;
        c.p2 = c.p1 - n*((offset_normal < threshold) ? step : -step);
        c.p3 = c.p1 + vec2(n.y, -n.x)*((offset_line < threshold) ? step : -step);
        c.p4 = c.p1 - n*((offset_normal < threshold) ? step : -step) + vec2(n.y, -n.x)*((offset_line < threshold) ? step : -step);
        return c;
      }
      float getDotColour(Cell c, vec2 p, int channel, float angle, float aa) {
        float samp1, samp2, samp3, samp4;
        if(channel==0){
          samp1 = getSample(c.p1).r;
          samp2 = getSample(c.p2).r;
          samp3 = getSample(c.p3).r;
          samp4 = getSample(c.p4).r;
        } else if(channel==1){
          samp1 = getSample(c.p1).g;
          samp2 = getSample(c.p2).g;
          samp3 = getSample(c.p3).g;
          samp4 = getSample(c.p4).g;
        } else {
          samp1 = getSample(c.p1).b;
          samp2 = getSample(c.p2).b;
          samp3 = getSample(c.p3).b;
          samp4 = getSample(c.p4).b;
        }
        float dist1 = distanceToDotRadius(samp1, c.p1, c.normal, p, angle, u_radius);
        float dist2 = distanceToDotRadius(samp2, c.p2, c.normal, p, angle, u_radius);
        float dist3 = distanceToDotRadius(samp3, c.p3, c.normal, p, angle, u_radius);
        float dist4 = distanceToDotRadius(samp4, c.p4, c.normal, p, angle, u_radius);
        float res = 0.0;
        res += (dist1>0.0)? clamp(dist1/aa, 0.0, 1.0):0.0;
        res += (dist2>0.0)? clamp(dist2/aa, 0.0, 1.0):0.0;
        res += (dist3>0.0)? clamp(dist3/aa, 0.0, 1.0):0.0;
        res += (dist4>0.0)? clamp(dist4/aa, 0.0, 1.0):0.0;
        return clamp(res, 0.0, 1.0);
      }
      float blendColour(float a, float b, float t) {
        if(u_blendingMode==BLENDING_LINEAR){
          return blend(a,b,1.0-t);
        } else if(u_blendingMode==BLENDING_ADD){
          return blend(a, min(1.0,a+b),t);
        } else if(u_blendingMode==BLENDING_MULTIPLY){
          return blend(a, max(0.0,a*b),t);
        } else if(u_blendingMode==BLENDING_LIGHTER){
          return blend(a, max(a,b),t);
        } else if(u_blendingMode==BLENDING_DARKER){
          return blend(a, min(a,b),t);
        } else {
          return blend(a,b,1.0-t);
        }
      }
      void main() {
        if(!u_disable){
          vec2 p = vec2(vUV.x*u_width, vUV.y*u_height);
          vec2 origin = vec2(0.0,0.0);
          float aa = (u_radius<2.5)? u_radius*0.5 : 1.25;
          Cell cell_r = getReferenceCell(p,origin, u_rotateR, u_radius);
          Cell cell_g = getReferenceCell(p,origin, u_rotateG, u_radius);
          Cell cell_b = getReferenceCell(p,origin, u_rotateB, u_radius);
          float r = getDotColour(cell_r, p, 0, u_rotateR, aa);
          float g = getDotColour(cell_g, p, 1, u_rotateG, aa);
          float b = getDotColour(cell_b, p, 2, u_rotateB, aa);
          vec4 orig = texture(u_inputBuffer, vUV);
          r = blendColour(r, orig.r, u_blending);
          g = blendColour(g, orig.g, u_blending);
          b = blendColour(b, orig.b, u_blending);
          if(u_greyscale){
            float grey = (r+g+b)/3.0;
            r = g = b = grey;
          }
          outColor = vec4(r, g, b, 1.0);
        } else {
          outColor = texture(u_inputBuffer, vUV);
        }
      }
    `;
    this.halftoneProgram = this.createProgram(halftoneVSSource, halftoneFSSource);
    if(!this.halftoneProgram) throw new Error("Error creating halftoneProgram");
    this.halftoneUniforms = {
      inputBuffer: this.gl.getUniformLocation(this.halftoneProgram, "u_inputBuffer"),
      radius: this.gl.getUniformLocation(this.halftoneProgram, "u_radius"),
      rotateR: this.gl.getUniformLocation(this.halftoneProgram, "u_rotateR"),
      rotateG: this.gl.getUniformLocation(this.halftoneProgram, "u_rotateG"),
      rotateB: this.gl.getUniformLocation(this.halftoneProgram, "u_rotateB"),
      scatter: this.gl.getUniformLocation(this.halftoneProgram, "u_scatter"),
      width: this.gl.getUniformLocation(this.halftoneProgram, "u_width"),
      height: this.gl.getUniformLocation(this.halftoneProgram, "u_height"),
      shape: this.gl.getUniformLocation(this.halftoneProgram, "u_shape"),
      disable: this.gl.getUniformLocation(this.halftoneProgram, "u_disable"),
      blending: this.gl.getUniformLocation(this.halftoneProgram, "u_blending"),
      blendingMode: this.gl.getUniformLocation(this.halftoneProgram, "u_blendingMode"),
      greyscale: this.gl.getUniformLocation(this.halftoneProgram, "u_greyscale")
    };
  }
  
  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if(!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)){
      console.error("Shader compile error:", this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  
  createProgram(vsSource, fsSource) {
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    if(!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)){
      console.error("Program link error:", this.gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }
  
  /* ==========================================================================
     Setup Buffers
  ========================================================================== */
  setupBuffers() {
    this.nodesBuffer = this.gl.createBuffer();
    this.colorsBuffer = this.gl.createBuffer();
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);
    this.quadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVertices, this.gl.STATIC_DRAW);
  }
  
  /* ==========================================================================
     Offscreen Framebuffer Setup
  ========================================================================== */
  initFramebuffer() {
    const gl = this.gl;
    this.offscreenTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.offscreenTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height,
                  0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  
    this.offscreenDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.offscreenDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.canvas.width, this.canvas.height);
  
    this.offscreenFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.offscreenFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.offscreenTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.offscreenDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  
  /* ==========================================================================
     Setup GUI for Debug Controls
     Additional controls: remove all dots, start animation, spawn delay, and color controls.
  ========================================================================== */
  setupGUI() {
    const gui = new GUI();

    // Remove duplicate panels by calling this only once.

    const forcesFolder = gui.addFolder("Forze");
    forcesFolder.add(this.params, "forceCenterStrength", 0, 0.2)
      .name("Center Strength")
      .onChange(newVal => {
        if (!this.params.grouping) {
          this.simulation.force("x", d3.forceX(this.config.width / 2).strength(newVal));
          this.simulation.force("y", d3.forceY(this.config.height / 2).strength(newVal));
        }
        this.simulation.alpha(1).restart();
      });
    forcesFolder.add(this.params, "forceCollideRadius", 0, 10)
      .name("Collide Radius")
      .onChange(newVal => {
        this.simulation.force("collide", d3.forceCollide(d => d.radius + newVal));
        this.simulation.alpha(1).restart();
      });
  
    const groupingFolder = gui.addFolder("Grouping");
    groupingFolder.add(this.params, "grouping")
      .name("Group by Supertype")
      .onChange(newVal => {
        if (newVal) {
          // Disable center force when grouping is on.
          this.prevCenterStrength = this.params.forceCenterStrength;
          this.simulation.force("x", d3.forceX(this.config.width / 2).strength(0));
          this.simulation.force("y", d3.forceY(this.config.height / 2).strength(0));
        } else {
          // Restore center force.
          this.simulation.force("x", d3.forceX(this.config.width / 2).strength(this.prevCenterStrength));
          this.simulation.force("y", d3.forceY(this.config.height / 2).strength(this.prevCenterStrength));
        }
        this.simulation.alpha(1).restart();
      });
    groupingFolder.add(this.params, "groupingStrength", 0, 0.5)
      .name("Grouping Strength")
      .onChange(newVal => { this.simulation.alpha(1).restart(); });
    groupingFolder.add(this.params, "groupingRadius", 50, 300)
      .name("Grouping Radius")
      .onChange(newVal => {
        const supertypes = Array.from(new Set(this.nodes.map(n => n.supertype)));
        const N = supertypes.length;
        const cx = this.config.width / 2;
        const cy = this.config.height / 2;
        supertypes.forEach((s, i) => {
          const angle = (2 * Math.PI * i) / N;
          this.groupCenters[s] = {
            x: cx + newVal * Math.cos(angle),
            y: cy + newVal * Math.sin(angle)
          };
        });
        this.simulation.alpha(1).restart();
      });
  
    const simulationFolder = gui.addFolder("Simulation");
    simulationFolder.add(this.params, "damping", 0, 1)
      .name("Damping")
      .onChange(newVal => {
        this.simulation.velocityDecay(newVal);
        this.simulation.alpha(1).restart();
      });
    simulationFolder.add(this.params, "spawnDelay", 50, 1000)
      .name("Spawn Delay")
      .onChange(newVal => {
        this.spawnDelay = newVal;
      });
  
    const nodesFolder = gui.addFolder("Nodi");
    nodesFolder.add(this.params, "nodeSize", 10, 50)
      .name("Node Size")
      .onChange(newVal => {
        this.activeNodes.forEach(node => { node.radius = newVal; });
      });
  
    const trailsFolder = gui.addFolder("Trails");
    trailsFolder.add(this.params.trail, "length", 10, 200)
      .name("Trail Length");
    trailsFolder.add(this.params.trail, "opacity", 0, 1)
      .name("Trail Opacity");
    trailsFolder.add(this.params.trail, "size", 1, 300)
      .name("Trail Size");
    trailsFolder.add(this.params.trail, "interval", 1, 10)
      .name("Trail Interval");
  
    const halftoneFolder = gui.addFolder("Halftone");
    halftoneFolder.add(this.params.halftone, "radius", 0.5, 10);
    halftoneFolder.add(this.params.halftone, "rotateR", 0, Math.PI * 2);
    halftoneFolder.add(this.params.halftone, "rotateG", 0, Math.PI * 2);
    halftoneFolder.add(this.params.halftone, "rotateB", 0, Math.PI * 2);
    halftoneFolder.add(this.params.halftone, "scatter", 0, 5);
    halftoneFolder.add(this.params.halftone, "shape", { Dot: 1, Ellipse: 2, Line: 3, Square: 4 });
    halftoneFolder.add(this.params.halftone, "blending", 0, 1);
    halftoneFolder.add(this.params.halftone, "blendingMode", { Linear: 1, Multiply: 2, Add: 3, Lighter: 4, Darker: 5 });
    halftoneFolder.add(this.params.halftone, "greyscale");
    halftoneFolder.add(this.params.halftone, "disable");
  
    // Additional UI controls.
    const uiFolder = gui.addFolder("UI Controls");
    uiFolder.add({ removeDots: () => { 
      this.activeNodes = [];
      this.trails = [];
      this.simulation.alpha(1).restart();
    }}, "removeDots").name("Remove All Dots");
    uiFolder.add({ startAnimation: () => { 
      this.activeNodes = [];
      this.trails = [];
      this.currentSpawnIndex = 0;
      this.lastSpawnTime = 0;
      this.simulation.alpha(1).restart();
    }}, "startAnimation").name("Start Animation");
  
    // Color controls: one folder for category colors and one for background.
    // For category colors, we assume that the supertype keys are known (or compute them from the nodes).
    // Here we add controls only if nodes have been loaded.
    const colorsFolder = gui.addFolder("Colors");
    // If nodes exist, build a control per category.
    const supertypes = Array.from(new Set(this.nodes.map(n => n.supertype)));
    supertypes.forEach(s => {
      // Use a dummy object to hold the color value.
      const colorControl = { color: this.config.colors.superTypeColors(s) };
      colorsFolder.addColor(colorControl, "color").name(s).onChange(newColor => {
        // Update the color scale for that category.
        // For simplicity, we rebuild the color scale range for this category.
        // (In a production app you might want a more robust mapping.)
        this.config.colors.superTypeColors.range(
          this.config.colors.superTypeColors.range().map(c => {
            return (c === this.config.colors.superTypeColors(s)) ? newColor : c;
          })
        );
        // Also update node colors for affected nodes.
        this.nodes.forEach(node => {
          if(node.supertype === s) {
            node.color = newColor;
          }
        });
      });
    });
    // Background color control:
    const bgControl = { background: "#ffffff" };
    uiFolder.addColor(bgControl, "background").name("Background").onChange(newColor => {
      this.canvas.style.background = newColor;
    });
  }
  
  /* ==========================================================================
     Data Setup and Simulation Start
  ========================================================================== */
  setData(data) {
    // Create nodes from the incoming data.
    // You can adjust this mapping as needed to include default x, y, radius, and color values.
    this.nodes = data.map(d => ({
      ...d,
      x: Math.random() * this.canvas.width, // random starting x-position
      y: Math.random() * this.canvas.height, // random starting y-position
      radius: d.radius || 5,                 // default radius if not provided
      color: d.color || this.config.colors.superTypeColors(d.supertype) || '#000'
    }));
    
    // Save the original data if needed.
    this.data = data;
  
    // Update the supertype colors mapping from the config.
    const fixedSupertypes = this.config.colors.superTypeColors.domain();
    fixedSupertypes.forEach(st => {
      this.supertypeColors[st] = this.config.colors.superTypeColors(st);
    });
  
    // Pass the nodes to the simulation.
    this.simulation.nodes(this.nodes);
  
    // If the GUI was not already created, create it.
    if (!this.gui) {
      this.setupGUI();
    }
    
    this.startSimulation();
  }
  
  
  /* ==========================================================================
     Update Node Positions on Simulation Tick
  ========================================================================== */
  updateNodePositions() {
    // Defensive check: if the WebGL context is unavailable, exit early.
    if (!this.gl) return;

    this.tickCount++;
    this.activeNodes.forEach((node, i) => {
      // Keep nodes within bounds.
      node.x = Math.max(50, Math.min(this.canvas.width - 50, node.x));
      node.y = Math.max(50, Math.min(this.canvas.height - 50, node.y));
  
      this.nodePositions[i * 2] = node.x;
      this.nodePositions[i * 2 + 1] = node.y;
      const color = d3.color(node.color);
      this.nodeColors[i * 4] = color.r / 255;
      this.nodeColors[i * 4 + 1] = color.g / 255;
      this.nodeColors[i * 4 + 2] = color.b / 255;
      this.nodeColors[i * 4 + 3] = 1.0;
  
      if (this.tickCount % this.params.trail.interval === 0) {
        this.trails.push({ x: node.x, y: node.y, age: 0, color: node.color });
      }
    });
    this.trails.forEach(trail => { trail.age++; });
    this.trails = this.trails.filter(trail => trail.age < this.params.trail.length);
  }
  
  /* ==========================================================================
     Draw Trails using the nodes shader with radial gradient.
  ========================================================================== */
  drawTrails() {
    // Defensive check: ensure WebGL context and buffers are available.
    if (!this.gl || !this.nodesBuffer || !this.colorsBuffer) return;

    const gl = this.gl;
    const n = this.trails.length;
    if(n === 0) return;
  
    const trailPositions = new Float32Array(n * 2);
    const trailColors = new Float32Array(n * 4);
    for(let i = 0; i < n; i++){
      const t = this.trails[i];
      trailPositions[i * 2] = t.x;
      trailPositions[i * 2 + 1] = t.y;
      const col = d3.color(t.color);
      const alpha = this.params.trail.opacity * (1 - t.age / this.params.trail.length);
      trailColors[i * 4] = col.r / 255;
      trailColors[i * 4 + 1] = col.g / 255;
      trailColors[i * 4 + 2] = col.b / 255;
      trailColors[i * 4 + 3] = alpha;
    }
  
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, trailPositions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.nodesAttribLocations.position);
    gl.vertexAttribPointer(this.nodesAttribLocations.position, 2, gl.FLOAT, false, 0, 0);
  
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, trailColors, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.nodesAttribLocations.color);
    gl.vertexAttribPointer(this.nodesAttribLocations.color, 4, gl.FLOAT, false, 0, 0);
  
    // Set point size for trails and indicate trail mode.
    gl.uniform1f(this.nodesUniformLocations.pointSize, this.params.trail.size);
    gl.uniform1i(this.nodesUniformLocations.isTrail, true);
    gl.drawArrays(gl.POINTS, 0, n);
  }
  
  /* ==========================================================================
     Render (Three Passes):
       1) Render trails (drawn first so they appear underneath)
       2) Render nodes on top
       3) Apply halftone effect
  ========================================================================== */
  render(timestamp) {
    // Defensive check: if the WebGL context is not available, exit early.
    if (!this.gl) return;
  
    const gl = this.gl;
  
    if (timestamp - this.lastSpawnTime > this.spawnDelay && this.currentSpawnIndex < Math.min(this.maxNodes, this.nodes.length)) {
      this.activeNodes.push(this.nodes[this.currentSpawnIndex]);
      this.currentSpawnIndex++;
      this.lastSpawnTime = timestamp;
      this.simulation.alpha(1).restart();
    }
  
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.offscreenFBO);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  
    gl.useProgram(this.nodesProgram);
    gl.uniform2f(this.nodesUniformLocations.resolution, this.canvas.width, this.canvas.height);
  
    // Draw trails first.
    this.drawTrails();
  
    // Then draw nodes.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.nodePositions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.nodesAttribLocations.position);
    gl.vertexAttribPointer(this.nodesAttribLocations.position, 2, gl.FLOAT, false, 0, 0);
  
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.nodeColors, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.nodesAttribLocations.color);
    gl.vertexAttribPointer(this.nodesAttribLocations.color, 4, gl.FLOAT, false, 0, 0);
  
    gl.uniform1f(this.nodesUniformLocations.pointSize, this.params.nodeSize);
    gl.uniform1i(this.nodesUniformLocations.isTrail, false);
    gl.drawArrays(gl.POINTS, 0, this.activeNodes.length);
  
    // --- Pass 3: Render full-screen quad with halftone effect ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  
    gl.useProgram(this.halftoneProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.offscreenTexture);
    gl.uniform1i(this.halftoneUniforms.inputBuffer, 0);
    gl.uniform1f(this.halftoneUniforms.radius, this.params.halftone.radius);
    gl.uniform1f(this.halftoneUniforms.rotateR, this.params.halftone.rotateR);
    gl.uniform1f(this.halftoneUniforms.rotateG, this.params.halftone.rotateG);
    gl.uniform1f(this.halftoneUniforms.rotateB, this.params.halftone.rotateB);
    gl.uniform1f(this.halftoneUniforms.scatter, this.params.halftone.scatter);
    gl.uniform1f(this.halftoneUniforms.width, this.canvas.width);
    gl.uniform1f(this.halftoneUniforms.height, this.canvas.height);
    gl.uniform1i(this.halftoneUniforms.shape, this.params.halftone.shape);
    gl.uniform1i(this.halftoneUniforms.blendingMode, this.params.halftone.blendingMode);
    gl.uniform1f(this.halftoneUniforms.blending, this.params.halftone.blending);
    gl.uniform1i(this.halftoneUniforms.greyscale, this.params.halftone.greyscale);
    gl.uniform1i(this.halftoneUniforms.disable, this.params.halftone.disable);
  
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  
  /* ==========================================================================
     Animation Loop
  ========================================================================== */
  animate(timestamp) {
    // Even though simulation.tick() doesn't use the WebGL context directly,
    // our render() call does, so our defensive checks there are sufficient.
    this.simulation.tick();
    this.render(timestamp);
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
  }

  /**
   * Clean up method. Cancels any ongoing animation loop, destroys the GUI,
   * and removes references to the WebGL context and canvas.
   */
  dispose() {
    // Cancel any ongoing animation frame.
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Destroy the GUI if it exists.
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
    // Clean up references.
    this.data = null;
    this.canvas = null;
    this.gl = null;
  }

  startSimulation() {
    // Restart the D3 simulation.
    if (this.simulation) {
      this.simulation.alpha(1).restart();
    }
  }
}
