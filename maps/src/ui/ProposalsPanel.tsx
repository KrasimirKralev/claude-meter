import { changeView } from '../canvas/actions.ts';
import { retryAi } from '../digitize/run.ts';
import {
  acceptAll,
  acceptProposal,
  currentProposal,
  isLiveProposal,
  proposalLabel,
  rejectProposal,
  restoreProposal,
} from '../doc/proposals.ts';
import type { MapDoc, Proposal } from '../doc/types.ts';
import { store, useStore } from '../state/store.ts';
import { Button, Icon, Panel } from './primitives.tsx';

const seconds = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

const targetBubble = (proposal: Proposal, doc: MapDoc): string | null => {
  const body = proposal.body;
  if ('bubble' in body) return body.bubble;
  if (body.kind === 'link') return doc.links.find((l) => l.id === body.link)?.from ?? null;
  if (body.kind === 'move-item') return body.from;
  return null;
};

/** Separates the kind of proposal from its content, so a long list can be scanned. */
const Label = ({ text }: { text: string }) => {
  const split = text.indexOf(': ');
  if (split < 0 || split > 24) return <>{text}</>;
  return (
    <>
      <span className="font-normal text-mute">{text.slice(0, split + 1)}</span> {text.slice(split + 2)}
    </>
  );
};

interface RowProps {
  proposal: Proposal;
  label: string;
  focused: boolean;
  doc: MapDoc;
}

const Row = ({ proposal, label, focused, doc }: RowProps) => {
  if (proposal.status === 'accepted') {
    return (
      <li className="flex items-center gap-2 rounded-lg bg-raised px-2.5 py-1.5 font-medium">
        <span className="flex-none text-ok">
          <Icon name="check" size={16} />
        </span>
        <span className="min-w-0 break-words">
          <Label text={label} />
        </span>
      </li>
    );
  }
  if (proposal.status === 'rejected') {
    return (
      <li className="flex items-start justify-between gap-2 px-2.5 py-1.5 text-mute">
        <s className="min-w-0 break-words">{label}</s>
        <Button
          variant="plain"
          small
          className="!p-0"
          onClick={() => store.commit((current) => restoreProposal(current, proposal.id))}
        >
          Undo
        </Button>
      </li>
    );
  }
  if (!focused) {
    return (
      <li>
        <button
          type="button"
          className="w-full rounded-lg border border-line p-2.5 text-left font-medium break-words hover:bg-hover"
          onClick={() =>
            store.setUi({
              focusedProposal: proposal.id,
              selectedBubble: targetBubble(proposal, doc),
            })
          }
        >
          <Label text={label} />
        </button>
      </li>
    );
  }
  return (
    <li className="rounded-lg border-2 border-accent bg-soft p-[9px] font-medium">
      <div className="break-words">
        <Label text={label} />
      </div>
      <div className="mt-2 flex gap-1.5">
        <Button
          variant="primary"
          small
          onClick={() => store.commit((current) => acceptProposal(current, proposal.id))}
        >
          Accept
        </Button>
        <Button
          small
          className="!bg-transparent hover:!bg-hover"
          onClick={() => store.commit((current) => rejectProposal(current, proposal.id))}
        >
          Reject
        </Button>
      </div>
    </li>
  );
};

export const acceptEverythingAndFinish = (): void => {
  store.commit(acceptAll);
  changeView('map');
};

const ORDER = { pending: 0, accepted: 1, rejected: 2 };

const Section = ({
  title,
  rows,
  doc,
  focusedId,
}: {
  title: string;
  rows: Proposal[];
  doc: MapDoc;
  focusedId: string | undefined;
}) =>
  rows.length === 0 ? null : (
    <section className="mt-3">
      <h3 className="mt-0 mb-1.5 text-[13px] font-semibold text-mute">{title}</h3>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {[...rows]
          .sort((a, b) => ORDER[a.status] - ORDER[b.status])
          .map((proposal) => (
            <Row
              key={proposal.id}
              proposal={proposal}
              label={proposalLabel(doc, proposal)}
              focused={proposal.id === focusedId}
              doc={doc}
            />
          ))}
      </ul>
    </section>
  );

export const ProposalsPanel = () => {
  const doc = useStore((s) => s.doc);
  const status = useStore((s) => s.ui.digitize);
  const focused = useStore((s) => s.ui.focusedProposal);
  const live = doc.proposals.filter((p) => isLiveProposal(doc, p));
  const accepted = live.filter((p) => p.status === 'accepted').length;
  const pending = live.filter((p) => p.status === 'pending');
  const ai = live.filter((p) => p.origin === 'ai');
  const local = live.filter((p) => p.origin === 'local');
  // New ideas appear at the top, so the stream is visible without scrolling.
  const focusedId = currentProposal(doc, focused)?.id;

  return (
    <Panel aria-label="Proposals">
      <h2 className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.01em]">Proposals</h2>
      <p className="mt-1 mb-0 text-mute tabular-nums" aria-live="polite">
        {accepted} of {live.filter((p) => p.status !== 'rejected').length} accepted
      </p>

      {pending.length > 0 ? (
        <Button variant="primary" className="mt-3 w-full" onClick={acceptEverythingAndFinish}>
          Accept all and see the map
        </Button>
      ) : (
        accepted > 0 && (
          <Button variant="primary" className="mt-3 w-full" onClick={() => changeView('map')}>
            See the finished map
          </Button>
        )
      )}

      {status.state === 'streaming' && (
        <p className="thinking mt-3 mb-0 flex items-center gap-1 text-mute" role="status">
          <i />
          <i />
          <i />
          <span className="ml-1">{status.provider ?? 'AI'} is looking at your map</span>
        </p>
      )}
      {(status.state === 'failed' || status.state === 'local-only') && (
        <div className="mt-3 rounded-lg border border-line p-2.5" role="alert">
          <p className="m-0">{status.message}</p>
          {status.state === 'failed' && (
            <Button small className="mt-2" onClick={() => void retryAi()}>
              Try again
            </Button>
          )}
        </div>
      )}

      <Section title="AI ideas" rows={ai} doc={doc} focusedId={focusedId} />
      <Section title="Found in your sketch" rows={local} doc={doc} focusedId={focusedId} />

      {status.localMs !== undefined && (
        <p className="mt-3 mb-0 text-[12px] text-mute tabular-nums">
          Local {seconds(status.localMs)}
          {status.firstMs !== undefined && ` · first AI idea ${seconds(status.firstMs)}`}
          {status.totalMs !== undefined &&
            status.state === 'done' &&
            ` · all ${seconds(status.totalMs)}`}
        </p>
      )}
    </Panel>
  );
};
