import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useRecoilValue } from 'recoil';
import { useParams, useSearchParams } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useGetMessagesByConvoId } from '~/data-provider';
import { LATENCE_LOGO_SRC, latence } from './brand';
import {
  TraceDemoContext,
  buildTraceBridgeRequest,
  extractCompressionDetail,
  extractDeadWeights,
  extractDecision,
  extractDriftBand,
  extractGroundingEvidence,
  extractGuardianSegments,
  extractMemoryDetail,
  extractPrivacyDetail,
  extractPromptGuardSummary,
  getActiveOrDefaultSelection,
  getEnabledFeatures,
  getKindForFeature,
  getMetricFromResults,
  getRiskForResult,
  getTraceBridgeBaseUrl,
  getTraceDemoModel,
  traceFeatureCatalog,
  traceIntegrations,
  traceUseCases,
  TRACE_DEMO_URL,
  writeTraceDemoSelection,
  type TraceBridgeResponse,
  type TraceCallRecord,
  type TraceDemoIntegration,
  type TraceDemoLog,
  type TraceDemoMessageResult,
  type TraceDemoSelection,
  type TraceDemoUseCase,
  type TraceEvidenceItem,
  type TraceFeatureKey,
  type TraceMemorySpan,
  type TracePrivacyEntity,
  type TracePromptGuardSummary,
} from './traceDemoState';
import { cn, getAllContentText } from '~/utils';
import store from '~/store';

const copy = {
  panelTitle: 'TRACE live analytics',
  panelSubtitle: 'Every supported SDK check runs in parallel after each assistant response.',
  exit: 'Exit demo',
  context: 'Context',
  useCase: 'Use case',
  integration: 'Integration',
  model: 'Model',
  riskBand: 'Risk band',
  requestId: 'Request ID',
  latency: 'Latency',
  pending: 'Pending',
  waiting: 'Waiting for the next assistant response.',
  running: 'TRACE is scoring the latest response.',
  noValue: 'Pending',
  logsTitle: 'TRACE event log',
  logsSubtitle: 'Real-time view of what TRACE captured this turn.',
  emptyLogs: 'Send a message to populate TRACE telemetry.',
  completed: 'completed',
  runningStatus: 'running',
  queued: 'queued',
  error: 'error',
};

type StatusVisual = { background: string; color: string };

function getStatusVisual(status: TraceDemoLog['status']): StatusVisual {
  if (status === 'completed') {
    return { background: latence.greenSoft, color: latence.greenText };
  }
  if (status === 'running') {
    return { background: latence.greenSoftStrong, color: latence.greenText };
  }
  if (status === 'error') {
    return { background: latence.roseSoft, color: latence.rose };
  }
  return { background: 'rgba(255,255,255,0.04)', color: latence.textSubtle };
}

function getRiskStyle(risk?: string | null) {
  const normalized = (risk || 'unknown').toLowerCase();
  if (normalized === 'green') {
    return {
      backgroundColor: latence.greenSoft,
      borderColor: latence.green,
      color: latence.greenText,
    };
  }
  if (normalized === 'red') {
    return {
      backgroundColor: latence.roseSoft,
      borderColor: latence.rose,
      color: latence.rose,
    };
  }
  return {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: latence.border,
    color: latence.textSubtle,
  };
}

const TURNSTILE_SITE_KEY = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SUBMIT_COUNT_KEY = 'latence.trace.demo.submitCount';
const DISMISS_COUNT_KEY = 'latence.trace.demo.dismissCount';
const BONUS_TESTS_KEY = 'latence.trace.demo.bonusTests';
const SHARE_REDEEMED_KEY = 'latence.trace.demo.shareRedeemed';
const SOCIAL_SHARED_KEY = 'latence.trace.demo.socialShared';
const MAX_DISMISSALS = 5;
const BASE_FREE_TESTS = 2;

function readSessionInt(key: string): number {
  try {
    return parseInt(window.sessionStorage.getItem(key) || '0', 10) || 0;
  } catch {
    return 0;
  }
}
function writeSessionInt(key: string, value: number) {
  try {
    window.sessionStorage.setItem(key, String(value));
  } catch { /* noop */ }
}

export default function TraceDemoShell({
  children,
  index = 0,
}: {
  children: ReactNode;
  index?: number;
}) {
  const [searchParams] = useSearchParams();
  const { conversationId = Constants.NEW_CONVO } = useParams();
  const [selection, setSelectionState] = useState<TraceDemoSelection>(() =>
    getActiveOrDefaultSelection(searchParams),
  );
  const setSelection = useCallback(
    (next: TraceDemoSelection | ((current: TraceDemoSelection) => TraceDemoSelection)) => {
      setSelectionState((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        writeTraceDemoSelection(resolved);
        return resolved;
      });
    },
    [],
  );
  const [logs, setLogs] = useState<TraceDemoLog[]>([]);
  const [results, setResults] = useState<Record<string, TraceDemoMessageResult>>({});
  const [latestMessageId, setLatestMessageId] = useState<string | undefined>();
  const [turnstileVerified, setTurnstileVerified] = useState(!TURNSTILE_SITE_KEY);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [submitCount, setSubmitCount] = useState(() => readSessionInt(SUBMIT_COUNT_KEY));
  const [dismissCount, setDismissCount] = useState(() => readSessionInt(DISMISS_COUNT_KEY));
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [bonusTests, setBonusTests] = useState(() => readSessionInt(BONUS_TESTS_KEY));
  const freeTestLimit = BASE_FREE_TESTS + bonusTests;
  const isHardLocked = dismissCount >= MAX_DISMISSALS;
  const processedRef = useRef<Set<string>>(new Set());
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const messagesQueryId = conversationId || Constants.NEW_CONVO;
  const { data: messages = [] } = useGetMessagesByConvoId(messagesQueryId, {
    enabled: !!messagesQueryId,
  });

  useEffect(() => {
    setSelectionState(getActiveOrDefaultSelection(searchParams));
  }, [searchParams]);

  useEffect(() => {
    processedRef.current.clear();
    setLogs([]);
    setResults({});
    setLatestMessageId(undefined);
  }, [selection?.useCase, selection?.integration]);

  const latestResult = latestMessageId ? results[latestMessageId] : undefined;

  const updateResult = useCallback(
    (messageId: string, updater: (current: TraceDemoMessageResult) => TraceDemoMessageResult) => {
      setResults((current) => {
        const existing = current[messageId];
        if (!existing) {
          return current;
        }
        return { ...current, [messageId]: updater(existing) };
      });
    },
    [],
  );

  useEffect(() => {
    if (!selection || isSubmitting || messages.length === 0) {
      return;
    }
    const assistant = getLatestAssistantMessage(messages);
    if (!assistant?.messageId) {
      return;
    }
    const answer = getAllContentText(assistant).trim();
    if (!answer || processedRef.current.has(assistant.messageId)) {
      return;
    }
    const questionMessage = getPreviousUserMessage(messages, assistant);
    const question = getAllContentText(questionMessage).trim();
    if (!question) {
      return;
    }

    processedRef.current.add(assistant.messageId);
    const newCount = submitCount + 1;
    setSubmitCount(newCount);
    writeSessionInt(SUBMIT_COUNT_KEY, newCount);
    if (newCount >= freeTestLimit && !isHardLocked) {
      setShowSignupModal(true);
    }
    void fanoutTraceForTurn({
      assistant,
      questionMessage,
      question,
      answer,
      messages,
      selection,
      latestResult,
      setLogs,
      setResults,
      setLatestMessageId,
      updateResult,
    });
  }, [isSubmitting, latestResult, messages, selection, updateResult]);

  const contextValue = useMemo(
    () => ({
      active: true,
      selection,
      latestResult,
      getResultForMessage: (messageId?: string | null) =>
        messageId ? results[messageId] : undefined,
    }),
    [latestResult, results, selection],
  );

  const useCase = traceUseCases.find((item) => item.id === selection.useCase);
  const integration = traceIntegrations.find((item) => item.id === selection.integration);
  const enabledFeatures = getEnabledFeatures(selection.useCase);
  const riskInfo = getRiskForResult(latestResult);
  const decision = extractDecision(latestResult);
  const deadWeights = extractDeadWeights(latestResult);
  const evidence = extractGroundingEvidence(latestResult);
  const compressionDetail = extractCompressionDetail(latestResult);
  const privacyDetail = extractPrivacyDetail(latestResult);
  const memoryDetail = extractMemoryDetail(latestResult);
  const driftDetail = extractDriftBand(latestResult);
  const promptGuard = extractPromptGuardSummary(latestResult);

  const handleUseCaseChange = (next: TraceDemoUseCase) =>
    setSelection((current) => ({ ...current, useCase: next, createdAt: Date.now() }));
  const handleIntegrationChange = (next: TraceDemoIntegration) =>
    setSelection((current) => ({ ...current, integration: next, createdAt: Date.now() }));

  if (!turnstileVerified) {
    return <TurnstileGate onVerified={() => setTurnstileVerified(true)} />;
  }

  return (
    <TraceDemoContext.Provider value={contextValue}>
      <div
        className="flex h-full w-full flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_400px]"
        style={{ backgroundColor: latence.bgPrimary, color: latence.text }}
      >
        <div
          className="flex min-h-0 min-w-0 flex-col"
          style={{ backgroundColor: latence.bgPrimary, borderRight: `1px solid ${latence.border}` }}
        >
          <TraceTopToggle
            selection={selection}
            onUseCase={handleUseCaseChange}
            onIntegration={handleIntegrationChange}
            decision={decision?.action}
            band={decision?.band ?? riskInfo.risk}
            onHowItWorks={() => setShowHowItWorks(true)}
          />
          <div className="min-h-0 flex-1">{children}</div>
          <TraceLogDashboard logs={logs} />
        </div>
        <aside
          className="hidden min-h-0 flex-col gap-3 overflow-y-auto p-3 lg:flex"
          style={{
            backgroundColor: latence.bgSurface,
            borderLeft: `1px solid ${latence.border}`,
          }}
        >
          <TraceSummaryPanel
            features={enabledFeatures}
            result={latestResult}
            useCaseLabel={useCase?.label}
            integrationLabel={integration?.label}
            decision={decision}
            riskInfo={riskInfo}
            avgLatency={(() => {
              const records = Object.values(latestResult?.results ?? {}).filter(
                (record): record is TraceCallRecord => !!record?.response,
              );
              if (records.length === 0) {
                return undefined;
              }
              const sum = records.reduce(
                (acc, record) => acc + (record.response?.latency_ms ?? 0),
                0,
              );
              return Math.round(sum / records.length);
            })()}
            requestId={
              Object.values(latestResult?.results ?? {})
                .map((record) => record?.response?.request_id)
                .find((value) => !!value) ?? undefined
            }
            isRunning={logs.some((log) => log.status === 'running')}
            onShare={() => setShowShareModal(true)}
          />
          <TraceGroundednessCard
            decision={decision}
            riskInfo={riskInfo}
            evidence={evidence}
            deadWeights={deadWeights}
            guardianMode={extractGuardianSegments(latestResult).length > 0}
          />
          {selection.useCase === 'coding-agent' && (
            <TracePromptGuardCard guard={promptGuard} />
          )}
          <TracePrivacyCard detail={privacyDetail} />
          <TraceCompressionCard detail={compressionDetail} />
          <TraceMemoryCard detail={memoryDetail} />
          <TraceDriftCard detail={driftDetail} />
        </aside>
      </div>
      {showHowItWorks && (
        <TraceHowItWorksModal onClose={() => setShowHowItWorks(false)} />
      )}
      {showSignupModal && (
        <TraceSignupModal
          onDismiss={() => {
            const newDismiss = dismissCount + 1;
            setDismissCount(newDismiss);
            writeSessionInt(DISMISS_COUNT_KEY, newDismiss);
            setShowSignupModal(false);
          }}
          canDismiss={dismissCount < MAX_DISMISSALS}
        />
      )}
      {showShareModal && latestResult && (
        <TraceShareModal
          result={latestResult}
          selection={selection}
          decision={decision}
          riskInfo={riskInfo}
          onClose={() => setShowShareModal(false)}
          onLinkShared={() => {
            try {
              const already = window.sessionStorage.getItem(SHARE_REDEEMED_KEY);
              if (!already) {
                const newBonus = bonusTests + 50;
                setBonusTests(newBonus);
                writeSessionInt(BONUS_TESTS_KEY, newBonus);
                window.sessionStorage.setItem(SHARE_REDEEMED_KEY, '1');
              }
            } catch { /* noop */ }
          }}
        />
      )}
    </TraceDemoContext.Provider>
  );
}

