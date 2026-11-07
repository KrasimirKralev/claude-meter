import { useEffect, useState } from 'react';
import { changeView, fitView, setBubbleColor, tidyMap } from '../canvas/actions.ts';
import { digitize } from '../digitize/run.ts';
import { isLiveProposal } from '../doc/proposals.ts';
import type { MapStyleId } from '../doc/types.ts';
import { MAP_STYLES } from '../map/styles.ts';
import { store, useStore } from '../state/store.ts';
import { Button, Panel } from './primitives.tsx';

const STYLE_ORDER: MapStyleId[] = ['candy', 'sunny', 'yellow'];

export const StylePanel = () => {
  const style = useStore((s) => s.doc.style);
  const bulgarian = useStore((s) => s.doc.bulgarianLetters);
  const selectedId = useStore((s) => s.ui.selectedBubble);
  const bubble = useStore((s) => s.doc.bubbles.find((b) => b.id === selectedId));
  const doc = useStore((s) => s.doc);
  const pending = doc.proposals.filter((p) => p.status === 'pending' && isLiveProposal(doc, p)).length;
  const [, setLoaded] = useState(0);

  // Every style's name is shown in its own fonts, so they load once this panel opens.
  useEffect(() => {
    void Promise.all(STYLE_ORDER.map((id) => MAP_STYLES[id].load())).then(() => setLoaded(1));
  }, []);

  const choose = (id: MapStyleId): void => {
    store.commit((current) => ({ ...current, style: id }));
    void MAP_STYLES[id].load().then(() => document.fonts.ready.then(() => fitView()));
  };

  return (
    <Panel aria-label="Map style">
      <h2 className="mb-3 text-[22px] leading-tight font-semibold tracking-[-0.01em]">Map style</h2>
      <div className="grid gap-2" role="group" aria-label="Map style">
        {STYLE_ORDER.map((id) => {
          const option = MAP_STYLES[id];
          const pressed = style === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={pressed}
              onClick={() => choose(id)}
              className={`grid gap-0.5 rounded-lg text-left ${
                pressed ? 'border-2 border-accent bg-soft p-[9px]' : 'border border-line p-2.5 hover:bg-hover'
              }`}
            >
              <span className="mb-1.5 flex gap-1">
                {option.swatches.map((color) => (
                  <i
                    key={color}
                    className="block size-[18px] rounded-full"
                    style={{ background: color, boxShadow: 'inset 0 0 0 1px var(--line)' }}
                  />
                ))}
              </span>
              <b
                className="text-[15px] leading-tight"
                style={{ fontFamily: option.titleFont, fontWeight: option.titleWeight }}
              >
                {option.name}
              </b>
              <small
                className="text-[13px] text-mute"
                style={{ fontFamily: option.bodyFont, fontWeight: option.bodyWeight }}
              >
                {option.titleFont} + {option.bodyFont}
              </small>
            </button>
          );
        })}
      </div>

      {bubble && bubble.kind === 'group' && (
        <div className="mt-4">
          <h3 className="mb-2 text-[13px] font-semibold text-mute">This bubble's colour</h3>
          <div className="flex gap-2" role="group" aria-label="Bubble colour">
            {MAP_STYLES[style].colors.map((color, slot) => (
              <button
                key={slot}
                type="button"
                aria-label={`Colour ${slot + 1}`}
                aria-pressed={bubble.slot === slot}
                onClick={() => setBubbleColor(bubble.id, slot)}
                className={`size-8 rounded-full ${
                  bubble.slot === slot ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
                }`}
                style={{ background: color }}
              />
            ))}
          </div>
        </div>
      )}

      {MAP_STYLES[style].hasLetterSwitch && (
        <label className="mt-4 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-blue"
            checked={bulgarian}
            onChange={(e) =>
              store.commit((current) => ({ ...current, bulgarianLetters: e.target.checked }))
            }
          />
          Bulgarian letter shapes
        </label>
      )}

      <Button className="mt-4 w-full" onClick={tidyMap}>
        Tidy the layout
      </Button>
      <Button
        className="mt-2 w-full"
        onClick={() => {
          changeView('both');
          void digitize();
        }}
      >
        Ask AI for more ideas
      </Button>

      {pending > 0 && (
        <Button variant="primary" className="mt-2 w-full" onClick={() => changeView('both')}>
          {pending} {pending === 1 ? 'proposal' : 'proposals'} waiting
        </Button>
      )}
    </Panel>
  );
};
