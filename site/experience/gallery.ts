import { element, play, type MotionContext } from './dom.ts';

export function createGallery(context: MotionContext) {
  const abort = new AbortController();
  const { signal } = abort;
  const list = element('#product-tabs');
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  let animation: Animation | null = null;
  function select(tab: HTMLButtonElement) {
    tabs.forEach((other) => {
      const active = other === tab;
      other.setAttribute('aria-selected', String(active));
      other.tabIndex = active ? 0 : -1;
      const panel = element(`#${other.getAttribute('aria-controls')}`);
      panel.hidden = !active;
      if (active && context.moving()) {
        animation?.cancel();
        animation = play(
          panel,
          [
            { opacity: 0.3, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 380, easing: 'ease-out' },
          context,
        );
      }
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab), { signal });
    tab.addEventListener(
      'keydown',
      (event) => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[next].focus();
        select(tabs[next]);
      },
      { signal },
    );
  });
  list.hidden = false;
  element('#terminal-preview').setAttribute('role', 'tabpanel');
  element('#terminal-preview').setAttribute('aria-labelledby', 'tab-terminal');
  return {
    settle() {
      animation?.finish();
    },
    destroy() {
      abort.abort();
      animation?.cancel();
    },
  };
}