function TraceTopToggle({
  selection,
  onUseCase,
  onIntegration,
  decision,
  band,
  onHowItWorks,
}: {
  selection: TraceDemoSelection;
  onUseCase: (next: TraceDemoUseCase) => void;
  onIntegration: (next: TraceDemoIntegration) => void;
  decision?: string;
  band?: string | null;
  onHowItWorks: () => void;
}) {
  const bandStyle = getRiskStyle(band);
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-5 py-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div className="flex items-center gap-2">
        <img
          src={LATENCE_LOGO_SRC}
          alt="Latence"
          className="h-6 w-auto select-none"
          draggable={false}
        />
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: latence.greenText }}
        >
          TRACE
        </span>
      </div>

      <ToggleGroup
        label="Use case"
        items={traceUseCases.map((item) => ({ id: item.id, label: item.label }))}
        active={selection.useCase}
        onSelect={(id) => onUseCase(id as TraceDemoUseCase)}
      />
      <ToggleGroup
        label="Integration"
        items={traceIntegrations.map((item) => ({ id: item.id, label: item.label }))}
        active={selection.integration}
        onSelect={(id) => onIntegration(id as TraceDemoIntegration)}
      />

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onHowItWorks}
          className="rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition hover:opacity-80"
          style={{
            backgroundColor: latence.greenSoft,
            color: latence.greenText,
            border: `1px solid ${latence.green}`,
          }}
        >
          How It Works
        </button>
        {(decision || (band && band !== 'unknown')) && (
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: latence.textSubtle }}
          >
            Live decision
          </span>
        )}
        {decision && (
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{
              backgroundColor: bandStyle.backgroundColor,
              color: bandStyle.color,
              border: `1px solid ${bandStyle.borderColor}`,
            }}
          >
            {decision}
          </span>
        )}
        {band && band !== 'unknown' && (
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{
              backgroundColor: bandStyle.backgroundColor,
              color: bandStyle.color,
              border: `1px solid ${bandStyle.borderColor}`,
            }}
          >
            {band === 'green' ? 'Grounded' : band === 'red' ? 'Ungrounded' : band}
          </span>
        )}
      </div>
    </div>
  );
}

