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
  extractMemoryDetail,
  extractPrivacyDetail,
  extractTraceSpans,
  getActiveOrDefaultSelection,
  getEnabledFeatures,
  getKindForFeature,
  getMetricFromResults,
  getRiskForResult,
  getTraceBridgeBaseUrl,
  traceFeatureCatalog,
  traceIntegrations,
  traceUseCases,
  writeTraceDemoSelection,
  type TraceBridgeResponse,
  type TraceCallRecord,
  type TraceDemoIntegration,
  type TraceDemoLog,
  type TraceDemoMessageResult,
  type TraceDemoSelection,
  type TraceDemoUseCase,
  type TraceFeatureKey,
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
  modelValue: 'OpenRouter / Nemotron free',
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
  heatmapTitle: 'Unsupported-span heatmap',
  noSpans: 'No unsupported spans returned for this response.',
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
  if (normalized === 'yellow' || normalized === 'amber') {
    return {
      backgroundColor: latence.amberSoft,
      borderColor: latence.amber,
      color: latence.amber,
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
  const spans = extractTraceSpans(latestResult);
  const riskInfo = getRiskForResult(latestResult);
  const decision = extractDecision(latestResult);
  const deadWeights = extractDeadWeights(latestResult);
  const evidence = extractGroundingEvidence(latestResult);
  const compressionDetail = extractCompressionDetail(latestResult);
  const privacyDetail = extractPrivacyDetail(latestResult);
  const memoryDetail = extractMemoryDetail(latestResult);
  const driftDetail = extractDriftBand(latestResult);

  const handleUseCaseChange = (next: TraceDemoUseCase) =>
    setSelection((current) => ({ ...current, useCase: next, createdAt: Date.now() }));
  const handleIntegrationChange = (next: TraceDemoIntegration) =>
    setSelection((current) => ({ ...current, integration: next, createdAt: Date.now() }));

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
          />
          <div className="min-h-0 flex-1">{children}</div>
          <TraceInputHint />
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
          />
          <TraceGroundednessCard
            decision={decision}
            riskInfo={riskInfo}
            evidence={evidence}
            deadWeights={deadWeights}
          />
          <TracePrivacyCard detail={privacyDetail} />
          <TraceCompressionCard detail={compressionDetail} />
          <TraceMemoryCard detail={memoryDetail} />
          <TraceDriftCard detail={driftDetail} />
        </aside>
      </div>
    </TraceDemoContext.Provider>
  );
}

function TraceTopToggle({
  selection,
  onUseCase,
  onIntegration,
  decision,
  band,
}: {
  selection: TraceDemoSelection;
  onUseCase: (next: TraceDemoUseCase) => void;
  onIntegration: (next: TraceDemoIntegration) => void;
  decision?: string;
  band?: string | null;
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
            className="rounded-full px-3 py-1 text-xs font-semibold uppercase capitalize tracking-[0.18em]"
            style={{
              backgroundColor: bandStyle.backgroundColor,
              color: bandStyle.color,
              border: `1px solid ${bandStyle.borderColor}`,
            }}
          >
            {band}
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
}) {
  const band = decision?.band ?? riskInfo.risk;
  const style = getRiskStyle(band);
  const score = decision?.score ?? riskInfo.score;
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
              className="rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize tracking-[0.18em]"
              style={{
                backgroundColor: style.backgroundColor,
                color: style.color,
                borderColor: style.borderColor,
              }}
            >
              {band}
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
              {score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2)} score
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

function TraceAnalyticsHeader({
  useCaseLabel,
  integrationLabel,
  decision,
  riskInfo,
}: {
  useCaseLabel?: string;
  integrationLabel?: string;
  decision?: ReturnType<typeof extractDecision>;
  riskInfo: { risk: string; score?: number | null };
}) {
  const band = decision?.band ?? riskInfo.risk;
  const style = getRiskStyle(band);
  const score = decision?.score ?? riskInfo.score;
  return (
    <div
      className="mb-4 rounded-3xl border p-4"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.22em]" style={{ color: latence.greenText }}>
          {copy.panelTitle}
        </p>
        <span
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize"
          style={{
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            color: style.color,
          }}
        >
          {band || copy.pending}
        </span>
      </div>
      <p className="mb-3 text-xs" style={{ color: latence.textMuted }}>
        {copy.panelSubtitle}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <MetaRow label={copy.useCase} value={useCaseLabel} />
        <MetaRow label={copy.integration} value={integrationLabel} />
      </div>
      {(typeof score === 'number' || decision?.action) && (
        <div
          className="mt-3 grid grid-cols-2 gap-2 border-t pt-3"
          style={{ borderColor: latence.border }}
        >
          <MetaRow
            label="Decision"
            value={decision?.action ? decision.action.toUpperCase() : copy.pending}
          />
          <MetaRow
            label="Score"
            value={
              typeof score === 'number'
                ? score <= 1
                  ? `${Math.round(score * 100)}%`
                  : score.toFixed(2)
                : copy.pending
            }
          />
        </div>
      )}
    </div>
  );
}

