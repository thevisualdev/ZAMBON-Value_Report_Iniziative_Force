// src/InitiativesVisualization.js
import React, { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export default function InitiativesVisualization() {
  const [initiatives, setInitiatives] = useState([]);

  useEffect(() => {
    fetch('/initiatives.json')
      .then((res) => {
        if (!res.ok) {
          throw new Error('Network response was not ok');
        }
        return res.json();
      })
      .then((data) => {
        setInitiatives(data);
      })
      .catch(err => console.error("Error loading data:", err));
  }, []);

  return (
    <>
      {initiatives.map((init) => (
        <InitiativeNode
          key={init.id}
          initiative={init}
          // Per l'esempio: posizioni casuali. In produzione potresti calcolare le posizioni in modo specifico.
          position={[Math.random() * 10 - 5, Math.random() * 10 - 5, 0]}
        />
      ))}
    </>
  );
}

function InitiativeNode({ initiative, position }) {
  const mesh = useRef();
  // Mappa dei colori in base al supertype
  const colors = {
    Zambon: 'orange',
    'Zambon Pharma': 'green',
    'Zambon Biotech': 'blue',
    Openzone: 'red'
  };
  const color = colors[initiative.supertype] || 'gray';

  useFrame((state, delta) => {
    if (mesh.current) {
      mesh.current.rotation.y += delta * 0.1;
    }
  });

  return (
    <mesh ref={mesh} position={position}>
      <sphereGeometry args={[0.5, 32, 32]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}
