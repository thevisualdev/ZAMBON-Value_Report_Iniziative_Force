import { forwardRef } from 'react';
import { Object3D } from 'three';
import { Effect } from 'postprocessing';

interface PrimitiveProps {
  object: Object3D | Effect;
  dispose?: any;
}

export const Primitive = forwardRef<Object3D | Effect, PrimitiveProps>(
  ({ object, dispose }, ref) => {
    return null; // React Three Fiber will handle the actual rendering
  }
);