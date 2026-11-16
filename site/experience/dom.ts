export function element<T extends Element = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T {
  const found = parent.querySelector<T>(selector);
  if (!found) throw new Error(`Website element missing: ${selector}`);
  return found;
}

export interface MotionContext {
  reduced: () => boolean;
  moving: () => boolean;
  animations: Set<Animation>;
}

export function play(
  target: HTMLElement,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
  context: MotionContext,
): Animation | null {
  if (!context.moving()) return null;
  const animation = target.animate(frames, options);
  context.animations.add(animation);
  const release = () => context.animations.delete(animation);
  animation.onfinish = release;
  animation.oncancel = release;
  return animation;
}
