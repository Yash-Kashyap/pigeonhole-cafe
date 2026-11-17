import { useRef } from 'react';

export default function Dialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div>
      <button
        className="min-h-11 border border-ink px-5 font-semibold"
        type="button"
        onClick={() => dialog.current?.showModal()}
      >
        Open dialog
      </button>
      <dialog
        ref={dialog}
        className="m-auto max-w-md border border-ink bg-paper p-0 text-ink backdrop:bg-ink/60"
      >
        <div className="space-y-5 p-6">
          <h2 className="font-display text-3xl">A quiet dialog</h2>
          <p>Keyboard focus stays inside until this sheet is closed.</p>
          <form method="dialog">
            <button className="min-h-11 border border-ink bg-ink px-5 font-semibold text-paper">
              Close
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
