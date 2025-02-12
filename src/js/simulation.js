// src/js/simulation.js

import * as d3 from 'd3';
import { GUI } from 'dat.gui';

export class VisualizationController {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    
    // Initialize WebGL2 context
    this.gl = canvas.getContext('webgl2');
    if (!this.gl) {
      console.error('WebGL2 not supported');
      return;
    }
    const gl = this.gl;
    
    // Enable alpha blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Set canvas dimensions
    this.canvas.width = config.width;
    this.canvas.height = config.height;
    
    // Initialize state variables
    this.nodes = [];       // full dataset
    this.activeNodes = []; // nodes currently displayed
    this.trails = [];      // trails for nodes
    this.maxNodes = 70;
    this.currentSpawnIndex = 0;
    this.lastSpawnTime = 0;
    this.tickCount = 0;
    this.groupCenters = {};
    this.supertypeColors = {};
    
    // Default parameters
    this.params = {
      nodeSize: 18,
      forceCenterStrength: 0.05,
      forceCollideRadius: 10,
      grouping: false,
      groupingStrength: 0.20,
      groupingRadius: 300,
      damping: 0.9,
      spawnDelay: 100,
      trail: {
        length: 86,
        opacity: 0.082,
        size: 180,
        interval: 3,
        saturationScale: 0.7,
        lightnessBase: 0.72,
        lightnessContrast: 0.16,
        blurSize: 20  // New parameter for Gaussian blur
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
    
    this.prevCenterStrength = this.params.forceCenterStrength;
    this.spawnDelay = this.params.spawnDelay;
    
    // Setup D3 simulation
    this.simulation = d3.forceSimulation()
      .force('x', d3.forceX(config.width / 2).strength(this.params.forceCenterStrength))
      .force('y', d3.forceY(config.height / 2).strength(this.params.forceCenterStrength))
      .force('collide', d3.forceCollide(d => d.radius + this.params.forceCollideRadius))
      .force('group', this.groupingForce.bind(this))
      .velocityDecay(this.params.damping)
      .alphaDecay(0.005)
      .alphaMin(0.005)
      .on('tick', () => this.updateNodePositions());
    
    // Allocate buffers for nodes and colors
    this.nodePositions = new Float32Array(this.maxNodes * 2);
    this.nodeColors = new Float32Array(this.maxNodes * 4);
    
    // Initialize WebGL resources
    this.initPrograms();
    this.setupBuffers();
    this.initFramebuffer();
    this.initShaders();
    
    // Setup GUI (first clean up any existing instances)
    this.cleanupGUI();
    this.setupGUI();
    
    // Start the animation loop
    this.animate = this.animate.bind(this);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }
  
  // Custom grouping force: nudges nodes toward their group center
  groupingForce(alpha) {
    if (!this.params.grouping) return;
    this.nodes.forEach(node => {
      const center = this.groupCenters[node.supertype];
      if (center) {
        node.vx += (center.x - node.x) * this.params.groupingStrength * alpha;
        node.vy += (center.y - node.y) * this.params.groupingStrength * alpha;
      }
    });
  }
  
  // Initialize shader programs
  initPrograms() {
    const gl = this.gl;
    
    // Nodes Program: renders nodes and trails
    const nodesVSSource = `#version 300 es
      in vec2 a_position;
      in vec4 a_color;
      uniform vec2 u_resolution;
      uniform float u_pointSize;
      uniform bool u_isTrail;
      out vec4 v_color;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clipSpace, 0, 1);
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
        if(u_isTrail) {
          float d = distance(gl_PointCoord, vec2(0.5, 0.5));
          // For a tail: fully opaque for d <= 0.2, then fade to 0 by d = 0.5
          float radialAlpha = 1.0 - smoothstep(0.2, 0.5, d);
          outColor = vec4(v_color.rgb, v_color.a * radialAlpha);
        } else {
          if(distance(gl_PointCoord, vec2(0.5, 0.5)) > 0.5) {
             discard;
          }
          outColor = v_color;
        }
      }
    `;
    this.nodesProgram = this.createProgram(nodesVSSource, nodesFSSource);
    
    // Obtain attribute and uniform locations for nodes program
    this.nodesAttribLocations = {
      position: gl.getAttribLocation(this.nodesProgram, 'a_position'),
      color: gl.getAttribLocation(this.nodesProgram, 'a_color')
    };
    this.nodesUniformLocations = {
      resolution: gl.getUniformLocation(this.nodesProgram, 'u_resolution'),
      pointSize: gl.getUniformLocation(this.nodesProgram, 'u_pointSize'),
      isTrail: gl.getUniformLocation(this.nodesProgram, 'u_isTrail')
    };
    
    // Halftone Program: applies post-processing halftone effect
    const halftoneVSSource = `#version 300 es
      precision mediump float;
      layout(location = 0) in vec2 a_position;
      out vec2 vUV;
      void main() {
        // Use standard UV coordinates (no flip) to preserve trail orientation
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
      
      uniform sampler2D inputBuffer;
      uniform float radius;
      uniform float rotateR;
      uniform float rotateG;
      uniform float rotateB;
      uniform float scatter;
      uniform float width;
      uniform float height;
      uniform int shape;
      uniform bool disable;
      uniform float blending;
      uniform int blendingMode;
      uniform bool greyscale;
      
      const int samples = 8;
      
      float blend(float a, float b, float t) {
        return a * (1.0 - t) + b * t;
      }
      float hypotf(float x, float y) {
        return sqrt(x*x + y*y);
      }
      float rand(vec2 seed) {
        return fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
      }
      float distanceToDotRadius(float channel, vec2 coord, vec2 normal, vec2 p, float angle, float rad_max) {
        float dist = hypotf(coord.x - p.x, coord.y - p.y);
        float rad = channel;
        if (shape == SHAPE_DOT) {
          rad = pow(abs(rad), 1.125) * rad_max;
        } else if (shape == SHAPE_ELLIPSE) {
          rad = pow(abs(rad), 1.125) * rad_max;
          if (dist != 0.0) {
            float dot_p = abs((p.x - coord.x)/dist * normal.x + (p.y - coord.y)/dist * normal.y);
            dist = (dist * (1.0 - SQRT2_HALF_MINUS_ONE)) + dot_p * dist * SQRT2_MINUS_ONE;
          }
        } else if (shape == SHAPE_LINE) {
          rad = pow(abs(rad), 1.5) * rad_max;
          float dot_p = (p.x - coord.x) * normal.x + (p.y - coord.y) * normal.y;
          dist = hypotf(normal.x * dot_p, normal.y * dot_p);
        } else if (shape == SHAPE_SQUARE) {
          float theta = atan(p.y - coord.y, p.x - coord.x) - angle;
          float sin_t = abs(sin(theta));
          float cos_t = abs(cos(theta));
          rad = pow(abs(rad), 1.4);
          rad = rad_max * (rad + ((sin_t > cos_t) ? rad - sin_t * rad : rad - cos_t * rad));
        }
        return rad - dist;
      }
      
      struct Cell {
        vec2 normal;
        vec2 p1;
        vec2 p2;
        vec2 p3;
        vec2 p4;
        float samp1;
        float samp2;
        float samp3;
        float samp4;
      };
      
      vec4 getSample(vec2 point) {
        vec4 tex = texture(inputBuffer, vec2(point.x / width, point.y / height));
        float base = rand(vec2(floor(point.x), floor(point.y))) * PI22;
        float step = PI22 / float(samples);
        float dist = radius * 0.66;
        for (int i = 0; i < samples; i++) {
          float r = base + step * float(i);
          vec2 coord = point + vec2(cos(r) * dist, sin(r) * dist);
          tex += texture(inputBuffer, vec2(coord.x / width, coord.y / height));
        }
        tex /= float(samples) + 1.0;
        return tex;
      }
      
      float getDotColour(Cell c, vec2 p, int channel, float angle, float aa) {
        if (channel == 0) {
          c.samp1 = getSample(c.p1).r;
          c.samp2 = getSample(c.p2).r;
          c.samp3 = getSample(c.p3).r;
          c.samp4 = getSample(c.p4).r;
        } else if (channel == 1) {
          c.samp1 = getSample(c.p1).g;
          c.samp2 = getSample(c.p2).g;
          c.samp3 = getSample(c.p3).g;
          c.samp4 = getSample(c.p4).g;
        } else {
          c.samp1 = getSample(c.p1).b;
          c.samp2 = getSample(c.p2).b;
          c.samp3 = getSample(c.p3).b;
          c.samp4 = getSample(c.p4).b;
        }
        
        float dist_c_1 = distanceToDotRadius(c.samp1, c.p1, c.normal, p, angle, radius);
        float dist_c_2 = distanceToDotRadius(c.samp2, c.p2, c.normal, p, angle, radius);
        float dist_c_3 = distanceToDotRadius(c.samp3, c.p3, c.normal, p, angle, radius);
        float dist_c_4 = distanceToDotRadius(c.samp4, c.p4, c.normal, p, angle, radius);
        
        float res = (dist_c_1 > 0.0) ? clamp(dist_c_1 / aa, 0.0, 1.0) : 0.0;
        res += (dist_c_2 > 0.0) ? clamp(dist_c_2 / aa, 0.0, 1.0) : 0.0;
        res += (dist_c_3 > 0.0) ? clamp(dist_c_3 / aa, 0.0, 1.0) : 0.0;
        res += (dist_c_4 > 0.0) ? clamp(dist_c_4 / aa, 0.0, 1.0) : 0.0;
        return clamp(res, 0.0, 1.0);
      }
      
      Cell getReferenceCell(vec2 p, vec2 origin, float grid_angle, float step) {
        Cell c;
        vec2 n = vec2(cos(grid_angle), sin(grid_angle));
        float threshold = step * 0.5;
        float dot_normal = n.x * (p.x - origin.x) + n.y * (p.y - origin.y);
        float dot_line = -n.y * (p.x - origin.x) + n.x * (p.y - origin.y);
        vec2 offset = vec2(n.x * dot_normal, n.y * dot_normal);
        float offset_normal = mod(hypotf(offset.x, offset.y), step);
        float normal_dir = (dot_normal < 0.0) ? 1.0 : -1.0;
        float normal_scale = ((offset_normal < threshold) ? -offset_normal : step - offset_normal) * normal_dir;
        float offset_line = mod(hypotf((p.x - offset.x) - origin.x, (p.y - offset.y) - origin.y), step);
        float line_dir = (dot_line < 0.0) ? 1.0 : -1.0;
        float line_scale = ((offset_line < threshold) ? -offset_line : step - offset_line) * line_dir;
        
        c.normal = n;
        c.p1 = p - n * normal_scale + vec2(n.y, -n.x) * line_scale;
        
        if (scatter != 0.0) {
          float off_mag = scatter * threshold * 0.5;
          float off_angle = rand(vec2(floor(c.p1.x), floor(c.p1.y))) * PI22;
          c.p1 += vec2(cos(off_angle), sin(off_angle)) * off_mag;
        }
        float normal_step = normal_dir * ((offset_normal < threshold) ? step : -step);
        float line_step = line_dir * ((offset_line < threshold) ? step : -step);
        c.p2 = c.p1 - n * normal_step;
        c.p3 = c.p1 + vec2(n.y, -n.x) * line_step;
        c.p4 = c.p1 - n * normal_step + vec2(n.y, -n.x) * line_step;
        return c;
      }
      
      float blendColour(float a, float b, float t) {
        if (blendingMode == BLENDING_LINEAR) {
          return blend(a, b, 1.0 - t);
        } else if (blendingMode == BLENDING_ADD) {
          return blend(a, min(1.0, a + b), t);
        } else if (blendingMode == BLENDING_MULTIPLY) {
          return blend(a, max(0.0, a * b), t);
        } else if (blendingMode == BLENDING_LIGHTER) {
          return blend(a, max(a, b), t);
        } else if (blendingMode == BLENDING_DARKER) {
          return blend(a, min(a, b), t);
        } else {
          return blend(a, b, 1.0 - t);
        }
      }
      
      void main() {
        if (!disable) {
          vec2 p = vec2(vUV.x * width, vUV.y * height);
          vec2 origin = vec2(width * 0.5, height * 0.5);
          float aa = (radius < 2.5) ? radius * 0.5 : 1.25;
          
          Cell cell_r = getReferenceCell(p, origin, rotateR, radius);
          Cell cell_g = getReferenceCell(p, origin, rotateG, radius);
          Cell cell_b = getReferenceCell(p, origin, rotateB, radius);
          float r = getDotColour(cell_r, p, 0, rotateR, aa);
          float g = getDotColour(cell_g, p, 1, rotateG, aa);
          float b = getDotColour(cell_b, p, 2, rotateB, aa);
          
          vec4 colour = texture(inputBuffer, vUV);
          r = blendColour(r, colour.r, blending);
          g = blendColour(g, colour.g, blending);
          b = blendColour(b, colour.b, blending);
          
          if (greyscale) {
            r = g = b = (r + g + b) / 3.0;
          }
          outColor = vec4(r, g, b, 1.0);
        } else {
          outColor = texture(inputBuffer, vUV);
        }
      }
    `;
    
    this.halftoneProgram = this.createProgram(halftoneVSSource, halftoneFSSource);
    
    // Get uniform locations for halftone program
    this.halftoneUniforms = {
      inputBuffer: gl.getUniformLocation(this.halftoneProgram, 'inputBuffer'),
      radius: gl.getUniformLocation(this.halftoneProgram, 'radius'),
      rotateR: gl.getUniformLocation(this.halftoneProgram, 'rotateR'),
      rotateG: gl.getUniformLocation(this.halftoneProgram, 'rotateG'),
      rotateB: gl.getUniformLocation(this.halftoneProgram, 'rotateB'),
      scatter: gl.getUniformLocation(this.halftoneProgram, 'scatter'),
      width: gl.getUniformLocation(this.halftoneProgram, 'width'),
      height: gl.getUniformLocation(this.halftoneProgram, 'height'),
      shape: gl.getUniformLocation(this.halftoneProgram, 'shape'),
      disable: gl.getUniformLocation(this.halftoneProgram, 'disable'),
      blending: gl.getUniformLocation(this.halftoneProgram, 'blending'),
      blendingMode: gl.getUniformLocation(this.halftoneProgram, 'blendingMode'),
      greyscale: gl.getUniformLocation(this.halftoneProgram, 'greyscale')
    };
  }
  
  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  
  createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }
  
