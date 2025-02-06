import { Object3D } from 'three';
import { Effect } from 'postprocessing';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      primitive: {
        ref?: any;
        object: Object3D | Effect;
        dispose?: any;
        children?: React.ReactNode;
      }
    }
  }
}

declare module '@react-three/fiber' {
  interface ThreeElements {
    primitive: {
      ref?: any;
      object: Object3D | Effect;
      dispose?: any;
      children?: React.ReactNode;
    }
  }
}

declare module 'postprocessing' {
  interface Effect extends Object3D {
    blendMode: {
      blendFunction: number;
      opacity: { value: number };
    };
  }
}

export {};