// src/halftone.js
import React from 'react';
import { Uniform } from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { wrapEffect } from './util';
import { EffectComposer } from '@react-three/postprocessing';
import { useControls } from 'leva';
import { useEffect } from 'react';

const vertexShader = `
varying vec2 vUV;
void mainSupport(const in vec2 uv) {
  vUV = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HalftoneShader = {
  fragmentShader: `
  /* Ported from https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/HalftoneShader.js */
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
  uniform sampler2D tDiffuse;
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
  varying vec2 vUV;
  uniform bool greyscale;
  const int samples = 8;
  float blend( float a, float b, float t ) {
    return a * ( 1.0 - t ) + b * t;
  }
  float hypot( float x, float y ) {
    return sqrt( x * x + y * y );
  }
  float rand( vec2 seed ){
    return fract( sin( dot( seed.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  }
  float distanceToDotRadius( float channel, vec2 coord, vec2 normal, vec2 p, float angle, float rad_max ) {
    float dist = hypot( coord.x - p.x, coord.y - p.y );
    float rad = channel;
    if ( shape == SHAPE_DOT ) {
      rad = pow( abs( rad ), 1.125 ) * rad_max;
    } else if ( shape == SHAPE_ELLIPSE ) {
      rad = pow( abs( rad ), 1.125 ) * rad_max;
      if ( dist != 0.0 ) {
        float dot_p = abs( ( p.x - coord.x ) / dist * normal.x + ( p.y - coord.y ) / dist * normal.y );
        dist = ( dist * ( 1.0 - SQRT2_HALF_MINUS_ONE ) ) + dot_p * dist * SQRT2_MINUS_ONE;
      }
    } else if ( shape == SHAPE_LINE ) {
      rad = pow( abs( rad ), 1.5) * rad_max;
      float dot_p = ( p.x - coord.x ) * normal.x + ( p.y - coord.y ) * normal.y;
      dist = hypot( normal.x * dot_p, normal.y * dot_p );
    } else if ( shape == SHAPE_SQUARE ) {
      float theta = atan( p.y - coord.y, p.x - coord.x ) - angle;
      float sin_t = abs( sin( theta ) );
      float cos_t = abs( cos( theta ) );
      rad = pow( abs( rad ), 1.4 );
      rad = rad_max * ( rad + ( ( sin_t > cos_t ) ? rad - sin_t * rad : rad - cos_t * rad ) );
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
  vec4 getSample( vec2 point ) {
    vec4 tex = texture2D( inputBuffer, vec2( point.x / width, point.y / height ) );
    float base = rand( vec2( floor( point.x ), floor( point.y ) ) ) * PI22;
    float step = PI22 / float( samples );
    float dist = radius * 0.66;
    for ( int i = 0; i < samples; ++i ) {
      float r = base + step * float( i );
      vec2 coord = point + vec2( cos( r ) * dist, sin( r ) * dist );
      tex += texture2D( inputBuffer, vec2( coord.x / width, coord.y / height ) );
    }
    tex /= float( samples ) + 1.0;
    return tex;
  }
  float getDotColour( Cell c, vec2 p, int channel, float angle, float aa ) {
    float dist_c_1, dist_c_2, dist_c_3, dist_c_4, res;
    if ( channel == 0 ) {
      c.samp1 = getSample( c.p1 ).r;
      c.samp2 = getSample( c.p2 ).r;
      c.samp3 = getSample( c.p3 ).r;
      c.samp4 = getSample( c.p4 ).r;
    } else if (channel == 1) {
      c.samp1 = getSample( c.p1 ).g;
      c.samp2 = getSample( c.p2 ).g;
      c.samp3 = getSample( c.p3 ).g;
      c.samp4 = getSample( c.p4 ).g;
    } else {
      c.samp1 = getSample( c.p1 ).b;
      c.samp2 = getSample( c.p2 ).b;
      c.samp3 = getSample( c.p3 ).b;
      c.samp4 = getSample( c.p4 ).b;
    }
    dist_c_1 = distanceToDotRadius( c.samp1, c.p1, c.normal, p, angle, radius );
    dist_c_2 = distanceToDotRadius( c.samp2, c.p2, c.normal, p, angle, radius );
    dist_c_3 = distanceToDotRadius( c.samp3, c.p3, c.normal, p, angle, radius );
    dist_c_4 = distanceToDotRadius( c.samp4, c.p4, c.normal, p, angle, radius );
    res = ( dist_c_1 > 0.0 ) ? clamp( dist_c_1 / aa, 0.0, 1.0 ) : 0.0;
    res += ( dist_c_2 > 0.0 ) ? clamp( dist_c_2 / aa, 0.0, 1.0 ) : 0.0;
    res += ( dist_c_3 > 0.0 ) ? clamp( dist_c_3 / aa, 0.0, 1.0 ) : 0.0;
    res += ( dist_c_4 > 0.0 ) ? clamp( dist_c_4 / aa, 0.0, 1.0 ) : 0.0;
    res = clamp( res, 0.0, 1.0 );
    return res;
  }
  Cell getReferenceCell( vec2 p, vec2 origin, float grid_angle, float step ) {
    Cell c;
    vec2 n = vec2( cos( grid_angle ), sin( grid_angle ) );
    float threshold = step * 0.5;
    float dot_normal = n.x * ( p.x - origin.x ) + n.y * ( p.y - origin.y );
    float dot_line = -n.y * ( p.x - origin.x ) + n.x * ( p.y - origin.y );
    vec2 offset = vec2( n.x * dot_normal, n.y * dot_normal );
    float offset_normal = mod( hypot( offset.x, offset.y ), step );
    float normal_dir = ( dot_normal < 0.0 ) ? 1.0 : -1.0;
    float normal_scale = ( ( offset_normal < threshold ) ? -offset_normal : step - offset_normal ) * normal_dir;
    float offset_line = mod( hypot( ( p.x - offset.x ) - origin.x, ( p.y - offset.y ) - origin.y ), step );
    float line_dir = ( dot_line < 0.0 ) ? 1.0 : -1.0;
    float line_scale = ( ( offset_line < threshold ) ? -offset_line : step - offset_line ) * line_dir;
    c.normal = n;
    c.p1 = vec2( p.x - n.x * normal_scale + n.y * line_scale, p.y - n.y * normal_scale - n.x * line_scale );
    float normal_step = normal_dir * ( ( offset_normal < threshold ) ? step : -step );
    float line_step = line_dir * ( ( offset_line < threshold ) ? step : -step );
    c.p2 = vec2( c.p1.x - n.x * normal_step, c.p1.y - n.y * normal_step );
    c.p3 = vec2( c.p1.x + n.y * line_step, c.p1.y - n.x * line_step );
    c.p4 = vec2( c.p1.x - n.x * normal_step + n.y * line_step, c.p1.y - n.y * normal_step - n.x * line_step );
    return c;
  }
  float blendColour( float a, float b, float t ) {
    if ( blendingMode == BLENDING_LINEAR ) {
      return blend( a, b, 1.0 - t );
    } else if ( blendingMode == BLENDING_ADD ) {
      return blend( a, min( 1.0, a + b ), t );
    } else if ( blendingMode == BLENDING_MULTIPLY ) {
      return blend( a, max( 0.0, a * b ), t );
    } else if ( blendingMode == BLENDING_LIGHTER ) {
      return blend( a, max( a, b ), t );
    } else if ( blendingMode == BLENDING_DARKER ) {
      return blend( a, min( a, b ), t );
    } else {
      return blend( a, b, 1.0 - t );
    }
  }
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
    if ( ! disable ) {
      vec2 p = vec2( vUV.x * width, vUV.y * height );
      vec2 origin = vec2( 0, 0 );
      float aa = ( radius < 2.5 ) ? radius * 0.5 : 1.25;
      Cell cell_r = getReferenceCell( p, origin, rotateR, radius );
      Cell cell_g = getReferenceCell( p, origin, rotateG, radius );
      Cell cell_b = getReferenceCell( p, origin, rotateB, radius );
      float r = getDotColour( cell_r, p, 0, rotateR, aa );
      float g = getDotColour( cell_g, p, 1, rotateG, aa );
      float b = getDotColour( cell_b, p, 2, rotateB, aa );
      vec4 colour = texture2D( inputBuffer, vUV );
      r = blendColour( r, colour.r, blending );
      g = blendColour( g, colour.g, blending );
      b = blendColour( b, colour.b, blending );
      if ( greyscale ) {
        r = g = b = (r + g + b) / 3.0;
      }
      outputColor = vec4( r, g, b, 1.0 );
    } else {
      outputColor = texture2D( inputBuffer, vUV );
    }
  }
  `
};

export class HalftoneEffect extends Effect {
  constructor({
    blendFunction = BlendFunction.Normal,
    tDiffuse = null,
    shape = 1.0,
    radius = 2,
    rotateR = (Math.PI / 12) * 1,
    rotateG = (Math.PI / 12) * 2,
    rotateB = (Math.PI / 12) * 3,
    scatter = 0,
    width = 130,
    height = 130,
    blending = 1,
    blendingMode = 1,
    greyscale = false,
    disable = true
  } = {}) {
    super('HalftoneEffect', HalftoneShader.fragmentShader, {
      vertexShader,
      blendFunction,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['tDiffuse', new Uniform(tDiffuse)],
        ['shape', new Uniform(shape)],
        ['radius', new Uniform(radius)],
        ['rotateR', new Uniform(rotateR)],
        ['rotateG', new Uniform(rotateG)],
        ['rotateB', new Uniform(rotateB)],
        ['scatter', new Uniform(scatter)],
        ['width', new Uniform(width)],
        ['height', new Uniform(height)],
        ['blending', new Uniform(blending)],
        ['blendingMode', new Uniform(blendingMode)],
        ['greyscale', new Uniform(greyscale)],
        ['disable', new Uniform(disable)]
      ])
    });
  }
}

const Halftone = wrapEffect(HalftoneEffect);

function HalftoneEffects() {
  const { height } = useControls({
    height: { value: 130, min: 0, max: 200, step: 0.1 }
  });
  const { width } = useControls({
    width: { value: 130, min: 0, max: 200, step: 0.1 }
  });
  const { shape } = useControls({
    shape: { value: 1, min: 0, max: 4, step: 1 }
  });
  const { radius } = useControls({
    radius: { value: 0.7, min: 0.1, max: 4, step: 0.1 }
  });
  const { rotateR } = useControls({
    rotateR: { value: 12, min: 1, max: 30, step: 0.1 }
  });
  const { rotateG } = useControls({
    rotateG: { value: 12, min: 1, max: 30, step: 0.1 }
  });
  const { rotateB } = useControls({
    rotateB: { value: 12, min: 1, max: 30, step: 0.1 }
  });
  const { scatter } = useControls({
    scatter: { value: 0, min: 0, max: 5, step: 0.1 }
  });
  const { disable } = useControls({ disable: false });
  const { greyscale } = useControls({ greyscale: false });
  
  return (
    <EffectComposer>
      <Halftone
        shape={shape}
        radius={radius}
        width={width}
        height={height}
        disable={disable}
        rotateR={(Math.PI / rotateR) * 1}
        rotateG={(Math.PI / rotateG) * 2}
        rotateB={(Math.PI / rotateB) * 3}
        greyscale={greyscale}
        scatter={scatter}
      />
    </EffectComposer>
  );
}

export default HalftoneEffects;
