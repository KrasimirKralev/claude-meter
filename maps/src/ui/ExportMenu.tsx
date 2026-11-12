import { useRef } from 'react';
import { fitView } from '../canvas/actions.ts';
import { stopDigitize } from '../digitize/run.ts';
import { exportPng, exportSvg } from '../export/image.ts';
import { docToPlanMarkdown, planForClaudeCode } from '../export/markdown.ts';
import { docFromJson, docToJson, openNewMap } from '../state/persist.ts';
import { showToast, store, useStore } from '../state/store.ts';
import { Button, Icon } from './primitives.tsx';

const fileName = (extension: string): string => {
  const name = store.doc.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'map';
  return `${name}.${extension}`;
};

const download = (content: Blob | string, name: string, type: string): void => {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const hasMap = (): boolean => store.doc.bubbles.some((b) => b.status === 'accepted');

export const ExportMenu = ({ primary }: { primary: boolean }) => {
  const open = useStore((s) => s.ui.menu === 'export');
  const importRef = useRef<HTMLInputElement>(null);

  const run = (action: () => void | Promise<void>): void => {
    store.setUi({ menu: null });
    Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        console.error('Export failed', error);
        showToast('That export failed. Your map is safe. Try again.');
      });
  };

  const needsMap = (action: () => void | Promise<void>) => () =>
    run(() => {
      if (!hasMap()) {
        showToast('Nothing on the finished map yet. Digitize and accept some proposals first.');
        return undefined;
      }
      return action();
    });

  const item = 'block w-full rounded-lg px-2.5 py-2 text-left font-medium hover:bg-hover';

  return (
    <div className="relative">
      <Button
        variant={primary ? 'primary' : 'ghost'}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1"
        onClick={() => store.setUi({ menu: open ? null : 'export' })}
      >
        Export
        <Icon name="chevron" size={14} />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute top-11 right-0 z-20 w-[250px] rounded-xl border border-line bg-surface p-1.5 shadow-float"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={needsMap(async () => {
              await navigator.clipboard.writeText(planForClaudeCode(store.doc));
              showToast('Plan copied. Paste it into Claude Code.');
            })}
          >
            Copy plan for Claude Code
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={needsMap(() =>
              download(docToPlanMarkdown(store.doc), fileName('md'), 'text/markdown'),
            )}
          >
            Markdown file
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={needsMap(async () => download(await exportPng(), fileName('png'), 'image/png'))}
          >
            PNG image
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={needsMap(async () =>
              download(await exportSvg(), fileName('svg'), 'image/svg+xml'),
            )}
          >
            SVG image
          </button>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() =>
              run(() => download(docToJson(store.doc), fileName('json'), 'application/json'))
            }
          >
            JSON backup
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => importRef.current?.click()}
          >
            Open a JSON backup
          </button>
        </div>
      )}
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="import-json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          store.setUi({ menu: null });
          if (!file) return;
          file
            .text()
            .then((json) => {
              const doc = docFromJson(json);
              stopDigitize();
              openNewMap(doc);
              requestAnimationFrame(() => fitView(false));
              showToast(`Opened ${file.name}.`);
            })
            .catch((error: unknown) => {
              console.error('Import failed', error);
              showToast('That file is not a Balonche map, so nothing changed.');
            });
        }}
      />
    </div>
  );
};
