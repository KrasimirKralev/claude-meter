import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { START_BLANK, docToJson } from '../state/persist.ts';
import { store } from '../state/store.ts';

interface State {
  failed: boolean;
}

/** If a map ever crashes the page, every other map must still be one click away. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The app crashed while drawing this map', error, info.componentStack);
  }

  private startBlank = (): void => {
    try {
      localStorage.setItem(START_BLANK, '1');
    } catch {
      // Storage blocked: the reload still reopens the app.
    }
    location.reload();
  };

  private download = (): void => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([docToJson(store.doc)], { type: 'application/json' }));
    link.download = 'map-backup.json';
    link.click();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fixed inset-0 grid place-items-center p-8 text-center" role="alert">
        <div className="max-w-[460px]">
          <h1 className="m-0 mb-2 text-[22px] font-semibold">This map could not be drawn</h1>
          <p className="m-0 mb-4 text-mute">
            Your other maps are safe. Save a copy of this one, then start fresh. Your maps stay in the
            list at the top left.
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-blue px-3.5 py-2 font-semibold text-white hover:bg-blue-hover"
              onClick={this.startBlank}
            >
              Start a new map
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3.5 py-2 font-semibold hover:bg-hover"
              onClick={this.download}
            >
              Save a copy
            </button>
          </div>
        </div>
      </div>
    );
  }
}