function TraceMetricGrid({
  features,
  result,
}: {
  features: TraceFeatureKey[];
  result?: TraceDemoMessageResult;
}) {
  return (
    <div
      className="mb-4 rounded-3xl border p-4"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <p className="mb-3 text-sm font-medium" style={{ color: latence.text }}>
        Metrics
      </p>
      <div className="grid grid-cols-2 gap-2">
        {features.map((feature) => (
          <MetricCell key={feature} feature={feature} result={result} />
        ))}
      </div>
    </div>
  );
}

function TraceTelemetryCard({
  requestId,
  avgLatency,
  isRunning,
  hasResult,
}: {
  requestId?: string;
  avgLatency?: number;
  isRunning: boolean;
  hasResult: boolean;
}) {
  return (
    <div
      className="mb-4 rounded-3xl border p-4"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <p className="mb-3 text-sm font-medium" style={{ color: latence.text }}>
        Telemetry
      </p>
      <div className="space-y-2">
        <MetaRow label={copy.requestId} value={requestId ?? copy.pending} />
        <MetaRow
          label={copy.latency}
          value={typeof avgLatency === 'number' ? `${avgLatency} ms avg` : copy.pending}
        />
      </div>
      {!hasResult && (
        <p
          className="mt-3 rounded-2xl border border-dashed p-3 text-xs"
          style={{ borderColor: latence.border, color: latence.textMuted }}
        >
          {isRunning ? copy.running : copy.waiting}
        </p>
      )}
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
}: {
  decision?: ReturnType<typeof extractDecision>;
  riskInfo: { risk: string; score?: number | null };
  evidence: ReturnType<typeof extractGroundingEvidence>;
  deadWeights: ReturnType<typeof extractDeadWeights>;
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
            {band}
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        How much of the answer is supported by the retrieved context.
      </p>
      {typeof score === 'number' && (
        <MetaRow
          label="Trace score"
          value={score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2)}
        />
      )}
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
            Evidence chunks
          </p>
          {dedupedEvidence.slice(0, 4).map((item, index) => {
            const coverage =
              typeof item.coverage === 'number' ? Math.round(item.coverage * 100) : null;
            const usage = (item.usageState || '').toLowerCase();
            const stateColor =
              usage === 'used'
                ? latence.greenText
                : usage === 'unused'
                  ? latence.rose
                  : latence.amber;
            return (
              <div
                key={`${item.supportId ?? index}`}
                className="rounded-xl border p-2 text-[11px]"
                style={{ borderColor: latence.border, backgroundColor: latence.bgSurface }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate" style={{ color: latence.textSubtle }}>
                    {item.supportId ?? `chunk-${index}`}
                  </span>
                  <span
                    style={{ color: stateColor, textTransform: 'capitalize' }}
                    className="text-[10px]"
                  >
                    {item.usageState ?? 'unknown'}
                    {coverage !== null ? ` · ${coverage}%` : ''}
                  </span>
                </div>
                {item.text && (
                  <p className="line-clamp-2" style={{ color: latence.textMuted }}>
                    {item.text}
                  </p>
                )}
              </div>
            );
          })}
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
  const empty = detail.entityCount === undefined && detail.byLabel.length === 0;
  if (empty) {
    return null;
  }
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <p className="text-sm font-medium" style={{ color: latence.text }}>
        Privacy
      </p>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        Sensitive entities detected in the prompt + answer before logging.
      </p>
      {typeof detail.entityCount === 'number' && (
        <MetaRow label="Entities found" value={String(detail.entityCount)} />
      )}
      {detail.byLabel.length > 0 && (
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
              {entry.label} • {entry.count}
            </span>
          ))}
        </div>
      )}
      {detail.redacted && (
        <p
          className="mt-3 line-clamp-3 rounded-xl border p-2 text-[11px]"
          style={{
            backgroundColor: latence.bgSurface,
            borderColor: latence.border,
            color: latence.textMuted,
          }}
        >
          {detail.redacted}
        </p>
      )}
      {empty && (
        <p
          className="rounded-2xl border border-dashed p-3 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          No entities surfaced for this turn.
        </p>
      )}
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
  const empty = detail.actionCount === undefined && !detail.hotContext;
  if (empty) {
    return null;
  }
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <p className="text-sm font-medium" style={{ color: latence.text }}>
        InfiniMem
      </p>
      <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
        Durable memory updates and the hot context carried into the next turn.
      </p>
      {typeof detail.actionCount === 'number' && (
        <MetaRow label="Memory actions" value={`${detail.actionCount}`} />
      )}
      {detail.hotContext && (
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
      )}
      {empty && (
        <p
          className="rounded-2xl border border-dashed p-3 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          Waiting for memory step.
        </p>
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

function TraceUnsupportedSpansCard({
  spans,
}: {
  spans:
    | ReturnType<typeof extractTraceSpans>
    | NonNullable<ReturnType<typeof extractDecision>>['unsupportedSpans'];
}) {
  return (
    <div
      className="rounded-3xl border p-4"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <p className="mb-3 text-sm font-medium" style={{ color: latence.text }}>
        {copy.heatmapTitle}
      </p>
      {spans.length > 0 ? (
        <div className="space-y-2">
          {spans.slice(0, 4).map((span, index) => (
            <div
              key={`${span.label}-${index}`}
              className="rounded-2xl border p-3 text-xs"
              style={{
                backgroundColor: latence.amberSoft,
                borderColor: latence.amber,
                color: latence.text,
              }}
            >
              <p className="mb-1" style={{ color: latence.amber }}>
                {span.label}
              </p>
              <p className="line-clamp-3" style={{ color: latence.textMuted }}>
                {span.text}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p
          className="rounded-2xl border border-dashed p-3 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          {copy.noSpans}
        </p>
      )}
    </div>
  );
}

function MetricCell({
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
  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        backgroundColor: latence.bgSurface,
        borderColor: isCompleted ? latence.greenSoftStrong : latence.border,
      }}
    >
      <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: latence.textSubtle }}>
        {meta?.label ?? feature}
      </p>
      <p
        className="mt-1 truncate text-sm font-medium"
        style={{
          color: isError ? latence.rose : isCompleted ? latence.greenText : latence.text,
        }}
      >
        {isRunning ? '…' : value}
      </p>
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
    if (typeof response.trace_score === 'number') {
      return formatScore(response.trace_score);
    }
    const decisionScore = (response.runtime_decision as { score?: number } | null)?.score;
    return typeof decisionScore === 'number' ? formatScore(decisionScore) : copy.pending;
  }
  if (feature === 'context-util') {
    return (
      formatMetric(
        getMetricFromResults(result, feature, [
          'context_coverage_ratio',
          'coverage_score_u',
          'coverage',
          'dead_weight_ratio',
        ]),
      ) ?? copy.pending
    );
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

function RiskPill({ risk }: { risk?: string | null }) {
  const style = getRiskStyle(risk);
  return (
    <span
      className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize"
      style={{
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        color: style.color,
      }}
    >
      {risk || copy.pending}
    </span>
  );
}

function TraceInputHint() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative flex items-start justify-end gap-3 px-4 py-1.5 text-[11px]"
      style={{
        backgroundColor: latence.bgPrimary,
        borderTop: `1px solid ${latence.border}`,
        color: latence.textSubtle,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 transition hover:opacity-80"
        style={{ color: latence.textSubtle }}
        aria-expanded={open}
      >
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
          style={{
            border: `1px solid ${latence.border}`,
            color: latence.greenText,
          }}
        >
          ?
        </span>
        <span>How TRACE reads your input</span>
      </button>
      {open && (
        <div
          className="absolute right-4 z-10 max-w-[420px] -translate-y-[calc(100%+8px)] rounded-2xl border px-3 py-2 text-[11px] shadow-lg"
          style={{
            backgroundColor: latence.bgRaised,
            borderColor: latence.border,
            color: latence.textMuted,
          }}
        >
          <p className="mb-2 font-semibold uppercase tracking-wider" style={{ color: latence.greenText }}>
            Input parsing
          </p>
          <p className="mb-1.5">
            For best results, wrap your retrieved context in markers so TRACE knows
            which part is the query and which is the supporting context:
          </p>
          <pre
            className="mb-2 overflow-x-auto rounded-lg px-2 py-1 font-mono text-[10px]"
            style={{ backgroundColor: latence.bgSurface, color: latence.text }}
          >
{`Wer war Roßmann?
<START_CONTEXT>
…paste your retrieved chunks here…
</END_CONTEXT>`}
          </pre>
          <p className="mb-1.5">
            Also accepted: <code style={{ color: latence.text }}>{'<CTX>…</CTX>'}</code> and
            <code style={{ color: latence.text }}> [CONTEXT]…[/CONTEXT]</code>.
          </p>
          <p>
            Without markers we infer the question from the first or last paragraph
            (German + English question words, or trailing <code>?</code>). The
            heatmap header shows which mode was applied.
          </p>
        </div>
      )}
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
