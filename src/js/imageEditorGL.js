export class ImageEditorGL {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2');
    if (!this.gl) {
      throw new Error('WebGL2 not supported');
    }

    this.initShaders();
    this.setupBuffers();
    this.setupTexture();
  }

  initShaders() {
    // Vertex shader for rendering a fullscreen quad
    const vsSource = `#version 300 es
      precision mediump float;
      layout(location = 0) in vec2 a_position;
      out vec2 vUV;
      void main() {
        vUV = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);
        gl_Position = vec4(a_position, 0, 1);
      }
    `;

    // Fragment shader (reusing the halftone shader from simulation.js)
    const fsSource = `#version 300 es
      precision mediump float;
      in vec2 vUV;
      out vec4 fragColor;
      
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

      uniform sampler2D u_image;
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
        vec4 tex = texture(u_image, vec2(point.x / u_width, point.y / u_height));
        float base = rand(vec2(floor(point.x), floor(point.y)))* PI22;
        float step = PI22 / 8.0;
        float dist = u_radius * 0.66;
        for (int i = 0; i < 8; ++i) {
          float r = base + step * float(i);
          vec2 coord = point + vec2(cos(r)*dist, sin(r)*dist);
          tex += texture(u_image, vec2(coord.x / u_width, coord.y / u_height));
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
        if (u_disable) {
          vec4 color = texture(u_image, vUV);
          fragColor = color;
          return;
        }

        vec4 originalColor = texture(u_image, vUV);
        
        // Preserve alpha channel
        float alpha = originalColor.a;
        
        vec2 p = vec2(vUV.x*u_width, vUV.y*u_height);
        vec2 origin = vec2(0.0,0.0);
        float aa = (u_radius<2.5)? u_radius*0.5 : 1.25;
        Cell cell_r = getReferenceCell(p,origin, u_rotateR, u_radius);
        Cell cell_g = getReferenceCell(p,origin, u_rotateG, u_radius);
        Cell cell_b = getReferenceCell(p,origin, u_rotateB, u_radius);
        float r = getDotColour(cell_r, p, 0, u_rotateR, aa);
        float g = getDotColour(cell_g, p, 1, u_rotateG, aa);
        float b = getDotColour(cell_b, p, 2, u_rotateB, aa);
        vec4 orig = originalColor;
        r = blendColour(r, orig.r, u_blending);
        g = blendColour(g, orig.g, u_blending);
        b = blendColour(b, orig.b, u_blending);
        if(u_greyscale){
          float grey = (r+g+b)/3.0;
          r = g = b = grey;
        }
        fragColor = vec4(r, g, b, 1.0);
        
        // Apply alpha at the end
        fragColor.a = alpha;
      }
    `;

    this.program = this.createProgram(vsSource, fsSource);
    this.uniforms = this.getUniformLocations();
  }

  setupBuffers() {
    // Create a quad that fills the screen
    const positions = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1
    ]);

    this.quadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
  }

  setupTexture() {
    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
  }

  loadImage(image) {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
  }

  render(params) {
    const gl = this.gl;
    
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    
    // Set uniforms
    gl.uniform1f(this.uniforms.radius, params.halftone.radius);
    gl.uniform1f(this.uniforms.rotateR, params.halftone.rotateR);
    gl.uniform1f(this.uniforms.rotateG, params.halftone.rotateG);
    gl.uniform1f(this.uniforms.rotateB, params.halftone.rotateB);
    gl.uniform1f(this.uniforms.scatter, params.halftone.scatter);
    gl.uniform1f(this.uniforms.width, this.canvas.width);
    gl.uniform1f(this.uniforms.height, this.canvas.height);
    gl.uniform1i(this.uniforms.shape, params.halftone.shape);
    gl.uniform1i(this.uniforms.blendingMode, params.halftone.blendingMode);
    gl.uniform1f(this.uniforms.blending, params.halftone.blending);
    gl.uniform1i(this.uniforms.greyscale, params.halftone.greyscale);
    gl.uniform1i(this.uniforms.disable, params.halftone.disable);

    // Draw
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Helper methods for shader compilation and program creation
  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
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
    
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Program link error:', this.gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  getUniformLocations() {
    return {
      image: this.gl.getUniformLocation(this.program, 'u_image'),
      radius: this.gl.getUniformLocation(this.program, 'u_radius'),
      rotateR: this.gl.getUniformLocation(this.program, 'u_rotateR'),
      rotateG: this.gl.getUniformLocation(this.program, 'u_rotateG'),
      rotateB: this.gl.getUniformLocation(this.program, 'u_rotateB'),
      scatter: this.gl.getUniformLocation(this.program, 'u_scatter'),
      width: this.gl.getUniformLocation(this.program, 'u_width'),
      height: this.gl.getUniformLocation(this.program, 'u_height'),
      shape: this.gl.getUniformLocation(this.program, 'u_shape'),
      disable: this.gl.getUniformLocation(this.program, 'u_disable'),
      blending: this.gl.getUniformLocation(this.program, 'u_blending'),
      blendingMode: this.gl.getUniformLocation(this.program, 'u_blendingMode'),
      greyscale: this.gl.getUniformLocation(this.program, 'u_greyscale')
    };
  }
} 