function ToggleGroup({
  label,
  items,
  active,
  onSelect,
}: {
  label: string;
  items: Array<{ id: string; label: string }>;
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.22em]"
        style={{ color: latence.textSubtle }}
      >
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="flex items-center gap-1 rounded-full border p-1"
        style={{ borderColor: latence.borderStrong, backgroundColor: latence.bgPrimary }}
      >
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-pressed={isActive}
              className="trace-toggle-pill rounded-full px-3 py-1.5 text-sm font-medium transition"
              style={{
                backgroundColor: isActive ? latence.green : 'transparent',
                color: isActive ? latence.bgPrimary : latence.textMuted,
                boxShadow: isActive ? '0 1px 8px rgba(11, 139, 145, 0.45)' : 'none',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact, above-the-fold summary panel that merges the analytics header,
 * 3x2 metric grid, and telemetry footer into a single card. Replaces the
 * three stacked cards that used to dominate the right column even when no
 * data was present.
 */
function TraceSummaryPanel({
  features,
  result,
  useCaseLabel,
  integrationLabel,
  decision,
  riskInfo,
  avgLatency,
  requestId,
  isRunning,
  onShare,
}: {
  features: TraceFeatureKey[];
  result?: TraceDemoMessageResult;
  useCaseLabel?: string;
  integrationLabel?: string;
  decision?: ReturnType<typeof extractDecision>;
  riskInfo: { risk: string; score?: number | null };
  avgLatency?: number;
  requestId?: string;
  isRunning: boolean;
  onShare?: () => void;
}) {
  const band = decision?.band ?? riskInfo.risk;
  const style = getRiskStyle(band);
  const score = decision?.score ?? riskInfo.score;
  const hasResult = Object.values(result?.results ?? {}).some(
    (r) => r?.status === 'completed',
  );
  return (
    <div
      className="rounded-2xl border"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: latence.border }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.24em]"
            style={{ color: latence.greenText }}
          >
            {copy.panelTitle}
          </span>
          {isRunning && !result && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]"
              style={{ backgroundColor: latence.greenSoftStrong, color: latence.greenText }}
            >
              Running
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasResult && onShare && (
            <button
              type="button"
              onClick={onShare}
              title="Share results"
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition hover:opacity-80"
              style={{
                borderColor: latence.green,
                color: latence.greenText,
                backgroundColor: latence.greenSoft,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share
            </button>
          )}
          {decision?.action && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{
                backgroundColor: style.backgroundColor,
                color: style.color,
                border: `1px solid ${style.borderColor}`,
              }}
            >
              {decision.action}
            </span>
          )}
          {band && band !== 'unknown' && (
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{
                backgroundColor: style.backgroundColor,
                color: style.color,
                borderColor: style.borderColor,
              }}
            >
              {band === 'green' ? 'Grounded' : band === 'red' ? 'Ungrounded' : band}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px" style={{ backgroundColor: latence.border }}>
        {features.map((feature) => (
          <CompactMetricCell key={feature} feature={feature} result={result} />
        ))}
      </div>
      <div
        className="flex items-center justify-between gap-2 border-t px-4 py-2 text-[10px]"
        style={{ borderColor: latence.border, color: latence.textSubtle }}
      >
        <span className="flex items-center gap-1.5">
          <span className="uppercase tracking-[0.18em]">{useCaseLabel ?? '—'}</span>
          <span>·</span>
          <span className="uppercase tracking-[0.18em]">{integrationLabel ?? '—'}</span>
        </span>
        <span className="flex items-center gap-2">
          {typeof score === 'number' && (
            <span style={{ color: latence.textMuted }}>
              {score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2)}
            </span>
          )}
          {typeof avgLatency === 'number' && (
            <span style={{ color: latence.textMuted }}>{avgLatency} ms</span>
          )}
          {requestId && (
            <span title={requestId} style={{ color: latence.textSubtle }}>
              {requestId.slice(0, 10)}…
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function CompactMetricCell({
  feature,
  result,
}: {
  feature: TraceFeatureKey;
  result?: TraceDemoMessageResult;
}) {
  const meta = traceFeatureCatalog.find((entry) => entry.key === feature);
  const record = result?.results[feature];
  const value = formatFeatureValue(feature, record?.response, result);
  const isCompleted = record?.status === 'completed';
  const isRunning = record?.status === 'running' || record?.status === 'queued';
  const isError = record?.status === 'error';
  const accent = isCompleted
    ? latence.greenText
    : isRunning
      ? latence.amber
      : isError
        ? latence.rose
        : latence.textSubtle;
  return (
    <div className="flex flex-col gap-1 px-3 py-2.5" style={{ backgroundColor: latence.bgRaised }}>
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: latence.textSubtle }}
      >
        {meta?.label ?? feature}
      </span>
      <span className="text-sm font-semibold leading-tight" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}


/**
 * Groundedness + retrieval-utility detail card.
 * Combines the overall groundedness score, the per-chunk evidence list
 * (deduplicated by support_id), and the unused/dead-weight ratio so the
 * buyer sees one coherent story for "did the answer use the retrieved
 * context?". Replaces the legacy TraceContextUtilityCard.
 */
function TraceGroundednessCard({
  decision,
  riskInfo,
  evidence,
  deadWeights,
  guardianMode,
}: {
  decision?: ReturnType<typeof extractDecision>;
  riskInfo: { risk: string; score?: number | null };
  evidence: ReturnType<typeof extractGroundingEvidence>;
  deadWeights: ReturnType<typeof extractDeadWeights>;
  guardianMode?: boolean;
}) {
  const score = decision?.score ?? riskInfo.score;
  const band = decision?.band ?? riskInfo.risk;
  const dedupedEvidence = dedupeEvidenceById(evidence);
  const hasAnything =
    typeof score === 'number' ||
    (band && band !== 'unknown') ||
    dedupedEvidence.length > 0 ||
    typeof deadWeights.ratio === 'number';
  if (!hasAnything) {
    return null;
  }
  const style = getRiskStyle(band);
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: latence.text }}>
          Groundedness
        </p>
        {band && band !== 'unknown' && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{
              backgroundColor: style.backgroundColor,
              color: style.color,
              borderColor: style.borderColor,
            }}
          >
            {band === 'green' ? 'Grounded' : band === 'red' ? 'Ungrounded' : band}
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        {guardianMode
          ? 'Whether the entire answer is supported by the retrieved context.'
          : 'How much of the answer is supported by the retrieved context.'}
      </p>
      {guardianMode ? (
        <MetaRow
          label="Verdict"
          value={band === 'green' ? 'Grounded' : 'Ungrounded'}
        />
      ) : typeof score === 'number' ? (
        <MetaRow
          label="Trace score"
          value={score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2)}
        />
      ) : null}
      {typeof deadWeights.ratio === 'number' && (
        <MetaRow
          label="Unused context"
          value={`${Math.round(deadWeights.ratio * 100)}%`}
        />
      )}
      {dedupedEvidence.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <p
            className="text-[10px] uppercase tracking-[0.18em]"
            style={{ color: latence.textSubtle }}
          >
            Evidence chunks ({dedupedEvidence.length})
          </p>
          {dedupedEvidence.map((item, index) => (
            <ExpandableEvidenceChunk key={item.supportId ?? `chunk-${index}`} item={item} index={index} />
          ))}
        </div>
      )}
      {decision?.reasonCodes && decision.reasonCodes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {decision.reasonCodes.slice(0, 6).map((code) => (
            <span
              key={code}
              className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]"
              style={{
                backgroundColor: latence.bgSurface,
                color: latence.textMuted,
                border: `1px solid ${latence.border}`,
              }}
            >
              {code.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PromptGuardBadge({ guard }: { guard: TracePromptGuardSummary }) {
  const total = guard.trustedCount + guard.suspiciousCount + guard.blockedCount;
  const hasThreat = guard.suspiciousCount > 0 || guard.blockedCount > 0;
  const badgeColor = hasThreat ? latence.rose : latence.greenText;
  const badgeBg = hasThreat ? latence.roseSoft : latence.greenSoft;
  return (
    <div
      className="flex items-center gap-2 rounded-xl border px-2 py-1.5 text-[10px]"
      style={{ borderColor: latence.border, backgroundColor: latence.bgSurface }}
    >
      <span
        className="rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider"
        style={{ backgroundColor: badgeBg, color: badgeColor }}
      >
        PromptGuard
      </span>
      <span style={{ color: latence.textMuted }}>
        {total === 0 ? (
          'No chunks scanned'
        ) : (
          <>
            {guard.trustedCount}/{total} trusted
            {guard.suspiciousCount > 0 && (
              <span style={{ color: latence.amber }}> · {guard.suspiciousCount} suspicious</span>
            )}
            {guard.blockedCount > 0 && (
              <span style={{ color: latence.rose }}> · {guard.blockedCount} blocked</span>
            )}
          </>
        )}
      </span>
      {guard.provider && (
        <span style={{ color: latence.textSubtle }}>({guard.provider})</span>
      )}
    </div>
  );
}

function TracePromptGuardCard({ guard }: { guard?: TracePromptGuardSummary }) {
  if (!guard || !guard.enabled) {
    return null;
  }
  const hasThreat = guard.suspiciousCount > 0 || guard.blockedCount > 0;
  const band = hasThreat ? 'red' : 'green';
  const style = getRiskStyle(band);
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: latence.text }}>
          Prompt Guard
        </p>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{
            backgroundColor: style.backgroundColor,
            color: style.color,
            borderColor: style.borderColor,
          }}
        >
          {band}
        </span>
      </div>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        Llama Prompt Guard 2 security scan on retrieved context chunks.
      </p>
      <PromptGuardBadge guard={guard} />
    </div>
  );
}

function ExpandableEvidenceChunk({ item, index }: { item: TraceEvidenceItem; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const coverage = typeof item.coverage === 'number' ? Math.round(item.coverage * 100) : null;
  const usage = (item.usageState || '').toLowerCase();
  const usageColor =
    usage === 'used' ? latence.greenText : usage === 'unused' ? latence.rose : latence.amber;
  const trustColor =
    item.trustState === 'trusted'
      ? latence.greenText
      : item.trustState === 'suspicious'
        ? latence.amber
        : item.trustState === 'blocked'
          ? latence.rose
          : latence.textSubtle;
  const trustBg =
    item.trustState === 'suspicious'
      ? latence.amberSoft
      : item.trustState === 'blocked'
        ? latence.roseSoft
        : 'transparent';
  return (
    <div
      className="rounded-xl border text-[11px]"
      style={{ borderColor: latence.border, backgroundColor: latence.bgSurface }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 truncate">
          <span style={{ color: latence.textSubtle }}>
            {item.supportId ?? item.metadataPath ?? `chunk-${index}`}
          </span>
          {item.trustState && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{ backgroundColor: trustBg, color: trustColor, border: item.trustState !== 'trusted' ? `1px solid ${trustColor}55` : 'none' }}
            >
              {item.trustState}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span style={{ color: usageColor, textTransform: 'capitalize' }} className="text-[10px]">
            {item.usageState ?? 'unknown'}
          </span>
          {coverage !== null && (
            <span className="text-[10px]" style={{ color: latence.textMuted }}>
              {coverage}% cov
            </span>
          )}
          {item.matchedTokens !== undefined && item.totalTokens !== undefined && (
            <span className="text-[10px]" style={{ color: latence.textSubtle }}>
              {item.matchedTokens}/{item.totalTokens} tok
            </span>
          )}
          <span className="text-[9px]" style={{ color: latence.textSubtle }}>
            {expanded ? '▼' : '▶'}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="border-t px-2 py-1.5" style={{ borderColor: latence.border }}>
          {item.text ? (
            <p className="mb-1.5 whitespace-pre-wrap" style={{ color: latence.textMuted }}>
              {item.text}
            </p>
          ) : (
            <p className="mb-1.5 italic" style={{ color: latence.textSubtle }}>
              No chunk text available
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]" style={{ color: latence.textSubtle }}>
            {typeof item.usageConfidence === 'number' && (
              <span>Usage conf: {Math.round(item.usageConfidence * 100)}%</span>
            )}
            {typeof item.trustScore === 'number' && (
              <span style={{ color: item.trustScore > 0 ? latence.amber : latence.greenText }}>
                Risk: {item.trustScore.toFixed(2)}
              </span>
            )}
            {item.trustLabels && item.trustLabels.length > 0 && (
              <span style={{ color: latence.rose }}>Labels: {item.trustLabels.join(', ')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function dedupeEvidenceById<T extends { supportId?: string; text?: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    const key = item.supportId ?? `_${byId.size}`;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, item);
      continue;
    }
    // Keep the entry with the longer text (richer detail).
    const existingLen = (existing.text ?? '').length;
    const incomingLen = (item.text ?? '').length;
    if (incomingLen > existingLen) {
      byId.set(key, { ...existing, ...item });
    } else {
      byId.set(key, { ...item, ...existing });
    }
  }
  return Array.from(byId.values());
}

function TracePrivacyCard({ detail }: { detail: ReturnType<typeof extractPrivacyDetail> }) {
  const empty = detail.entityCount === undefined && detail.byLabel.length === 0 && detail.entities.length === 0;
  if (empty) {
    return null;
  }
  const noEntities = detail.entityCount === 0 || (detail.entityCount === undefined && detail.entities.length === 0 && detail.byLabel.length === 0);
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: latence.text }}>
          Privacy
        </p>
        {detail.band && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={getRiskStyle(detail.band)}
          >
            {detail.band}
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        Sensitive entities detected in the prompt + answer before logging.
      </p>
      {noEntities && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px]"
          style={{ backgroundColor: latence.greenSoft, color: latence.greenText }}
        >
          <span className="font-semibold">No PII detected</span>
        </div>
      )}
      {detail.entities.length > 0 && (
        <div className="mt-1 space-y-1.5">
          {detail.entities.map((entity, i) => (
            <PrivacyEntityRow key={`${entity.label}-${i}`} entity={entity} />
          ))}
        </div>
      )}
      {detail.entities.length === 0 && detail.byLabel.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {detail.byLabel.map((entry) => (
            <span
              key={entry.label}
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{
                backgroundColor: latence.amberSoft,
                color: latence.amber,
                border: `1px solid ${latence.amber}`,
              }}
            >
              {entry.label} · {entry.count}
            </span>
          ))}
        </div>
      )}
      {detail.redacted && (
        <div className="mt-2">
          <p
            className="text-[10px] uppercase tracking-[0.18em]"
            style={{ color: latence.textSubtle }}
          >
            Redacted preview
          </p>
          <p
            className="mt-1 line-clamp-4 rounded-xl border p-2 text-[11px]"
            style={{
              backgroundColor: latence.bgSurface,
              borderColor: latence.border,
              color: latence.textMuted,
            }}
          >
            {detail.redacted}
          </p>
        </div>
      )}
    </div>
  );
}

