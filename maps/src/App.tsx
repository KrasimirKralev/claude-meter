import { useEffect, useState } from 'react';
import { fitView } from './canvas/actions.ts';
import { Surface } from './canvas/Surface.tsx';
import { isLiveProposal } from './doc/proposals.ts';
import { MAP_STYLES } from './map/styles.ts';
import { startPersistence } from './state/persist.ts';
import { store, useStore } from './state/store.ts';
import { Chrome } from './ui/Chrome.tsx';
import { ProposalsPanel } from './ui/ProposalsPanel.tsx';
import { ShortcutsPanel, useShortcuts } from './ui/Shortcuts.tsx';
import { StylePanel } from './ui/StylePanel.tsx';

const Toast = () => {
  const toast = useStore((s) => s.ui.toast);
  return (
    <div className="pointer-events-none absolute bottom-20 left-1/2 z-40 -translate-x-1/2" aria-live="polite">
      {toast && (
        <div className="max-w-[560px] rounded-xl border border-line bg-surface px-4 py-2.5 shadow-float">
          {toast.text}
        </div>
      )}
    </div>
  );
};

const SidePanel = () => {
  const view = useStore((s) => s.ui.view);
  const doc = useStore((s) => s.doc);
  const streaming = useStore((s) => s.ui.digitize.state !== 'idle');
  const helpOpen = useStore((s) => s.ui.menu === 'help');
  if (helpOpen) return null;
  if (view === 'map') return <StylePanel />;
  const any = doc.proposals.some((p) => isLiveProposal(doc, p));
  return any || streaming ? <ProposalsPanel /> : null;
};

const PresentHint = () => (
  <div className="present-hint">Arrow keys walk the map. Esc leaves.</div>
);

export const App = () => {
  const [ready, setReady] = useState(false);
  const presenting = useStore((s) => s.ui.present !== null);
  const menu = useStore((s) => s.ui.menu);
  useShortcuts();

  useEffect(() => {
    void startPersistence()
      .then(() => MAP_STYLES[store.doc.style].load())
      .catch((error: unknown) => {
        // A missing font must never keep the toolbars from appearing.
        console.error('Starting up hit a problem', error);
      })
      .finally(() => {
        setReady(true);
        requestAnimationFrame(() => fitView(false));
      });
  }, []);

  // Focus left on a clicked button would swallow Enter and Space, which belong to the canvas.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const active = document.activeElement;
      if (e.detail > 0 && active instanceof HTMLElement && active.matches('button, [type=checkbox]')) {
        active.blur();
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!menu || menu === 'help') return undefined;
    const close = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement).closest('[role=menu],[aria-haspopup]')) {
        store.setUi({ menu: null });
      }
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menu]);

  return (
    <>
      <Surface />
      {ready && !presenting && (
        <>
          <Chrome />
          <SidePanel />
          <ShortcutsPanel />
        </>
      )}
      {presenting && <PresentHint />}
      <Toast />
      <div className="too-narrow">
        <div>
          <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-14" />
          <p className="m-0">
            Balonche needs a wider window, at least 1024 pixels. It is made for a mouse or a large
            board.
          </p>
        </div>
      </div>
    </>
  );
};
