import {
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
          <TraceContextUtilityCard
            evidence={evidence}
            deadWeights={deadWeights}
            decision={decision}
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

function TraceContextUtilityCard({
  evidence,
  deadWeights,
  decision,
}: {
  evidence: ReturnType<typeof extractGroundingEvidence>;
  deadWeights: ReturnType<typeof extractDeadWeights>;
  decision?: ReturnType<typeof extractDecision>;
}) {
  const noData = evidence.length === 0 && deadWeights.files.length === 0;
  if (noData) {
    return null;
  }
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ backgroundColor: latence.bgRaised, borderColor: latence.border }}
    >
      <p className="mb-2 text-sm font-medium" style={{ color: latence.text }}>
        Context utility
      </p>
      {typeof deadWeights.ratio === 'number' && (
        <MetaRow label="Dead weight ratio" value={`${Math.round(deadWeights.ratio * 100)}%`} />
      )}
      {evidence.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {evidence.slice(0, 3).map((item, index) => {
            const coverage =
              typeof item.coverage === 'number' ? Math.round(item.coverage * 100) : null;
            const stateColor =
              item.usageState === 'used'
                ? latence.greenText
                : item.usageState === 'unused'
                  ? latence.rose
                  : latence.amber;
            return (
              <div
                key={`${item.supportId ?? index}`}
                className="rounded-xl border p-2 text-[11px]"
                style={{ borderColor: latence.border, backgroundColor: latence.bgSurface }}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span style={{ color: latence.textSubtle }}>
                    {item.supportId ?? `unit-${index}`}
                  </span>
                  <span style={{ color: stateColor, textTransform: 'capitalize' }}>
                    {item.usageState ?? 'unknown'}
                    {coverage !== null ? ` • ${coverage}%` : ''}
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
      {deadWeights.files.length > 0 && (
        <div className="mt-3">
          <p
            className="mb-1 text-[11px] uppercase tracking-[0.16em]"
            style={{ color: latence.textSubtle }}
          >
            Per file
          </p>
          {deadWeights.files.slice(0, 4).map((file) => (
            <div
              key={file.path}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px]"
              style={{ backgroundColor: latence.bgSurface }}
            >
              <span className="truncate" style={{ color: latence.textMuted }}>
                {file.path}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]"
                style={{
                  color: file.deadWeight ? latence.amber : latence.greenText,
                  backgroundColor: file.deadWeight ? latence.amberSoft : latence.greenSoft,
                }}
              >
                {file.deadWeight ? 'dead weight' : 'active'}
              </span>
            </div>
          ))}
        </div>
      )}
      {decision?.reasonCodes && decision.reasonCodes.length > 0 && (
        <div className="mt-3">
          <p
            className="mb-1 text-[11px] uppercase tracking-[0.16em]"
            style={{ color: latence.textSubtle }}
          >
            Reason codes
          </p>
          <p className="text-[11px]" style={{ color: latence.textMuted }}>
            {decision.reasonCodes.slice(0, 4).join(', ')}
          </p>
        </div>
      )}
      {noData && (
        <p
          className="rounded-2xl border border-dashed p-3 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          Waiting for grounding evidence.
        </p>
      )}
    </div>
  );
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
      <p className="mb-2 text-sm font-medium" style={{ color: latence.text }}>
        Privacy
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
      <p className="mb-2 text-sm font-medium" style={{ color: latence.text }}>
        Compression
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
      <p className="mb-2 text-sm font-medium" style={{ color: latence.text }}>
        InfiniMem
      </p>
      {typeof detail.actionCount === 'number' && (
        <MetaRow label="Actions" value={`${detail.actionCount}`} />
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
      <div className="mb-2 flex items-center justify-between">
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

function TraceLogDashboard({ logs }: { logs: TraceDemoLog[] }) {
  return (
    <div
      className="px-4 py-3"
      style={{
        backgroundColor: latence.bgPrimary,
        borderTop: `1px solid ${latence.border}`,
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p
            className="text-xs font-medium uppercase tracking-[0.2em]"
            style={{ color: latence.textMuted }}
          >
            {copy.logsTitle}
          </p>
          <p className="text-xs" style={{ color: latence.textSubtle }}>
            {copy.logsSubtitle}
          </p>
        </div>
      </div>
      {logs.length === 0 ? (
        <p
          className="rounded-2xl border border-dashed px-3 py-2 text-xs"
          style={{ borderColor: latence.border, color: latence.textSubtle }}
        >
          {copy.emptyLogs}
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {logs.slice(0, 12).map((log) => {
            const visual = getStatusVisual(log.status);
            return (
              <div
                key={log.id}
                className="min-w-[220px] rounded-2xl border px-3 py-2 text-xs"
                style={{
                  backgroundColor: latence.bgSurface,
                  borderColor: latence.border,
                  color: latence.text,
                }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-medium" style={{ color: latence.text }}>
                    {log.feature}
                  </span>
                  <span
                    className={cn('rounded-full px-2 py-0.5')}
                    style={{ backgroundColor: visual.background, color: visual.color }}
                  >
                    {getStatusLabel(log.status)}
                  </span>
                </div>
                <p className="line-clamp-2" style={{ color: latence.textSubtle }}>
                  {log.detail}
                </p>
              </div>
            );
          })}
        </div>
      )}
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
