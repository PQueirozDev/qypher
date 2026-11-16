import '@fontsource-variable/inter';
import './styles.css';
import { asciiFrame } from '../desktop/src/ascii';

const frame = document.querySelector('#ascii-frame');
const motion = document.querySelector('#motion-toggle');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let paused = false;
let visible = true;
let elapsed = 0;
let timer;
function render() {
  frame.textContent = asciiFrame(elapsed, 'shield');
}
function update() {
  clearInterval(timer);
  render();
  if (!paused && !reduced.matches && !document.hidden && visible) {
    timer = setInterval(() => {
      elapsed += 0.085;
      render();
    }, 85);
  }
}
motion.addEventListener('click', () => {
  paused = !paused;
  motion.setAttribute('aria-pressed', String(paused));
  motion.textContent = paused ? 'Retomar visual ▷' : 'Pausar visual Ⅱ';
  update();
});
reduced.addEventListener('change', update);
document.addEventListener('visibilitychange', update);
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  update();
}).observe(frame);
update();

const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-navigation');
function closeMenu() {
  menu.setAttribute('aria-expanded', 'false');
  navigation.classList.remove('open');
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('open', open);
});
navigation.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.site-header')) closeMenu();
});
