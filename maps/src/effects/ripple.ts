// The signature moment: a ring of lit dots crosses the canvas from where Digitize happened.

let element: HTMLElement | null = null;

export const registerRipple = (target: HTMLElement | null): void => {
  element = target;
};

export const ripple = (x: number, y: number): void => {
  if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 200;
  element.style.setProperty('--ripple-x', `${x}px`);
  element.style.setProperty('--ripple-y', `${y}px`);
  element.animate(
    [
      { opacity: 0.95, '--ripple-r': '0px' },
      { opacity: 0.9, offset: 0.7 },
      { opacity: 0, '--ripple-r': `${reach}px` },
    ],
    { duration: 720, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  );
};
