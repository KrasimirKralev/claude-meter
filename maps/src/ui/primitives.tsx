import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

const ICONS = {
  select: <path d="M5 3l14 8.5-6 1.6L10 19z" />,
  pen: (
    <>
      <path d="M4 20l1-5L16 4l4 4L9 19z" />
      <path d="M14 6l4 4" />
    </>
  ),
  eraser: (
    <>
      <path d="M8 20h12" />
      <path d="M5.5 14.5l8-8a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L12 20H8.5l-3-3a1.8 1.8 0 010-2.5z" />
    </>
  ),
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  arrow: <path d="M4 20L20 4M10 4h10v10" />,
  lasso: (
    <>
      <ellipse cx="12" cy="9" rx="9" ry="6" />
      <path d="M8 15c-2 1-2 4 1 4 2 0 2 2 1 3" />
    </>
  ),
  undo: (
    <>
      <path d="M9 6L4 11l5 5" />
      <path d="M4 11h10a5 5 0 010 10h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15 6l5 5-5 5" />
      <path d="M20 11H10a5 5 0 000 10h3" />
    </>
  ),
  check: <path d="M4 12l5 5L20 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  play: <path d="M7 4l13 8-13 8z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export type IconName = keyof typeof ICONS;

export const Icon = ({ name, size = 18 }: { name: IconName; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="block"
  >
    {ICONS[name]}
  </svg>
);

export const Pill = ({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`absolute z-10 flex items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-float ${className}`}
    {...rest}
  >
    {children}
  </div>
);

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  pressed?: boolean;
  hint?: string;
}

export const IconButton = ({ icon, label, pressed, hint, className = '', ...rest }: IconButtonProps) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={pressed}
    title={hint ? `${label} (${hint})` : label}
    className={`grid size-9 place-items-center rounded-lg disabled:opacity-35 ${
      pressed ? 'bg-soft text-accent-ink' : 'hover:bg-hover disabled:hover:bg-transparent'
    } ${className}`}
    {...rest}
  >
    <Icon name={icon} />
  </button>
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'plain';
  small?: boolean;
  children: ReactNode;
}

export const Button = ({ variant = 'ghost', small, className = '', children, ...rest }: ButtonProps) => {
  const look = {
    primary: 'bg-blue text-white hover:bg-blue-hover',
    ghost: 'border border-line bg-surface text-ink hover:bg-hover',
    plain: 'text-accent-ink hover:underline underline-offset-2',
  }[variant];
  return (
    <button
      type="button"
      className={`rounded-lg font-semibold disabled:opacity-40 ${
        small ? 'px-3 py-1 text-[13px]' : 'px-3.5 py-2'
      } ${look} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

export const Panel = ({ className = '', children, ...rest }: HTMLAttributes<HTMLElement>) => (
  <aside
    className={`scroll-thin absolute top-[84px] right-4 z-10 max-h-[calc(100vh-108px)] w-[300px] overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-float ${className}`}
    {...rest}
  >
    {children}
  </aside>
);
