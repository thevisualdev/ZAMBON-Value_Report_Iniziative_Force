// src/App.js
import React from 'react';
import { Canvas } from '@react-three/fiber';
import InitiativesVisualization from './InitiativesVisualization';
import HalftoneEffects from './halftone';
import './styles/main.css';

export default function App() {
  return (
    <Canvas>
      <color attach="background" args={['black']} />
      <HalftoneEffects />
      <InitiativesVisualization />
    </Canvas>
  );
}
