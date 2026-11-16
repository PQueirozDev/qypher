import { createRadar } from './radar.ts';
import { createTerminal } from './terminal.ts';
import { createAscii, createTextReveals } from './ascii.ts';
import { createGallery } from './gallery.ts';
import type { MotionContext } from './dom.ts';

export function createExperience(context: MotionContext) {
  const terminal = createTerminal(context);
  const radar = createRadar(context, terminal.detection);
  const ascii = createAscii();
  const text = createTextReveals(context);
  const gallery = createGallery(context);
  return {
    tick(time: number, delta: number, radarVisible: boolean, terminalVisible: boolean) {
      radar.tick(delta, time, radarVisible);
      terminal.tick(delta, terminalVisible);
      ascii.tick(delta);
      text.tick(time);
    },
    settle() {
      terminal.settle();
      radar.settle();
      ascii.settle();
      text.settle();
      gallery.settle();
    },
    destroy() {
      terminal.destroy();
      radar.destroy();
      ascii.destroy();
      text.destroy();
      gallery.destroy();
    },
  };
}