function PrivacyEntityRow({ entity }: { entity: TracePrivacyEntity }) {
  const confPct = Math.round(entity.score * 100);
  return (
    <div
      className="rounded-xl border p-2 text-[11px]"
      style={{ borderColor: latence.border, backgroundColor: latence.bgSurface }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: latence.amberSoft,
            color: latence.amber,
            border: `1px solid ${latence.amber}`,
          }}
        >
          {entity.label}
        </span>
        <span className="text-[10px]" style={{ color: latence.textSubtle }}>
          {confPct}% confidence
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 font-mono"
          style={{ backgroundColor: latence.roseSoft, color: latence.rose }}
        >
          {entity.text}
        </span>
        {entity.redactedValue && (
          <>
            <span style={{ color: latence.textSubtle }}>→</span>
            <span
              className="rounded px-1.5 py-0.5 font-mono"
              style={{ backgroundColor: latence.greenSoft, color: latence.greenText }}
            >
              {entity.redactedValue}
            </span>
          </>
        )}
      </div>
      <div className="mt-0.5">
        <div
          className="h-1 rounded-full"
          style={{ backgroundColor: latence.border }}
        >
          <div
            className="h-1 rounded-full transition-all"
            style={{
              width: `${confPct}%`,
              backgroundColor: confPct >= 80 ? latence.rose : confPct >= 50 ? latence.amber : latence.textSubtle,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TraceCompressionCard({ detail }: { detail: ReturnType<typeof extractCompressionDetail> }) {
  const empty = detail.tokensSaved === undefined && detail.ratio === undefined && !detail.summary;
  if (empty) {
    return null;
  }
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <p className="text-sm font-medium" style={{ color: latence.text }}>
        Compression
      </p>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        Token savings on the retrieved context while preserving decision-critical terms.
      </p>
      {typeof detail.tokensSaved === 'number' && (
        <MetaRow label="Tokens saved" value={`${detail.tokensSaved}`} />
      )}
      {typeof detail.ratio === 'number' && (
        <MetaRow
          label="Compression ratio"
          value={detail.ratio <= 1 ? `${Math.round(detail.ratio * 100)}%` : detail.ratio.toFixed(2)}
        />
      )}
      {detail.summary && (
        <p
          className="mt-2 line-clamp-3 rounded-xl border p-2 text-[11px]"
          style={{
            backgroundColor: latence.bgSurface,
            borderColor: latence.border,
            color: latence.textMuted,
          }}
        >
          {detail.summary}
        </p>
      )}
      {empty && (
        <p
          className="rounded-2xl border border-dashed p-3 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          Waiting for compression result.
        </p>
      )}
    </div>
  );
}

function TraceMemoryCard({ detail }: { detail: ReturnType<typeof extractMemoryDetail> }) {
  const empty = detail.actionCount === undefined && !detail.hotContext && detail.spans.length === 0;
  if (empty) {
    return null;
  }
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: latence.text }}>
          InfiniMem
        </p>
        {detail.band && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={getRiskStyle(detail.band)}
          >
            {detail.band}
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        Durable memory updates and the hot context carried into the next turn.
      </p>
      {detail.spans.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-[10px]" style={{ color: latence.textSubtle }}>
          <span>{detail.spans.length} spans</span>
          {detail.hotCount > 0 && <span style={{ color: latence.amber }}>{detail.hotCount} hot</span>}
          {detail.coldCount > 0 && <span>{detail.coldCount} cold</span>}
        </div>
      )}
      {typeof detail.actionCount === 'number' && detail.spans.length === 0 && (
        <MetaRow label="Memory actions" value={`${detail.actionCount}`} />
      )}
      {detail.spans.length > 0 ? (
        <div className="space-y-1.5">
          {detail.spans.map((span, i) => (
            <ExpandableMemorySpan key={`mem-${i}`} span={span} />
          ))}
        </div>
      ) : detail.hotContext ? (
        <p
          className="mt-2 line-clamp-3 rounded-xl border p-2 text-[11px]"
          style={{
            backgroundColor: latence.bgSurface,
            borderColor: latence.border,
            color: latence.textMuted,
          }}
        >
          {detail.hotContext}
        </p>
      ) : null}
    </div>
  );
}

