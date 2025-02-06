import { forwardRef, useMemo, useLayoutEffect } from 'react';
import { Vector2, Object3D } from 'three';
import { useThree } from '@react-three/fiber';
import { Effect, BlendFunction } from 'postprocessing';
import { Primitive } from './components/Primitive';

interface BaseEffectProps {
  blendFunction?: BlendFunction;
  opacity?: number;
}

type EffectProps<T> = T extends new (...args: infer P) => any 
  ? P[0] & BaseEffectProps 
  : never;

export const wrapEffect = <T extends new (...args: any[]) => Effect>(
  EffectImpl: T,
  defaultBlendMode: BlendFunction = BlendFunction.NORMAL
) => {
  return forwardRef<Effect, EffectProps<T>>((props, ref) => {
    const { blendFunction, opacity, ...rest } = props as BaseEffectProps & Record<string, any>;
    const invalidate = useThree((state) => state.invalidate);
    
    const effect = useMemo(() => new EffectImpl(rest), [rest]);

    useLayoutEffect(() => {
      effect.blendMode.blendFunction = 
        blendFunction !== undefined ? blendFunction : defaultBlendMode;
      if (opacity !== undefined) effect.blendMode.opacity.value = opacity;
      invalidate();
    }, [blendFunction, effect.blendMode, opacity, invalidate]);

    return (
      <Primitive
        ref={ref as any}
        object={effect}
        dispose={null}
      />
    );
  });
};

export const useVector2 = (props: any, key: string): Vector2 => {
  const vec: Vector2 | [number, number] = props[key];
  return useMemo(() => {
    if (vec instanceof Vector2) {
      return new Vector2(vec.x, vec.y);
    } else if (Array.isArray(vec)) {
      const [x, y] = vec;
      return new Vector2(x, y);
    }
    return new Vector2(0, 0);
  }, [vec]);
};