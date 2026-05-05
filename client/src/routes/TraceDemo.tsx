import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TRACE_DEMO_DEFAULT_SELECTION,
  TRACE_DEMO_MODEL,
  buildTraceChatSearchParams,
  readStoredTraceDemoSelection,
  writeTraceDemoSelection,
} from '~/components/TraceDemo/traceDemoState';
import { latence } from '~/components/TraceDemo/brand';

/**
 * The /trace-demo route is now a fast redirect to the native chat.
 * The qualification flow has been replaced by an in-chat toggle that
 * lives at the top of the chat shell. This component preserves the
 * existing deep-link entry point: it reads any stored selection or
 * falls back to the default RAG / SDK selection, then navigates to
 * /c/new with the right query params for the chat handoff.
 */
export default function TraceDemo() {
  const navigate = useNavigate();

  useEffect(() => {
    const selection = readStoredTraceDemoSelection() ?? {
      ...TRACE_DEMO_DEFAULT_SELECTION,
      createdAt: Date.now(),
    };
    writeTraceDemoSelection(selection);
    const params = buildTraceChatSearchParams(selection);
    navigate(`/c/new?${params.toString()}`, { replace: true });
  }, [navigate]);

  return (
    <main
      className="flex min-h-screen w-full items-center justify-center"
      style={{ backgroundColor: latence.bgPrimary, color: latence.text }}
    >
      <div className="flex flex-col items-center gap-3">
        <span
          className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
          style={{ backgroundColor: latence.greenSoft, color: latence.greenText }}
        >
          Latence TRACE
        </span>
        <p style={{ color: latence.textMuted }}>Opening native chat with TRACE…</p>
        <p className="text-xs" style={{ color: latence.textSubtle }}>
          Model: {TRACE_DEMO_MODEL}
        </p>
      </div>
    </main>
  );
}