function ExpandableMemorySpan({ span }: { span: TraceMemorySpan }) {
  const [expanded, setExpanded] = useState(false);
  const layerColor = span.layer === 'hot' ? latence.amber : latence.textSubtle;
  const truncText = span.text.length > 60 ? span.text.slice(0, 57) + '...' : span.text;
  return (
    <div
      className="rounded-xl border text-[11px]"
      style={{ borderColor: latence.border, backgroundColor: latence.bgSurface }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-1.5 px-2 py-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 truncate">
          <span
            className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
            style={{ color: layerColor, backgroundColor: span.layer === 'hot' ? latence.amberSoft : latence.bgPrimary }}
          >
            {span.layer}
          </span>
          <span className="text-[10px]" style={{ color: latence.textSubtle }}>
            {span.spanType}
          </span>
          <span className="truncate" style={{ color: latence.textMuted }}>
            "{truncText}"
          </span>
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {span.survivalValue !== undefined && (
            <span className="text-[10px]" style={{ color: latence.textSubtle }}>
              surv: {(span.survivalValue * 100).toFixed(0)}%
            </span>
          )}
          <span className="text-[9px]" style={{ color: latence.textSubtle }}>
            {expanded ? '▼' : '▶'}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="border-t px-2 py-1.5" style={{ borderColor: latence.border }}>
          <p className="mb-1.5 whitespace-pre-wrap" style={{ color: latence.textMuted }}>
            {span.text}
          </p>
          <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px]" style={{ color: latence.textSubtle }}>
            {span.relevance !== undefined && <span>Relevance: {(span.relevance * 100).toFixed(0)}%</span>}
            {span.salience !== undefined && <span>Salience: {(span.salience * 100).toFixed(0)}%</span>}
            {span.survivalValue !== undefined && <span>Survival: {(span.survivalValue * 100).toFixed(0)}%</span>}
            {span.attribution !== undefined && <span>Attribution: {(span.attribution * 100).toFixed(0)}%</span>}
            {span.redundancy !== undefined && <span>Redundancy: {(span.redundancy * 100).toFixed(0)}%</span>}
            {span.tokenCount !== undefined && <span>Tokens: {span.tokenCount}</span>}
          </div>
          {span.rareTerms.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {span.rareTerms.map((term) => (
                <span
                  key={term}
                  className="rounded-full px-1.5 py-0.5 text-[9px]"
                  style={{ backgroundColor: latence.bgPrimary, color: latence.textMuted, border: `1px solid ${latence.border}` }}
                >
                  {term}
                </span>
              ))}
            </div>
          )}
          {span.source && (
            <span className="mt-0.5 block text-[9px]" style={{ color: latence.textSubtle }}>
              Source: {span.source}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TraceDriftCard({ detail }: { detail: ReturnType<typeof extractDriftBand> }) {
  const style = getRiskStyle(detail.band);
  const empty = !detail.band && detail.score === undefined;
  if (empty) {
    return null;
  }
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: latence.text }}>
          Drift
        </p>
        {detail.band && (
          <span
            className="rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize"
            style={{
              backgroundColor: style.backgroundColor,
              borderColor: style.borderColor,
              color: style.color,
            }}
          >
            {detail.band}
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        How far the session is drifting from the task / policy across turns.
      </p>
      {typeof detail.score === 'number' && (
        <MetaRow
          label="Score"
          value={detail.score <= 1 ? `${Math.round(detail.score * 100)}%` : detail.score.toFixed(2)}
        />
      )}
      {empty && (
        <p
          className="rounded-2xl border border-dashed p-3 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          Waiting for rollup decision.
        </p>
      )}
    </div>
  );
}

function formatFeatureValue(
  feature: TraceFeatureKey,
  response?: TraceBridgeResponse,
  result?: TraceDemoMessageResult,
): string {
  if (!response) {
    return copy.pending;
  }
  if (feature === 'groundedness') {
    const raw = response.raw as Record<string, unknown> | undefined;
    const scores = (raw as { scores?: Record<string, unknown> } | undefined)?.scores;
    const grounded = raw?.grounded ?? scores?.grounded;
    if (typeof grounded === 'boolean') {
      return grounded ? 'Grounded' : 'Ungrounded';
    }
    if (typeof response.trace_score === 'number') {
      return formatScore(response.trace_score);
    }
    const fused = scores?.groundedness_v2 ?? scores?.primary_score;
    return typeof fused === 'number' ? formatScore(fused) : copy.pending;
  }
  if (feature === 'context-util') {
    let ctxUtil = getMetricFromResults(result, feature, [
      'context_usage_ratio',
      'context_coverage_ratio',
      'coverage_score_u',
      'coverage',
      'dead_weight_ratio',
    ]);
    if (ctxUtil === undefined || ctxUtil === null) {
      const groundingResponse = result?.results.groundedness?.response;
      if (groundingResponse) {
        const gScores = (groundingResponse.raw as { scores?: Record<string, unknown> } | undefined)?.scores;
        ctxUtil = gScores?.context_usage_ratio ?? gScores?.context_coverage_ratio;
      }
    }
    // When all support units are "uncertain" (reranker low-confidence),
    // context_usage_ratio is 0 even though context_coverage_ratio may be
    // near 1.0. Fall back to coverage_ratio so the UI doesn't misleadingly
    // show "0%" for clearly relevant context.
    if (ctxUtil === 0) {
      const groundingResponse = result?.results.groundedness?.response;
      const gScores = (groundingResponse?.raw as { scores?: Record<string, unknown> } | undefined)?.scores;
      const coverageRatio = typeof gScores?.context_coverage_ratio === 'number' ? gScores.context_coverage_ratio : null;
      if (coverageRatio !== null && coverageRatio > 0) {
        ctxUtil = coverageRatio;
      }
    }
    return formatMetric(ctxUtil) ?? copy.pending;
  }
  if (feature === 'drift') {
    const drift = extractDriftBand(result);
    if (drift.band && drift.band !== 'unknown') {
      return drift.band;
    }
    return (
      formatMetric(
        getMetricFromResults(result, feature, [
          'drift',
          'drift_score',
          'overall_risk_band',
          'risk_band',
        ]),
      ) ??
      response.risk_band ??
      copy.pending
    );
  }
  if (feature === 'memory') {
    const actions = response.memory?.actions;
    if (Array.isArray(actions)) {
      return `${actions.length} action${actions.length === 1 ? '' : 's'}`;
    }
    return formatMetric(actions) ?? copy.pending;
  }
  if (feature === 'privacy') {
    const entities = response.privacy?.entity_count;
    if (typeof entities === 'number') {
      return `${entities} entit${entities === 1 ? 'y' : 'ies'}`;
    }
    return copy.pending;
  }
  if (feature === 'compression') {
    const saved = response.compression?.tokens_saved;
    if (typeof saved === 'number') {
      return `${saved} tokens`;
    }
    const ratio = response.compression?.compression_ratio;
    if (typeof ratio === 'number') {
      return formatScore(ratio);
    }
    return copy.pending;
  }
  return copy.pending;
}

function formatScore(value: number): string {
  if (value <= 1) {
    return `${Math.round(value * 100)}%`;
  }
  return String(Math.round(value * 100) / 100);
}

function formatMetric(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return String(value.length);
  }
  if (typeof value === 'number') {
    if (value <= 1) {
      return `${Math.round(value * 100)}%`;
    }
    return String(Math.round(value * 100) / 100);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    return String(Object.keys(value as Record<string, unknown>).length);
  }
  return undefined;
}

function MetaRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2"
      style={{ backgroundColor: latence.bgSurface }}
    >
      <span className="text-xs" style={{ color: latence.textSubtle }}>
        {label}
      </span>
      <span className="truncate text-right text-xs font-medium" style={{ color: latence.text }}>
        {value || copy.pending}
      </span>
    </div>
  );
}

function TurnstileGate({ onVerified }: { onVerified: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (renderedRef.current || !containerRef.current) return;
    const siteKey = TURNSTILE_SITE_KEY;
    if (!siteKey) { onVerified(); return; }

    const win = window as any;
    const render = () => {
      if (renderedRef.current || !containerRef.current) return;
      renderedRef.current = true;
      win.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'dark',
        callback: async (token: string) => {
          try {
            const base = getTraceBridgeBaseUrl();
            const resp = await fetch(`${base}/api/verify-turnstile`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            });
            const data = await resp.json();
            if (data.ok) onVerified();
          } catch {
            onVerified();
          }
        },
        'error-callback': () => { onVerified(); },
      });
    };
    if (win.turnstile) { render(); }
    else {
      const interval = setInterval(() => { if (win.turnstile) { clearInterval(interval); render(); } }, 200);
      const timeout = setTimeout(() => { clearInterval(interval); onVerified(); }, 8000);
      return () => { clearInterval(interval); clearTimeout(timeout); };
    }
  }, [onVerified]);

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-6"
      style={{ backgroundColor: latence.bgPrimary, color: latence.text }}
    >
      <img src={LATENCE_LOGO_SRC} alt="Latence" className="h-10 w-auto" draggable={false} />
      <p className="text-sm" style={{ color: latence.textMuted }}>Verifying you are human...</p>
      <div ref={containerRef} />
    </div>
  );
}

const RAG_EXAMPLE = `What are the tenant's obligations regarding property maintenance under this lease?

<START_CONTEXT>
Section 7.1 – Maintenance Obligations: The tenant shall maintain the leased premises in good condition and shall be responsible for all minor repairs up to EUR 500 per incident. The tenant shall promptly notify the landlord of any structural defects or damage exceeding the minor repair threshold.

Section 7.2 – Common Areas: Maintenance of common areas, including hallways, stairwells, and parking facilities, shall remain the sole responsibility of the landlord. The tenant shall not obstruct or alter common areas without prior written consent.

Section 7.3 – Seasonal Obligations: The tenant is responsible for snow removal on adjacent sidewalks between November 1 and March 31, as required by local municipal ordinance (Streupflicht). Failure to comply may result in liability for damages to third parties.
</END_CONTEXT>`;

const CODE_EXAMPLE_GOOD = `from latence import Latence

def score_and_guard(response_text: str, context: str, query: str | None = None) -> dict:
    client = Latence()
    try:
        result = client.grounding.rag(
            response_text=response_text,
            raw_context=context,
            query_text=query,
        )
        output = {
            "risk_band": result.risk_band,
            "trace_score": result.trace_score,
            "action": result.runtime_decision.get("action"),
        }
        if result.risk_band == "red":
            privacy_result = client.privacy.redact(text=response_text)
            output["redacted_text"] = privacy_result.redacted_text
        return output
    finally:
        client.close()`;

const CODE_EXAMPLE_BAD = `from latence import Latence, ScoringEngine

def score_and_guard(response_text: str, context: str, query: str | None = None) -> dict:
    client = Latence(model="gpt-4", retry_count=3)
    engine = ScoringEngine(client, mode="strict")

    result = engine.analyze(
        answer=response_text,
        documents=context.split("\\n"),
        confidence_level="high",
        return_explanations=True,
    )
    output = {
        "risk_band": result.confidence_band,
        "trace_score": result.overall_confidence,
        "explanations": result.get_explanations(),
    }
    if result.confidence_band == "dangerous":
        sanitizer = client.pii.sanitize(
            input_text=response_text,
            detection_mode="aggressive",
            entity_types=["name", "phone", "iban"],
        )
        output["clean_text"] = sanitizer.cleaned_output
    client.disconnect()
    return output`;

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: latence.textSubtle }}>{label}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
          className="rounded px-2 py-0.5 text-[10px] transition hover:opacity-80"
          style={{ backgroundColor: latence.greenSoft, color: latence.greenText }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        className="overflow-x-auto rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed"
        style={{ backgroundColor: latence.bgPrimary, color: latence.text, border: `1px solid ${latence.border}` }}
      >
        {text}
      </pre>
    </div>
  );
}

function TraceHowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-10"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative mx-4 w-full max-w-2xl rounded-3xl border p-6 shadow-2xl"
        style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-lg transition hover:opacity-70"
          style={{ color: latence.textSubtle }}
        >
          &times;
        </button>

        <div className="mb-6 flex items-center gap-3">
          <img src={LATENCE_LOGO_SRC} alt="Latence" className="h-7 w-auto" draggable={false} />
          <span className="text-lg font-semibold" style={{ color: latence.text }}>
            How <span style={{ color: latence.greenText }}>TRACE</span> Works
          </span>
        </div>

        <div
          className="mb-5 rounded-2xl border px-4 py-3"
          style={{ backgroundColor: latence.bgSurface, borderColor: latence.border }}
        >
          <p className="mb-1 text-sm font-semibold" style={{ color: latence.greenText }}>
            This is a testing demo
          </p>
          <p className="text-sm leading-relaxed" style={{ color: latence.textMuted }}>
            TRACE is an API-based service that integrates into any application. This demo
            lets you experience the real-time analytics firsthand. In production, you call
            the TRACE API from your backend and receive structured JSON with scores,
            diagnostics, and decision recommendations.
          </p>
        </div>

        <div className="mb-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border px-4 py-3" style={{ backgroundColor: latence.bgSurface, borderColor: latence.border }}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>RAG Analytics</p>
            <ul className="space-y-1.5 text-[12px] leading-relaxed" style={{ color: latence.textMuted }}>
              <li><strong style={{ color: latence.text }}>Groundedness</strong> -- How much of the answer is supported by retrieved context</li>
              <li><strong style={{ color: latence.text }}>NLI Claims</strong> -- Per-claim entailment/contradiction analysis with green/amber/red bands</li>
              <li><strong style={{ color: latence.text }}>Context Utilization</strong> -- Which chunks were used, unused, or dead weight</li>
              <li><strong style={{ color: latence.text }}>Privacy</strong> -- Automatic PII entity detection and redaction (GDPR)</li>
              <li><strong style={{ color: latence.text }}>Memory</strong> -- InfiniMem span tracking across conversation turns</li>
              <li><strong style={{ color: latence.text }}>Compression</strong> -- Token savings while preserving critical content</li>
            </ul>
          </div>
          <div className="rounded-2xl border px-4 py-3" style={{ backgroundColor: latence.bgSurface, borderColor: latence.border }}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>Coding Agent Analytics</p>
            <ul className="space-y-1.5 text-[12px] leading-relaxed" style={{ color: latence.textMuted }}>
              <li><strong style={{ color: latence.text }}>AST Phantom Detection</strong> -- Identifies hallucinated function names, classes, and API calls</li>
              <li><strong style={{ color: latence.text }}>Literal Novelty</strong> -- Flags invented string/number literals not in the context</li>
              <li><strong style={{ color: latence.text }}>File Attribution</strong> -- Maps which source files contributed to generated code</li>
              <li><strong style={{ color: latence.text }}>Prompt Guard</strong> -- Llama Prompt Guard 2 security scan on retrieved context</li>
              <li><strong style={{ color: latence.text }}>Drift Rollup</strong> -- Multi-turn model drift and retrieval waste tracking</li>
            </ul>
          </div>
        </div>

        <div className="mb-5 rounded-2xl border px-4 py-3" style={{ backgroundColor: latence.bgSurface, borderColor: latence.border }}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>How to Use Effectively</p>
          <p className="mb-2 text-[12px] leading-relaxed" style={{ color: latence.textMuted }}>
            For best results, wrap your retrieved context in markers so TRACE knows which part is the
            query and which is the supporting context:
          </p>
          <pre
            className="mb-2 overflow-x-auto rounded-lg px-3 py-2 font-mono text-[11px]"
            style={{ backgroundColor: latence.bgPrimary, color: latence.text, border: `1px solid ${latence.border}` }}
          >
{`Your question here?
<START_CONTEXT>
...paste your retrieved chunks here...
</END_CONTEXT>`}
          </pre>
          <p className="text-[11px]" style={{ color: latence.textSubtle }}>
            Also accepted: <code style={{ color: latence.text }}>{'<CTX>...</CTX>'}</code> and <code style={{ color: latence.text }}>[CONTEXT]...[/CONTEXT]</code>.
            Without markers, TRACE infers the question from the first or last paragraph.
          </p>
        </div>

        <div className="mb-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>RAG Example (English, Legal)</p>
          <CopyBlock label="Paste into chat" text={RAG_EXAMPLE} />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>Code Example</p>
          <CopyBlock label="Grounded answer (correct API usage)" text={CODE_EXAMPLE_GOOD} />
          <CopyBlock label="Hallucinated answer (fabricated API calls)" text={CODE_EXAMPLE_BAD} />
        </div>
      </div>
    </div>
  );
}

function generatePromoCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'TRACE-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function TraceShareCard({
  result,
  selection,
  decision,
  riskInfo,
  cardRef,
}: {
  result: TraceDemoMessageResult;
  selection: TraceDemoSelection;
  decision?: ReturnType<typeof extractDecision>;
  riskInfo: { risk: string; score?: number | null };
  cardRef: React.RefObject<HTMLDivElement>;
}) {
  const score = decision?.score ?? riskInfo.score;
  const band = decision?.band ?? riskInfo.risk;
  const bandStyle = getRiskStyle(band);
  const useCaseMeta = traceUseCases.find((u) => u.id === selection.useCase);
  const completedFeatures = Object.entries(result.results)
    .filter(([, r]) => r?.status === 'completed' && r?.response)
    .map(([key, r]) => {
      const meta = traceFeatureCatalog.find((f) => f.key === key);
      return { key, label: meta?.label ?? key, response: r!.response! };
    });
  const avgLatency = (() => {
    const latencies = completedFeatures
      .map((f) => f.response.latency_ms)
      .filter((v): v is number => typeof v === 'number');
    return latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : undefined;
  })();

  return (
    <div
      ref={cardRef as React.RefObject<HTMLDivElement>}
      style={{
        width: 1200,
        height: 675,
        backgroundColor: latence.bgPrimary,
        color: latence.text,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        position: 'relative',
        overflow: 'hidden',
        padding: 48,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* Decorative gradient orbs */}
      <div style={{
        position: 'absolute', top: -120, right: -120,
        width: 400, height: 400, borderRadius: '50%',
        background: `radial-gradient(circle, ${latence.greenSoft} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -80, left: -80,
        width: 300, height: 300, borderRadius: '50%',
        background: `radial-gradient(circle, rgba(11,139,145,0.08) 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src={LATENCE_LOGO_SRC} alt="Latence" style={{ height: 36 }} />
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.06em', color: latence.greenText }}>TRACE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em',
            backgroundColor: latence.greenSoft, color: latence.greenText,
            padding: '6px 16px', borderRadius: 999,
          }}>
            {useCaseMeta?.label ?? selection.useCase}
          </span>
          {band && band !== 'unknown' && (
            <span style={{
              fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em',
              backgroundColor: bandStyle.backgroundColor, color: bandStyle.color,
              border: `1.5px solid ${bandStyle.borderColor}`,
              padding: '6px 16px', borderRadius: 999,
            }}>
              {band}
            </span>
          )}
        </div>
      </div>

      {/* Hero score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 40, position: 'relative', zIndex: 1, flex: 1, paddingTop: 20 }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.2em', color: latence.textSubtle, marginBottom: 6 }}>
            Groundedness Score
          </div>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1, color: bandStyle.color }}>
            {typeof score === 'number' ? (score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(1)) : '—'}
          </div>
        </div>

        {/* Metric tiles */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, flex: 1,
        }}>
          {completedFeatures.filter((f) => f.key !== 'groundedness').slice(0, 4).map((f) => {
            const value = formatFeatureValue(f.key as TraceFeatureKey, f.response, result);
            return (
              <div key={f.key} style={{
                backgroundColor: latence.bgRaised,
                border: `1px solid ${latence.border}`,
                borderRadius: 16, padding: '16px 20px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.18em', color: latence.textSubtle, marginBottom: 4 }}>
                  {f.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: latence.greenText }}>
                  {value}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 1,
        borderTop: `1px solid ${latence.border}`, paddingTop: 16,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: latence.text }}>
            Real-time AI output verification
          </div>
          <div style={{ fontSize: 13, color: latence.textSubtle, marginTop: 2 }}>
            Groundedness, privacy, memory, and drift scoring for every LLM response
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {typeof avgLatency === 'number' && (
            <span style={{ fontSize: 13, color: latence.textMuted }}>{avgLatency}ms avg</span>
          )}
          <span style={{
            fontSize: 14, fontWeight: 600, color: latence.green,
            backgroundColor: latence.greenSoft, padding: '8px 18px', borderRadius: 999,
          }}>
            trace.latence.ai
          </span>
        </div>
      </div>
    </div>
  );
}

function TraceShareModal({
  result,
  selection,
  decision,
  riskInfo,
  onClose,
  onLinkShared,
}: {
  result: TraceDemoMessageResult;
  selection: TraceDemoSelection;
  decision?: ReturnType<typeof extractDecision>;
  riskInfo: { risk: string; score?: number | null };
  onClose: () => void;
  onLinkShared: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const shareRedeemed = (() => {
    try { return window.sessionStorage.getItem(SHARE_REDEEMED_KEY) === '1'; } catch { return false; }
  })();
  const socialShared = (() => {
    try { return window.sessionStorage.getItem(SOCIAL_SHARED_KEY) === '1'; } catch { return false; }
  })();

  const captureCard = async (): Promise<string | null> => {
    const node = cardRef.current;
    if (!node) return null;
    const { toPng } = await import('html-to-image');
    return toPng(node, { pixelRatio: 2, cacheBust: true });
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;
      const link = document.createElement('a');
      link.download = 'latence-trace-results.png';
      link.href = dataUrl;
      link.click();
    } catch { /* noop */ }
    setDownloading(false);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(TRACE_DEMO_URL);
      setLinkCopied(true);
      if (!shareRedeemed) onLinkShared();
      setTimeout(() => setLinkCopied(false), 2500);
    } catch { /* noop */ }
  };

  const handleSocialShare = (platform: 'x' | 'linkedin') => {
    const text = encodeURIComponent(
      'Just tested my AI pipeline with Latence TRACE -- real-time groundedness, privacy, and drift scoring for every LLM response. Try it yourself:',
    );
    const url = encodeURIComponent(TRACE_DEMO_URL);

    if (platform === 'x') {
      window.open(
        `https://twitter.com/intent/tweet?text=${text}&url=${url}&hashtags=AI,LLM,Observability`,
        '_blank',
        'noopener,noreferrer',
      );
    } else {
      window.open(
        `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
        '_blank',
        'noopener,noreferrer',
      );
    }

    if (!socialShared) {
      const code = generatePromoCode();
      setPromoCode(code);
      try { window.sessionStorage.setItem(SOCIAL_SHARED_KEY, '1'); } catch { /* noop */ }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative mx-4 w-full max-w-2xl overflow-hidden rounded-3xl border shadow-2xl"
        style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 transition hover:opacity-70"
          style={{ color: latence.textSubtle }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Card preview */}
        <div className="overflow-hidden" style={{ backgroundColor: latence.bgPrimary }}>
          <div style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: 1200, height: 675 }}>
            <TraceShareCard
              result={result}
              selection={selection}
              decision={decision}
              riskInfo={riskInfo}
              cardRef={cardRef}
            />
          </div>
        </div>
        <div style={{ height: 675 * 0.5, marginTop: -(675 * 0.5) }} />

        {/* Actions */}
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <img src={LATENCE_LOGO_SRC} alt="Latence" className="h-5 w-auto" draggable={false} />
            <span className="text-sm font-semibold" style={{ color: latence.text }}>Share your TRACE results</span>
          </div>

          {/* Copy link + bonus */}
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:opacity-90"
            style={{
              backgroundColor: latence.green,
              borderColor: latence.green,
              color: '#fff',
            }}
          >
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              {linkCopied ? 'Link copied!' : 'Copy demo link'}
            </span>
            {!shareRedeemed && (
              <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                +50 free tests
              </span>
            )}
          </button>

          {/* Social sharing */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleSocialShare('x')}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:opacity-80"
              style={{ borderColor: latence.borderStrong, color: latence.text, backgroundColor: latence.bgSurface }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share on X
            </button>
            <button
              type="button"
              onClick={() => handleSocialShare('linkedin')}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition hover:opacity-80"
              style={{ borderColor: latence.borderStrong, color: latence.text, backgroundColor: latence.bgSurface }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              Share on LinkedIn
            </button>
          </div>

          {/* Download */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm transition hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: latence.border, color: latence.textMuted, backgroundColor: 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {downloading ? 'Generating...' : 'Download image'}
          </button>

          {/* Promo code after social share */}
          {promoCode && (
            <div
              className="rounded-2xl border px-4 py-3 text-center"
              style={{ backgroundColor: latence.greenSoft, borderColor: latence.green }}
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>
                100 free API credits unlocked
              </p>
              <p className="text-lg font-bold tracking-[0.1em]" style={{ color: latence.text }}>
                {promoCode}
              </p>
              <p className="mt-1 text-[11px]" style={{ color: latence.textSubtle }}>
                Redeem this code when you sign up at latence.ai
              </p>
            </div>
          )}

          {/* Bonus info */}
          {!shareRedeemed && !promoCode && (
            <p className="text-center text-[11px]" style={{ color: latence.textSubtle }}>
              Share the demo link to unlock 50 extra tests. Share on X or LinkedIn for 100 free API credits.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TraceSignupModal({ onDismiss, canDismiss }: { onDismiss: () => void; canDismiss: boolean }) {
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadSent, setLeadSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const handleLeadSubmit = async () => {
    if (!name.trim() || !company.trim() || !email.trim()) return;
    setSending(true);
    try {
      const base = getTraceBridgeBaseUrl();
      await fetch(`${base}/api/lead-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), company: company.trim(), email: email.trim(), message: message.trim() }),
      });
      setLeadSent(true);
    } catch { /* noop */ }
    setSending(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
    >
      <div
        className="mx-4 w-full max-w-md rounded-3xl border p-6 shadow-2xl"
        style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
      >
        <div className="mb-5 flex items-center gap-3">
          <img src={LATENCE_LOGO_SRC} alt="Latence" className="h-7 w-auto" draggable={false} />
          <span className="text-lg font-semibold" style={{ color: latence.text }}>
            Ready for <span style={{ color: latence.greenText }}>production</span>?
          </span>
        </div>

        <p className="mb-6 text-sm leading-relaxed" style={{ color: latence.textMuted }}>
          Sign up and get your free API key to integrate TRACE into your own applications,
          or request a dedicated deployment quote for your enterprise.
        </p>

        <div className="mb-4 flex flex-col gap-3">
          <a
            href="https://www.latence.ai/signup"
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-2xl px-4 py-3 text-center text-sm font-semibold transition hover:opacity-90"
            style={{ backgroundColor: latence.green, color: '#fff' }}
          >
            Sign up and get your free API key
          </a>

          {!showLeadForm && !leadSent && (
            <button
              type="button"
              onClick={() => setShowLeadForm(true)}
              className="rounded-2xl border px-4 py-3 text-center text-sm font-semibold transition hover:opacity-80"
              style={{ borderColor: latence.border, color: latence.greenText, backgroundColor: latence.bgSurface }}
            >
              Get a dedicated deployment quote
            </button>
          )}
        </div>

        {showLeadForm && !leadSent && (
          <div
            className="mb-4 space-y-3 rounded-2xl border px-4 py-4"
            style={{ backgroundColor: latence.bgSurface, borderColor: latence.border }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>Deployment Quote</p>
            {[
              { label: 'Name', value: name, set: setName, required: true },
              { label: 'Company', value: company, set: setCompany, required: true },
              { label: 'Email', value: email, set: setEmail, required: true },
            ].map((field) => (
              <div key={field.label}>
                <label className="mb-1 block text-[11px]" style={{ color: latence.textSubtle }}>
                  {field.label} {field.required && <span style={{ color: latence.rose }}>*</span>}
                </label>
                <input
                  type={field.label === 'Email' ? 'email' : 'text'}
                  value={field.value}
                  onChange={(e) => field.set(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-1"
                  style={{
                    backgroundColor: latence.bgPrimary,
                    borderColor: latence.border,
                    color: latence.text,
                    // @ts-expect-error -- ring-color is a valid CSS custom property for Tailwind
                    '--tw-ring-color': latence.green,
                  }}
                />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: latence.textSubtle }}>Message (optional)</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:ring-1"
                style={{
                  backgroundColor: latence.bgPrimary,
                  borderColor: latence.border,
                  color: latence.text,
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleLeadSubmit}
              disabled={sending || !name.trim() || !company.trim() || !email.trim()}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: latence.green, color: '#fff' }}
            >
              {sending ? 'Sending...' : 'Request Quote'}
            </button>
          </div>
        )}

        {leadSent && (
          <div
            className="mb-4 rounded-2xl border px-4 py-3 text-center"
            style={{ backgroundColor: latence.greenSoft, borderColor: latence.green }}
          >
            <p className="text-sm font-semibold" style={{ color: latence.greenText }}>
              Thank you! We will get back to you shortly.
            </p>
          </div>
        )}

        {canDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="w-full text-center text-xs transition hover:opacity-70"
            style={{ color: latence.textSubtle }}
          >
            Continue exploring
          </button>
        )}
      </div>
    </div>
  );
}

function TraceLogDashboard({ logs }: { logs: TraceDemoLog[] }) {
  const [expanded, setExpanded] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const running = logs.filter((log) => log.status === 'running').length;
  const completed = logs.filter((log) => log.status === 'completed').length;
  const errored = logs.filter((log) => log.status === 'error').length;
  const greenCount = logs.filter(
    (log) => (log.response?.risk_band ?? '').toLowerCase() === 'green',
  ).length;
  const amberCount = logs.filter(
    (log) => (log.response?.risk_band ?? '').toLowerCase() === 'amber',
  ).length;
  const redCount = logs.filter(
    (log) => (log.response?.risk_band ?? '').toLowerCase() === 'red',
  ).length;
  const latencies = logs
    .map((log) => log.response?.latency_ms ?? 0)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length)
      : 0;
  const summary =
    logs.length === 0
      ? 'idle'
      : running > 0
        ? `${logs.length} features · ${running} running · ${greenCount}g · ${amberCount}a · ${redCount}r${errored ? ` · ${errored} err` : ''}${avgLatency ? ` · ${avgLatency} ms avg` : ''}`
        : `${completed} features · ${greenCount}g · ${amberCount}a · ${redCount}r${errored ? ` · ${errored} err` : ''}${avgLatency ? ` · ${avgLatency} ms avg` : ''}`;
  return (
    <div
      className="flex flex-col"
      style={{
        backgroundColor: latence.bgPrimary,
        borderTop: `1px solid ${latence.border}`,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between gap-3 px-4 py-2 text-left transition hover:opacity-90"
        style={{ backgroundColor: latence.bgPrimary }}
      >
        <span className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: latence.greenText }}
          >
            TRACE event log
          </span>
          <span className="text-[11px]" style={{ color: latence.textSubtle }}>
            {summary}
          </span>
        </span>
        <span className="text-[10px]" style={{ color: latence.textSubtle }}>
          {expanded ? 'hide' : 'show'}
        </span>
      </button>
      {!expanded ? null : logs.length === 0 ? (
        <p
          className="mx-4 mb-3 rounded-2xl border border-dashed px-3 py-2 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          {copy.emptyLogs}
        </p>
      ) : (
        <div className="px-4 pb-3">
          <div
            className="overflow-hidden rounded-2xl border"
            style={{ borderColor: latence.border, backgroundColor: latence.bgSurface }}
          >
            <table className="w-full text-[11px]" style={{ color: latence.text }}>
              <thead>
                <tr style={{ backgroundColor: latence.bgRaised, color: latence.textSubtle }}>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Feature</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Band</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Score</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Latency</th>
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider">Request</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const open = openRow === log.id;
                  const visual = getStatusVisual(log.status);
                  const band = (log.response?.risk_band ?? '').toLowerCase();
                  const bandColor =
                    band === 'green'
                      ? latence.green
                      : band === 'amber'
                        ? latence.amber
                        : band === 'red'
                          ? latence.rose
                          : latence.textSubtle;
                  const score = log.response?.trace_score;
                  const latency = log.response?.latency_ms;
                  const reqId = log.response?.request_id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => setOpenRow((v) => (v === log.id ? null : log.id))}
                        className="cursor-pointer transition"
                        style={{ borderTop: `1px solid ${latence.border}` }}
                      >
                        <td className="px-3 py-2 font-medium">{log.feature}</td>
                        <td className="px-3 py-2">
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                            style={{ backgroundColor: visual.background, color: visual.color }}
                          >
                            {getStatusLabel(log.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {band ? (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                              style={{
                                backgroundColor: bandColor + '22',
                                color: bandColor,
                                border: `1px solid ${bandColor}55`,
                              }}
                            >
                              {band}
                            </span>
                          ) : (
                            <span style={{ color: latence.textSubtle }}>—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {typeof score === 'number'
                            ? score <= 1
                              ? `${Math.round(score * 100)}%`
                              : score.toFixed(2)
                            : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {typeof latency === 'number' ? `${Math.round(latency)} ms` : '—'}
                        </td>
                        <td
                          className="px-3 py-2 font-mono text-[10px] truncate"
                          style={{ color: latence.textSubtle, maxWidth: 160 }}
                        >
                          {reqId ?? '—'}
                        </td>
                        <td
                          className="px-3 py-2 text-right text-[10px]"
                          style={{ color: latence.textSubtle }}
                        >
                          {open ? '▼' : '▶'}
                        </td>
                      </tr>
                      {open && (
                        <tr style={{ backgroundColor: latence.bgPrimary }}>
                          <td colSpan={7} className="px-3 py-3">
                            <TraceLogRowDetails log={log} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TraceLogRowDetails({ log }: { log: TraceDemoLog }) {
  const [tab, setTab] = useState<'response' | 'request'>('response');
  const payload =
    tab === 'response'
      ? log.response ?? (log.status === 'error' ? { error: log.detail } : {})
      : log.request;
  return (
    <div>
      <div className="mb-2 flex gap-2 text-[10px] uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setTab('response')}
          className="rounded-full px-2 py-0.5"
          style={{
            backgroundColor: tab === 'response' ? latence.greenSoft : 'transparent',
            color: tab === 'response' ? latence.greenText : latence.textSubtle,
            border: `1px solid ${tab === 'response' ? latence.green + '55' : latence.border}`,
          }}
        >
          Response
        </button>
        <button
          type="button"
          onClick={() => setTab('request')}
          className="rounded-full px-2 py-0.5"
          style={{
            backgroundColor: tab === 'request' ? latence.greenSoft : 'transparent',
            color: tab === 'request' ? latence.greenText : latence.textSubtle,
            border: `1px solid ${tab === 'request' ? latence.green + '55' : latence.border}`,
          }}
        >
          Request
        </button>
        <span style={{ color: latence.textSubtle }}>{log.detail}</span>
      </div>
      <pre
        className="overflow-auto rounded-xl px-3 py-2 text-[10px] font-mono"
        style={{
          backgroundColor: latence.bgSurface,
          color: latence.textMuted,
          maxHeight: 320,
          border: `1px solid ${latence.border}`,
        }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

async function fanoutTraceForTurn({
  assistant,
  questionMessage,
  question,
  answer,
  messages,
  selection,
  latestResult,
  setLogs,
  setResults,
  setLatestMessageId,
  updateResult,
}: {
  assistant: TMessage;
  questionMessage?: TMessage;
  question: string;
  answer: string;
  messages: TMessage[];
  selection: TraceDemoSelection;
  latestResult?: TraceDemoMessageResult;
  setLogs: Dispatch<SetStateAction<TraceDemoLog[]>>;
  setResults: Dispatch<SetStateAction<Record<string, TraceDemoMessageResult>>>;
  setLatestMessageId: Dispatch<SetStateAction<string | undefined>>;
  updateResult: (
    messageId: string,
    updater: (current: TraceDemoMessageResult) => TraceDemoMessageResult,
  ) => void;
}) {
  const messageId =
    assistant.messageId ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`);
  const features = getEnabledFeatures(selection.useCase);
  const turns = buildTurns(messages);
  const priorMemoryState = (
    latestResult?.results.memory?.response?.memory as
      | { next_memory_state?: Record<string, unknown> }
      | undefined
  )?.next_memory_state;

  const initialResult: TraceDemoMessageResult = {
    messageId,
    userMessageId: questionMessage?.messageId,
    question,
    answer,
    selection,
    results: features.reduce(
      (acc, feature) => {
        const request = buildTraceBridgeRequest({
          selection,
          feature,
          question,
          answer,
          turns,
          priorMemoryState,
        });
        acc[feature] = {
          feature,
          kind: getKindForFeature(feature, selection.useCase),
          status: 'queued',
          request,
          startedAt: Date.now(),
        };
        return acc;
      },
      {} as Partial<Record<TraceFeatureKey, TraceCallRecord>>,
    ),
    mergedAt: Date.now(),
  };
  setResults((current) => ({ ...current, [messageId]: initialResult }));
  setLatestMessageId(messageId);

  features.forEach((feature) => {
    const record = initialResult.results[feature];
    if (!record) {
      return;
    }
    const log: TraceDemoLog = {
      id: `${messageId}-${feature}-${Date.now()}`,
      feature,
      kind: record.kind,
      status: 'running',
      detail: record.request.scenario,
      createdAt: Date.now(),
      request: record.request,
    };
    setLogs((current) => [log, ...current].slice(0, 24));
    updateResult(messageId, (existing) => ({
      ...existing,
      results: {
        ...existing.results,
        [feature]: { ...record, status: 'running' },
      },
    }));

    void runFeatureCall({
      logId: log.id,
      feature,
      record,
      messageId,
      setLogs,
      updateResult,
    });
  });
}

async function runFeatureCall({
  logId,
  feature,
  record,
  messageId,
  setLogs,
  updateResult,
}: {
  logId: string;
  feature: TraceFeatureKey;
  record: TraceCallRecord;
  messageId: string;
  setLogs: Dispatch<SetStateAction<TraceDemoLog[]>>;
  updateResult: (
    messageId: string,
    updater: (current: TraceDemoMessageResult) => TraceDemoMessageResult,
  ) => void;
}) {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${getTraceBridgeBaseUrl()}/api/trace/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record.request),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || response.statusText);
      }
      const data = (await response.json()) as TraceBridgeResponse;
      setLogs((current) =>
        current.map((entry) =>
          entry.id === logId
            ? {
                ...entry,
                status: 'completed',
                detail: `${data.risk_band || copy.pending} • ${data.request_id || copy.pending} • ${Math.round(data.latency_ms)} ms`,
                response: data,
              }
            : entry,
        ),
      );
      updateResult(messageId, (existing) => ({
        ...existing,
        results: {
          ...existing.results,
          [feature]: {
            ...(existing.results[feature] ?? record),
            status: 'completed',
            response: data,
            finishedAt: Date.now(),
          },
        },
      }));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const wait = 750 * (attempt + 1);
        setLogs((current) =>
          current.map((entry) =>
            entry.id === logId
              ? {
                  ...entry,
                  status: 'running',
                  detail: `retry ${attempt + 1}/${maxAttempts - 1} in ${Math.round(wait)} ms`,
                }
              : entry,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : copy.error;
  setLogs((current) =>
    current.map((entry) =>
      entry.id === logId
        ? {
            ...entry,
            status: 'error',
            detail: message,
          }
        : entry,
    ),
  );
  updateResult(messageId, (existing) => ({
    ...existing,
    results: {
      ...existing.results,
      [feature]: {
        ...(existing.results[feature] ?? record),
        status: 'error',
        error: { message },
        finishedAt: Date.now(),
      },
    },
  }));
}

function getLatestAssistantMessage(messages: TMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.isCreatedByUser !== true && getAllContentText(message).trim());
}

function getPreviousUserMessage(messages: TMessage[], assistant: TMessage) {
  const assistantIndex = messages.findIndex((message) => message.messageId === assistant.messageId);
  return messages
    .slice(0, assistantIndex === -1 ? messages.length : assistantIndex)
    .reverse()
    .find((message) => message.isCreatedByUser === true);
}

function buildTurns(messages: TMessage[]) {
  return messages.slice(-8).map((message) => ({
    role: message.isCreatedByUser ? 'user' : 'assistant',
    text: getAllContentText(message),
    message_id: message.messageId,
  }));
}

function getStatusLabel(status: TraceDemoLog['status']) {
  if (status === 'completed') {
    return copy.completed;
  }
  if (status === 'running') {
    return copy.runningStatus;
  }
  if (status === 'error') {
    return copy.error;
  }
  return copy.queued;
}