  setupBuffers() {
    const gl = this.gl;
    // Buffer for node/trail positions and colors
    this.nodesBuffer = gl.createBuffer();
    this.colorsBuffer = gl.createBuffer();
    
    // Quad buffer for full-screen pass in halftone effect
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
  }
  
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
  
  initShaders() {
    // Add Gaussian Blur shaders
    const blurVSSource = `#version 300 es
      precision mediump float;
      layout(location = 0) in vec2 a_position;
      out vec2 vUV;
      void main() {
        vUV = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0, 1);
      }
    `;

    const blurFSSource = `#version 300 es
      precision highp float;
      in vec2 vUV;
      out vec4 fragColor;
      
      uniform sampler2D u_image;
      uniform float u_blurSize;
      uniform vec2 u_direction;
      uniform vec2 u_resolution;
      
      // Gaussian weights for 15 samples (sigma ≈ 2.0)
      const float weights[15] = float[](
        0.0229, 0.0338, 0.0478, 0.0647, 0.0839,
        0.1041, 0.1239, 0.1414, 0.1541, 0.1414,
        0.1239, 0.1041, 0.0839, 0.0647, 0.0478
      );
      
      void main() {
        vec2 pixelSize = u_blurSize / u_resolution;
        vec4 color = vec4(0.0);
        float totalWeight = 0.0;
        
        // Sample in one direction (horizontal or vertical)
        for (int i = -7; i <= 7; i++) {
          vec2 offset = float(i) * pixelSize * u_direction;
          float weight = weights[abs(i) + 7];
          color += texture(u_image, vUV + offset) * weight;
          totalWeight += weight;
        }
        
        fragColor = color / totalWeight;
      }
    `;

    this.blurProgram = this.createProgram(blurVSSource, blurFSSource);
    this.blurUniforms = {
      image: this.gl.getUniformLocation(this.blurProgram, 'u_image'),
      blurSize: this.gl.getUniformLocation(this.blurProgram, 'u_blurSize'),
      direction: this.gl.getUniformLocation(this.blurProgram, 'u_direction'),
      resolution: this.gl.getUniformLocation(this.blurProgram, 'u_resolution')
    };

    // Create additional framebuffers for blur passes
    this.setupBlurFramebuffers();
  }

  setupBlurFramebuffers() {
    const gl = this.gl;
    
    // Horizontal blur FBO
    this.horizontalBlurTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.horizontalBlurTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    this.horizontalBlurFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.horizontalBlurFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.horizontalBlurTexture, 0);
    
    // Vertical blur FBO
    this.verticalBlurTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.verticalBlurTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    this.verticalBlurFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.verticalBlurFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.verticalBlurTexture, 0);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  
  setupGUI() {
    const gui = new GUI({ autoPlace: false });
    this.gui = gui;
    gui.domElement.classList.add('visualization-gui');
    document.body.appendChild(gui.domElement);
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '0';
    gui.domElement.style.right = '0';
    gui.domElement.style.zIndex = '9999';
    
    // Forze folder
    const forcesFolder = gui.addFolder('Forze');
    forcesFolder.add(this.params, 'forceCenterStrength', 0, 0.2)
      .name('Center Strength')
      .onChange(newVal => {
        if (!this.params.grouping) {
          this.simulation.force('x', d3.forceX(this.config.width / 2).strength(newVal));
          this.simulation.force('y', d3.forceY(this.config.height / 2).strength(newVal));
        }
        this.simulation.alpha(1).restart();
      });
    forcesFolder.add(this.params, 'forceCollideRadius', 0, 10)
      .name('Collide Radius')
      .onChange(newVal => {
        this.simulation.force('collide', d3.forceCollide(d => d.radius + newVal));
        this.simulation.alpha(1).restart();
      });
    
    // Grouping folder
    const groupingFolder = gui.addFolder('Grouping');
    groupingFolder.add(this.params, 'grouping')
      .name('Group by Supertype')
      .onChange(newVal => {
        if (newVal) {
          this.prevCenterStrength = this.params.forceCenterStrength;
          this.simulation.force('x', d3.forceX(this.config.width / 2).strength(0));
          this.simulation.force('y', d3.forceY(this.config.height / 2).strength(0));
        } else {
          this.simulation.force('x', d3.forceX(this.config.width / 2).strength(this.prevCenterStrength));
          this.simulation.force('y', d3.forceY(this.config.height / 2).strength(this.prevCenterStrength));
        }
        this.simulation.alpha(1).restart();
      });
    groupingFolder.add(this.params, 'groupingStrength', 0, 0.5)
      .name('Grouping Strength')
      .onChange(() => { this.simulation.alpha(1).restart(); });
    groupingFolder.add(this.params, 'groupingRadius', 50, 300)
      .name('Grouping Radius')
      .onChange(newVal => {
        const supertypes = Array.from(new Set(this.nodes.map(n => n.supertype)));
        const N = supertypes.length;
        const cx = this.config.width / 2;
        const cy = this.config.height / 2;
        supertypes.forEach((st, i) => {
          const angle = (2 * Math.PI * i) / N;
          this.groupCenters[st] = {
            x: cx + newVal * Math.cos(angle),
            y: cy + newVal * Math.sin(angle)
          };
        });
        this.simulation.alpha(1).restart();
      });
    
    // Simulation folder
    const simulationFolder = gui.addFolder('Simulation');
    simulationFolder.add(this.params, 'damping', 0, 1)
      .name('Damping')
      .onChange(newVal => {
        this.simulation.velocityDecay(newVal);
        this.simulation.alpha(1).restart();
      });
    simulationFolder.add(this.params, 'spawnDelay', 50, 1000)
      .name('Spawn Delay')
      .onChange(newVal => { this.spawnDelay = newVal; });
    
    // Nodes folder
    const nodesFolder = gui.addFolder('Nodi');
    nodesFolder.add(this.params, 'nodeSize', 10, 50)
      .name('Node Size')
      .onChange(newVal => {
        this.activeNodes.forEach(node => { node.radius = newVal; });
      });
    
    // Trails folder
    const trailsFolder = gui.addFolder('Trails');
    trailsFolder.add(this.params.trail, 'length', 10, 200).name('Trail Length');
    trailsFolder.add(this.params.trail, 'opacity', 0, 1).name('Trail Opacity');
    trailsFolder.add(this.params.trail, 'size', 1, 300).name('Trail Size');
    trailsFolder.add(this.params.trail, 'interval', 1, 10).name('Trail Interval');
    trailsFolder.add(this.params.trail, 'saturationScale', 0.1, 3).name('Saturation Scale');
    trailsFolder.add(this.params.trail, 'lightnessBase', 0.1, 1).name('Base Lightness');
    trailsFolder.add(this.params.trail, 'lightnessContrast', 0, 1).name('Lightness Contrast');
    trailsFolder.add(this.params.trail, 'blurSize', 0, 50)
      .name('Blur Size')
      .onChange(() => {
        // The blur will be updated in the next render
      });
    
    // Halftone folder
    const halftoneFolder = gui.addFolder('Halftone');
    halftoneFolder.add(this.params.halftone, 'radius', 0.5, 10);
    halftoneFolder.add(this.params.halftone, 'rotateR', 0, Math.PI * 2);
    halftoneFolder.add(this.params.halftone, 'rotateG', 0, Math.PI * 2);
    halftoneFolder.add(this.params.halftone, 'rotateB', 0, Math.PI * 2);
    halftoneFolder.add(this.params.halftone, 'scatter', 0, 5);
    halftoneFolder.add(this.params.halftone, 'shape', { Dot: 1, Ellipse: 2, Line: 3, Square: 4 });
    halftoneFolder.add(this.params.halftone, 'blending', 0, 1);
    halftoneFolder.add(this.params.halftone, 'blendingMode', { Linear: 1, Multiply: 2, Add: 3, Lighter: 4, Darker: 5 });
    halftoneFolder.add(this.params.halftone, 'greyscale');
    halftoneFolder.add(this.params.halftone, 'disable');
    
    // UI Controls folder
    const uiFolder = gui.addFolder('UI Controls');
    uiFolder.add({ removeDots: () => { 
      this.activeNodes = [];
      this.trails = [];
      this.simulation.alpha(1).restart();
    }}, 'removeDots').name('Remove All Dots');
    uiFolder.add({ startAnimation: () => { 
      this.activeNodes = [];
      this.trails = [];
      this.currentSpawnIndex = 0;
      this.lastSpawnTime = 0;
      this.simulation.alpha(1).restart();
    }}, 'startAnimation').name('Start Animation');
    
    // Colors folder: for each supertype, add a color controller
    const colorsFolder = gui.addFolder('Colors');
    const types = Array.from(new Set(this.nodes.map(n => n.supertype)));
    types.forEach(st => {
      const colorControl = { color: this.config.colors.superTypeColors(st) };
      colorsFolder.addColor(colorControl, 'color').name(st).onChange(newColor => {
        this.config.colors.superTypeColors.range(
          this.config.colors.superTypeColors.range().map(c =>
            c === this.config.colors.superTypeColors(st) ? newColor : c
          )
        );
        this.nodes.forEach(node => {
          if (node.supertype === st) {
            node.color = newColor;
          }
        });
      });
    });
    
    // Background color in UI Controls
    uiFolder.addColor({ background: '#ffffff' }, 'background').name('Background')
      .onChange(newColor => { this.canvas.style.background = newColor; });
  }
  
  setData(data) {
    // Create nodes from incoming data
    this.nodes = data.map(d => ({
      ...d,
      x: Math.random() * this.canvas.width,
      y: Math.random() * this.canvas.height,
      radius: d.radius || 5,
      color: d.color || this.config.colors.superTypeColors(d.supertype) || '#000'
    }));
    this.data = data;
    
    // Update supertype colors mapping
    const types = this.config.colors.superTypeColors.domain();
    types.forEach(st => {
      this.supertypeColors[st] = this.config.colors.superTypeColors(st);
    });
    
    // Pass nodes to the simulation
    this.simulation.nodes(this.nodes);
    
    // Initialize group centers
    const uniqueTypes = Array.from(new Set(this.nodes.map(n => n.supertype)));
    const N = uniqueTypes.length;
    const cx = this.config.width / 2;
    const cy = this.config.height / 2;
    uniqueTypes.forEach((st, i) => {
      const angle = (2 * Math.PI * i) / N;
      this.groupCenters[st] = {
        x: cx + this.params.groupingRadius * Math.cos(angle),
        y: cy + this.params.groupingRadius * Math.sin(angle)
      };
    });
    
    this.startSimulation();
  }
  
  updateNodePositions() {
    if (!this.gl) return;
    this.tickCount++;
    
    this.activeNodes.forEach((node, i) => {
      // Keep nodes within canvas bounds
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
    
    this.trails.forEach(trail => trail.age++);
    this.trails = this.trails.filter(trail => trail.age < this.params.trail.length);
  }
  
  drawTrails() {
    const gl = this.gl;
    const n = this.trails.length;
    if (n === 0) return;
    
    const trailPositions = new Float32Array(n * 2);
    const trailColors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = this.trails[i];
      trailPositions[i * 2] = t.x;
      trailPositions[i * 2 + 1] = t.y;
      // Convert to HSL and adjust with user-controlled parameters
      const hsl = d3.hsl(t.color);
      const adjustedSat = Math.min(1, hsl.s * (this.params.trail.saturationScale - hsl.l));
      const adjustedLight = this.params.trail.lightnessBase - 
                          (this.params.trail.lightnessContrast * Math.cos(Math.PI * hsl.l));
      hsl.s = adjustedSat;
      hsl.l = adjustedLight;
      const rgb = d3.rgb(hsl);
      const alpha = this.params.trail.opacity * (1 - t.age / this.params.trail.length);
      trailColors[i * 4] = rgb.r / 255;
      trailColors[i * 4 + 1] = rgb.g / 255;
      trailColors[i * 4 + 2] = rgb.b / 255;
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
    
    gl.uniform1f(this.nodesUniformLocations.pointSize, this.params.trail.size);
    gl.uniform1i(this.nodesUniformLocations.isTrail, true);
    gl.drawArrays(gl.POINTS, 0, n);
  }
  
  render(timestamp) {
    if (!this.gl) return;
    const gl = this.gl;
    
    // Spawn nodes based on delay
    if (timestamp - this.lastSpawnTime > this.spawnDelay && this.currentSpawnIndex < Math.min(this.maxNodes, this.nodes.length)) {
      this.activeNodes.push(this.nodes[this.currentSpawnIndex]);
      this.currentSpawnIndex++;
      this.lastSpawnTime = timestamp;
      this.simulation.alpha(1).restart();
    }
    
    // First pass: render only trails to offscreen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.offscreenFBO);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    gl.useProgram(this.nodesProgram);
    gl.uniform2f(this.nodesUniformLocations.resolution, this.canvas.width, this.canvas.height);
    
    // Draw only trails
    this.drawTrails();
    
    // Horizontal blur pass (only for trails)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.horizontalBlurFBO);
    gl.useProgram(this.blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.offscreenTexture);
    gl.uniform1i(this.blurUniforms.image, 0);
    gl.uniform1f(this.blurUniforms.blurSize, this.params.trail.blurSize);
    gl.uniform2f(this.blurUniforms.direction, 1, 0);
    gl.uniform2f(this.blurUniforms.resolution, this.canvas.width, this.canvas.height);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const blurPosLoc = gl.getAttribLocation(this.blurProgram, 'a_position');
    gl.enableVertexAttribArray(blurPosLoc);
    gl.vertexAttribPointer(blurPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // Vertical blur pass (only for trails)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.verticalBlurFBO);
    gl.bindTexture(gl.TEXTURE_2D, this.horizontalBlurTexture);
    gl.uniform2f(this.blurUniforms.direction, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // Final pass: composite blurred trails and sharp nodes
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Draw blurred trails (with halftone effect) using the vertical blur texture
    gl.useProgram(this.halftoneProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.verticalBlurTexture);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    var halftonePosLoc = gl.getAttribLocation(this.halftoneProgram, 'a_position');
    gl.enableVertexAttribArray(halftonePosLoc);
    gl.vertexAttribPointer(halftonePosLoc, 2, gl.FLOAT, false, 0, 0);
    this.setHalftoneUniforms();
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Draw sharp nodes on top as points using the nodes program
    gl.useProgram(this.nodesProgram);
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
  }
  
  animate(timestamp) {
    this.simulation.tick();
    this.render(timestamp);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }
  
  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.cleanupGUI();
    const gl = this.gl;
    if (gl) {
      if (this.offscreenTexture) gl.deleteTexture(this.offscreenTexture);
      if (this.offscreenDepth) gl.deleteRenderbuffer(this.offscreenDepth);
      if (this.offscreenFBO) gl.deleteFramebuffer(this.offscreenFBO);
      if (this.nodesBuffer) gl.deleteBuffer(this.nodesBuffer);
      if (this.colorsBuffer) gl.deleteBuffer(this.colorsBuffer);
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.nodesProgram) gl.deleteProgram(this.nodesProgram);
      if (this.halftoneProgram) gl.deleteProgram(this.halftoneProgram);
      if (this.horizontalBlurTexture) gl.deleteTexture(this.horizontalBlurTexture);
      if (this.horizontalBlurFBO) gl.deleteFramebuffer(this.horizontalBlurFBO);
      if (this.verticalBlurTexture) gl.deleteTexture(this.verticalBlurTexture);
      if (this.verticalBlurFBO) gl.deleteFramebuffer(this.verticalBlurFBO);
    }
    this.data = null;
    this.canvas = null;
    this.gl = null;
  }
  
  cleanupGUI() {
    const existingGUIs = document.querySelectorAll('.visualization-gui');
    existingGUIs.forEach(guiEl => {
      if (guiEl.parentElement) {
        guiEl.parentElement.removeChild(guiEl);
      }
    });
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
  }
  
  startSimulation() {
    if (this.simulation) {
      this.simulation.alpha(1).restart();
    }
  }
  
  // Helper method to set halftone uniforms
  setHalftoneUniforms() {
    const gl = this.gl;
    gl.uniform1i(this.halftoneUniforms.inputBuffer, 0);
    gl.uniform1f(this.halftoneUniforms.radius, this.params.halftone.radius);
    gl.uniform1f(this.halftoneUniforms.rotateR, this.params.halftone.rotateR);
    gl.uniform1f(this.halftoneUniforms.rotateG, this.params.halftone.rotateG);
    gl.uniform1f(this.halftoneUniforms.rotateB, this.params.halftone.rotateB);
    gl.uniform1f(this.halftoneUniforms.scatter, this.params.halftone.scatter);
    gl.uniform1f(this.halftoneUniforms.width, this.canvas.width);
    gl.uniform1f(this.halftoneUniforms.height, this.canvas.height);
    gl.uniform1i(this.halftoneUniforms.shape, this.params.halftone.shape);
    gl.uniform1f(this.halftoneUniforms.blending, this.params.halftone.blending);
    gl.uniform1i(this.halftoneUniforms.blendingMode, this.params.halftone.blendingMode);
    gl.uniform1i(this.halftoneUniforms.greyscale, this.params.halftone.greyscale ? 1 : 0);
    gl.uniform1i(this.halftoneUniforms.disable, this.params.halftone.disable ? 1 : 0);
  }
}
