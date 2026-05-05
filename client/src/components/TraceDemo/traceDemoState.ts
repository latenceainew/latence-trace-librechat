import { createContext, useContext } from 'react';

export type TraceDemoUseCase = 'rag' | 'coding-agent';
export type TraceDemoIntegration = 'sdk-librechat' | 'langchain-rag' | 'langgraph-code' | 'n8n';

/**
 * Internal analytics-only labels. Feature focus is no longer a setup
 * choice; the right column always shows the full grid for the
 * selected use case and TRACE values fill in as fan-out calls return.
 */
export type TraceFeatureKey =
  | 'groundedness'
  | 'context-util'
  | 'drift'
  | 'memory'
  | 'privacy'
  | 'compression';

export type TraceBridgeIntegration = 'native' | 'langchain' | 'llamaindex' | 'langgraph' | 'n8n';
export type TraceBridgeKind = 'rag' | 'code' | 'privacy' | 'memory' | 'compression' | 'rollup';

export type TraceDemoSelection = {
  active: true;
  useCase: TraceDemoUseCase;
  integration: TraceDemoIntegration;
  createdAt: number;
};

export type TraceBridgeRequest = {
  scenario: string;
  integration: TraceBridgeIntegration;
  kind: TraceBridgeKind;
  question?: string;
  context?: string | string[];
  answer?: string;
  text?: string;
  turns?: Array<Record<string, unknown>>;
  prior_memory_state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type TraceBridgeResponse = {
  scenario: string;
  integration: string;
  risk_band: string;
  trace_score?: number | null;
  runtime_decision?: Record<string, unknown> | null;
  request_id?: string | null;
  latency_ms: number;
  evidence?: Array<Record<string, unknown>>;
  privacy?: Record<string, unknown> | null;
  memory?: Record<string, unknown> | null;
  compression?: Record<string, unknown> | null;
  raw?: Record<string, unknown>;
};

export type TraceCallError = {
  message: string;
};

export type TraceCallStatus = 'queued' | 'running' | 'completed' | 'error';

export type TraceCallRecord = {
  feature: TraceFeatureKey;
  kind: TraceBridgeKind;
  status: TraceCallStatus;
  request: TraceBridgeRequest;
  response?: TraceBridgeResponse;
  error?: TraceCallError;
  startedAt: number;
  finishedAt?: number;
};

export type TraceDemoLog = {
  id: string;
  feature: TraceFeatureKey;
  kind: TraceBridgeKind;
  status: TraceCallStatus;
  detail: string;
  createdAt: number;
  request: TraceBridgeRequest;
  response?: TraceBridgeResponse;
};

export type TraceDemoMessageResult = {
  messageId: string;
  userMessageId?: string;
  question: string;
  answer: string;
  selection: TraceDemoSelection;
  results: Partial<Record<TraceFeatureKey, TraceCallRecord>>;
  mergedAt: number;
};

export type TraceSpan = {
  text: string;
  label: string;
  confidence?: number;
};

export type TraceHeatBand = 'green' | 'amber' | 'red' | 'unknown';

export type TraceHeatToken = {
  index: number;
  display: string;
  band: TraceHeatBand;
  score?: number;
  leadingSpace: boolean;
  isSpecial: boolean;
};

export type TraceEvidenceItem = {
  supportId?: string;
  text?: string;
  coverage?: number;
  usageState?: string;
  trustState?: string;
};

export type TraceDecision = {
  action?: string;
  band?: string;
  score?: number;
  reasonCodes: string[];
  unsupportedSpans: TraceSpan[];
};

export type TraceFileAttribution = {
  path: string;
  coverage?: number;
  ownerShare?: number;
  deadWeight: boolean;
  reasonCodes: string[];
};

type TraceDemoContextValue = {
  active: boolean;
  selection?: TraceDemoSelection;
  latestResult?: TraceDemoMessageResult;
  getResultForMessage: (messageId?: string | null) => TraceDemoMessageResult | undefined;
};

export const TRACE_DEMO_STORAGE_KEY = 'latence.trace.demo.selection';
export const TRACE_DEMO_MODEL = 'google/gemma-4-26b-a4b-it:free';

export const traceUseCases: Array<{
  id: TraceDemoUseCase;
  label: string;
  eyebrow: string;
  description: string;
}> = [
  {
    id: 'rag',
    label: 'RAG',
    eyebrow: 'Customer-facing answers',
    description: 'Inspect groundedness, context utility, privacy, memory, and cost in real time.',
  },
  {
    id: 'coding-agent',
    label: 'Coding Agent',
    eyebrow: 'Agentic code workflows',
    description: 'Score whether code is grounded in the task, files, and durable agent state.',
  },
];

export const traceIntegrations: Array<{
  id: TraceDemoIntegration;
  label: string;
  description: string;
}> = [
  {
    id: 'sdk-librechat',
    label: 'API / SDK',
    description: 'Native LibreChat flow with a server-side TRACE SDK bridge.',
  },
  {
    id: 'langchain-rag',
    label: 'LangChain',
    description: 'RAG chain callback path for retriever and answer scoring.',
  },
  {
    id: 'langgraph-code',
    label: 'LangGraph',
    description: 'Coding graph route that turns TRACE results into review or retry decisions.',
  },
  {
    id: 'n8n',
    label: 'n8n',
    description: 'Workflow automation using the same SDK bridge contract.',
  },
];

/**
 * Display metadata for the analytics column. Order is the order shown
 * in the right shell. Each entry maps to the SDK call that fills it.
 */
export const traceFeatureCatalog: Array<{
  key: TraceFeatureKey;
  label: string;
  endpoint: string;
  description: string;
}> = [
  {
    key: 'groundedness',
    label: 'Groundedness',
    endpoint: 'grounding',
    description: 'Score whether the answer is supported by the retrieved context.',
  },
  {
    key: 'context-util',
    label: 'Context utility',
    endpoint: 'grounding',
    description: 'Useful, weak, and dead-weight context measured per turn.',
  },
  {
    key: 'drift',
    label: 'Drift',
    endpoint: 'rollup',
    description: 'How far the session has moved from the policy or task.',
  },
  {
    key: 'memory',
    label: 'InfiniMem',
    endpoint: 'memory.step',
    description: 'Durable memory and hot context updated per turn.',
  },
  {
    key: 'privacy',
    label: 'Privacy',
    endpoint: 'privacy.redact',
    description: 'Sensitive entities detected before logging or orchestration.',
  },
  {
    key: 'compression',
    label: 'Compression',
    endpoint: 'compression.text',
    description: 'Token savings while preserving decision-critical constraints.',
  },
];

const FEATURE_TO_KIND: Record<TraceFeatureKey, TraceBridgeKind> = {
  groundedness: 'rag',
  'context-util': 'rag',
  drift: 'rollup',
  memory: 'memory',
  privacy: 'privacy',
  compression: 'compression',
};

const RAG_FEATURES: TraceFeatureKey[] = [
  'groundedness',
  'context-util',
  'drift',
  'memory',
  'privacy',
  'compression',
];

const CODING_FEATURES: TraceFeatureKey[] = [
  'groundedness',
  'context-util',
  'drift',
  'memory',
  'privacy',
  'compression',
];

export function getEnabledFeatures(useCase: TraceDemoUseCase): TraceFeatureKey[] {
  return useCase === 'coding-agent' ? CODING_FEATURES : RAG_FEATURES;
}

export function getKindForFeature(
  feature: TraceFeatureKey,
  useCase: TraceDemoUseCase,
): TraceBridgeKind {
  if (feature === 'groundedness' || feature === 'context-util') {
    return useCase === 'coding-agent' ? 'code' : 'rag';
  }
  return FEATURE_TO_KIND[feature];
}

export const TraceDemoContext = createContext<TraceDemoContextValue>({
  active: false,
  getResultForMessage: () => undefined,
});

export function useTraceDemo() {
  return useContext(TraceDemoContext);
}

export function getTraceDemoSelectionFromParams(
  searchParams: URLSearchParams,
): TraceDemoSelection | null {
  if (searchParams.get('trace_demo') !== '1') {
    return null;
  }
  const useCase = searchParams.get('trace_use_case') as TraceDemoUseCase | null;
  const integration = searchParams.get('trace_integration') as TraceDemoIntegration | null;
  if (!isTraceUseCase(useCase) || !isTraceIntegration(integration)) {
    return null;
  }
  return {
    active: true,
    useCase,
    integration,
    createdAt: Date.now(),
  };
}

export function readStoredTraceDemoSelection(): TraceDemoSelection | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(TRACE_DEMO_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TraceDemoSelection>;
    if (
      parsed.active === true &&
      isTraceUseCase(parsed.useCase) &&
      isTraceIntegration(parsed.integration)
    ) {
      return parsed as TraceDemoSelection;
    }
  } catch {
    return null;
  }
  return null;
}

export function writeTraceDemoSelection(selection: TraceDemoSelection) {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(TRACE_DEMO_STORAGE_KEY, JSON.stringify(selection));
}

export function clearTraceDemoSelection() {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(TRACE_DEMO_STORAGE_KEY);
}

export function getActiveTraceDemoSelection(
  searchParams: URLSearchParams,
): TraceDemoSelection | null {
  const fromParams = getTraceDemoSelectionFromParams(searchParams);
  if (fromParams) {
    writeTraceDemoSelection(fromParams);
    return fromParams;
  }
  return readStoredTraceDemoSelection();
}

/**
 * Always-on selection. Falls back to a sane RAG / SDK default so the
 * shell renders without a setup flow. Persists the default once so the
 * in-chat toggle can mutate it like any other selection.
 */
export function getActiveOrDefaultSelection(searchParams: URLSearchParams): TraceDemoSelection {
  const existing = getActiveTraceDemoSelection(searchParams);
  if (existing) {
    return existing;
  }
  const fallback: TraceDemoSelection = { ...TRACE_DEMO_DEFAULT_SELECTION, createdAt: Date.now() };
  writeTraceDemoSelection(fallback);
  return fallback;
}

export function buildTraceChatSearchParams(selection: TraceDemoSelection) {
  return new URLSearchParams({
    trace_demo: '1',
    trace_use_case: selection.useCase,
    trace_integration: selection.integration,
    spec: selection.useCase === 'coding-agent' ? 'trace-coding-demo' : 'trace-rag-demo',
    endpoint: 'OpenRouter',
    model: TRACE_DEMO_MODEL,
  });
}

export function getTraceBridgeBaseUrl() {
  return import.meta.env.VITE_TRACE_DEMO_BRIDGE_URL || '/trace-bridge';
}

export function mapTraceIntegration(integration: TraceDemoIntegration): TraceBridgeIntegration {
  if (integration === 'langchain-rag') {
    return 'langchain';
  }
  if (integration === 'langgraph-code') {
    return 'langgraph';
  }
  if (integration === 'n8n') {
    return 'n8n';
  }
  return 'native';
}

type BuildRequestArgs = {
  selection: TraceDemoSelection;
  feature: TraceFeatureKey;
  question: string;
  answer: string;
  turns: Array<Record<string, unknown>>;
  priorMemoryState?: Record<string, unknown>;
};

export function buildTraceBridgeRequest({
  selection,
  feature,
  question,
  answer,
  turns,
  priorMemoryState,
}: BuildRequestArgs): TraceBridgeRequest {
  const integration = mapTraceIntegration(selection.integration);
  const kind = getKindForFeature(feature, selection.useCase);
  const context = getDemoContext(selection.useCase);
  const scenario = `trace_${selection.useCase}_${feature}_${selection.integration}`.replace(
    /-/g,
    '_',
  );
  const metadata = {
    use_case: selection.useCase,
    feature,
    integration: selection.integration,
    source: 'librechat_trace_demo',
  };

  if (kind === 'privacy') {
    return {
      scenario,
      integration,
      kind,
      text: `${question}\n\n${answer}`,
      metadata,
    };
  }
  if (kind === 'memory') {
    return {
      scenario,
      integration,
      kind,
      text: answer,
      question,
      context,
      prior_memory_state: priorMemoryState,
      metadata,
    };
  }
  if (kind === 'compression') {
    return {
      scenario,
      integration,
      kind,
      question,
      answer,
      context,
      text: `${contextAsText(context)}\n\nQuestion: ${question}\nAnswer: ${answer}`,
      metadata,
    };
  }
  if (kind === 'rollup') {
    return {
      scenario,
      integration,
      kind,
      turns,
      question,
      answer,
      context,
      metadata,
    };
  }
  return {
    scenario,
    integration,
    kind,
    question,
    answer,
    context,
    metadata,
  };
}

export function extractTraceSpans(result?: TraceDemoMessageResult): TraceSpan[] {
  if (!result) {
    return [];
  }
  const responses = Object.values(result.results)
    .filter((record): record is TraceCallRecord => !!record?.response)
    .map((record) => record.response as TraceBridgeResponse);
  if (responses.length === 0) {
    return [];
  }
  const candidates = responses.flatMap((response) => [
    response.raw?.unsupported_spans,
    response.raw?.unsupportedSpans,
    response.raw?.spans,
    response.runtime_decision?.unsupported_spans,
    response.runtime_decision?.unsupportedSpans,
    response.evidence,
  ]);
  return candidates.flatMap((value) => parseSpanList(value)).slice(0, 6);
}

export function getMetricFromResults(
  result: TraceDemoMessageResult | undefined,
  feature: TraceFeatureKey,
  keys: string[],
): unknown {
  if (!result) {
    return undefined;
  }
  const record = result.results[feature];
  if (!record?.response) {
    return undefined;
  }
  const response = record.response;
  for (const key of keys) {
    const value =
      response.raw?.[key] ??
      response.runtime_decision?.[key] ??
      response.privacy?.[key] ??
      response.memory?.[key] ??
      response.compression?.[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * Default selection used when the chat shell loads without an explicit
 * `trace_demo` query param or stored selection. Keeps the demo always-on
 * so the buyer never sees an empty TRACE column.
 */
export const TRACE_DEMO_DEFAULT_SELECTION: TraceDemoSelection = {
  active: true,
  useCase: 'rag',
  integration: 'sdk-librechat',
  createdAt: 0,
};

export function getGroundingResponse(
  result?: TraceDemoMessageResult,
): TraceBridgeResponse | undefined {
  if (!result) {
    return undefined;
  }
  return result.results.groundedness?.response ?? result.results['context-util']?.response;
}

export function extractTokenHeatmap(result?: TraceDemoMessageResult): TraceHeatToken[] {
  const response = getGroundingResponse(result);
  const tokens = (response?.raw as { heatmap?: { tokens?: unknown } } | undefined)?.heatmap?.tokens;
  if (!Array.isArray(tokens)) {
    return [];
  }
  return tokens
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const rawToken = typeof item.token === 'string' ? item.token : '';
      if (!rawToken) {
        return null;
      }
      const isSpecial = rawToken.startsWith('[') && rawToken.endsWith(']');
      const leadingSpace = rawToken.startsWith('Ġ') || rawToken.startsWith(' ');
      const display = rawToken.replace(/^Ġ/, '').replace(/^\s+/, '');
      const band = normalizeBand(item.band);
      const score = typeof item.score === 'number' ? item.score : undefined;
      const index = typeof item.index === 'number' ? item.index : 0;
      return { index, display, band, score, leadingSpace, isSpecial };
    })
    .filter((token): token is TraceHeatToken => token !== null);
}

export function extractGroundingEvidence(result?: TraceDemoMessageResult): TraceEvidenceItem[] {
  const response = getGroundingResponse(result);
  if (!response) {
    return [];
  }
  const sources: unknown[] = [];
  if (Array.isArray(response.evidence)) {
    sources.push(...response.evidence);
  }
  const decisionEvidence = (response.runtime_decision as { evidence?: unknown } | undefined)
    ?.evidence;
  if (Array.isArray(decisionEvidence)) {
    sources.push(...decisionEvidence);
  }
  const supportUnits = (response.raw as { support_units?: unknown } | undefined)?.support_units;
  if (Array.isArray(supportUnits)) {
    sources.push(...supportUnits);
  }
  const seen = new Set<string>();
  const evidence: TraceEvidenceItem[] = [];
  for (const item of sources) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const supportId =
      typeof record.support_id === 'string'
        ? record.support_id
        : typeof record.supportId === 'string'
          ? record.supportId
          : undefined;
    const text = typeof record.text === 'string' ? record.text : undefined;
    const dedupeKey = `${supportId ?? ''}|${text ?? ''}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    evidence.push({
      supportId,
      text,
      coverage:
        typeof record.coverage_score === 'number'
          ? record.coverage_score
          : typeof record.coverage === 'number'
            ? record.coverage
            : undefined,
      usageState: typeof record.usage_state === 'string' ? record.usage_state : undefined,
      trustState:
        typeof record.context_trust_state === 'string' ? record.context_trust_state : undefined,
    });
  }
  return evidence;
}

export function extractDecision(result?: TraceDemoMessageResult): TraceDecision | undefined {
  const response = getGroundingResponse(result);
  if (!response) {
    return undefined;
  }
  const decision = (response.runtime_decision ?? {}) as Record<string, unknown>;
  const reasonCodes: string[] = [];
  if (Array.isArray(decision.reason_codes)) {
    for (const code of decision.reason_codes) {
      if (typeof code === 'string') {
        reasonCodes.push(code);
      }
    }
  }
  if (Array.isArray((response.raw as { reason_codes?: unknown } | undefined)?.reason_codes)) {
    for (const code of (response.raw as { reason_codes?: unknown[] }).reason_codes ?? []) {
      if (typeof code === 'string' && !reasonCodes.includes(code)) {
        reasonCodes.push(code);
      }
    }
  }
  const unsupported: TraceSpan[] = [];
  const decisionSpans = decision.unsupported_spans;
  if (Array.isArray(decisionSpans)) {
    for (const span of decisionSpans) {
      if (typeof span === 'string') {
        unsupported.push({ text: span, label: 'Unsupported' });
      } else if (span && typeof span === 'object') {
        const record = span as Record<string, unknown>;
        const text = typeof record.text === 'string' ? record.text : '';
        if (text) {
          unsupported.push({
            text,
            label:
              typeof record.label === 'string'
                ? record.label
                : typeof record.reason === 'string'
                  ? record.reason
                  : 'Unsupported',
            confidence: typeof record.confidence === 'number' ? record.confidence : undefined,
          });
        }
      }
    }
  }
  return {
    action: typeof decision.action === 'string' ? decision.action : undefined,
    band:
      typeof decision.band === 'string'
        ? decision.band
        : typeof response.risk_band === 'string'
          ? response.risk_band
          : undefined,
    score:
      typeof decision.score === 'number' ? decision.score : (response.trace_score ?? undefined),
    reasonCodes,
    unsupportedSpans: unsupported,
  };
}

export function extractDeadWeights(result?: TraceDemoMessageResult): {
  ratio?: number;
  files: TraceFileAttribution[];
} {
  const response = getGroundingResponse(result);
  const attribution = (response?.raw as { file_attribution?: unknown } | undefined)
    ?.file_attribution as
    | { dead_weight_ratio?: unknown; per_file?: unknown[]; dead_weight_files?: unknown[] }
    | undefined;
  if (!attribution) {
    return { files: [] };
  }
  const files: TraceFileAttribution[] = Array.isArray(attribution.per_file)
    ? attribution.per_file
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const record = entry as Record<string, unknown>;
          return {
            path: typeof record.path === 'string' ? record.path : 'unknown',
            coverage: typeof record.coverage === 'number' ? record.coverage : undefined,
            ownerShare: typeof record.owner_share === 'number' ? record.owner_share : undefined,
            deadWeight: record.dead_weight === true,
            reasonCodes: Array.isArray(record.reason_codes)
              ? (record.reason_codes.filter((code) => typeof code === 'string') as string[])
              : [],
          };
        })
        .filter((entry): entry is TraceFileAttribution => entry !== null)
    : [];
  return {
    ratio:
      typeof attribution.dead_weight_ratio === 'number' ? attribution.dead_weight_ratio : undefined,
    files,
  };
}

export function extractCompressionDetail(result?: TraceDemoMessageResult): {
  tokensSaved?: number;
  ratio?: number;
  summary?: string;
  band?: string;
} {
  const record = result?.results.compression?.response;
  if (!record) {
    return {};
  }
  const compression = (record.compression ?? {}) as Record<string, unknown>;
  const raw = (record.raw ?? {}) as Record<string, unknown>;
  const tokensSaved =
    typeof compression.tokens_saved === 'number'
      ? compression.tokens_saved
      : typeof raw.tokens_saved === 'number'
        ? raw.tokens_saved
        : undefined;
  const ratio =
    typeof compression.compression_ratio === 'number'
      ? compression.compression_ratio
      : typeof raw.compression_ratio === 'number'
        ? raw.compression_ratio
        : undefined;
  const summary =
    typeof compression.summary === 'string'
      ? compression.summary
      : typeof raw.summary === 'string'
        ? raw.summary
        : typeof compression.compressed_text === 'string'
          ? compression.compressed_text
          : typeof raw.compressed_text === 'string'
            ? raw.compressed_text
            : undefined;
  return { tokensSaved, ratio, summary, band: record.risk_band };
}

export function extractPrivacyDetail(result?: TraceDemoMessageResult): {
  entityCount?: number;
  byLabel: Array<{ label: string; count: number }>;
  redacted?: string;
  band?: string;
} {
  const record = result?.results.privacy?.response;
  if (!record) {
    return { byLabel: [] };
  }
  const privacy = (record.privacy ?? {}) as Record<string, unknown>;
  const entityCount = typeof privacy.entity_count === 'number' ? privacy.entity_count : undefined;
  const byLabel: Array<{ label: string; count: number }> = [];
  const labelMap = (privacy.entities_by_label ?? privacy.by_label) as
    | Record<string, unknown>
    | undefined;
  if (labelMap && typeof labelMap === 'object') {
    for (const [label, count] of Object.entries(labelMap)) {
      if (typeof count === 'number') {
        byLabel.push({ label, count });
      }
    }
  } else if (Array.isArray(privacy.entities)) {
    const counter = new Map<string, number>();
    for (const entity of privacy.entities) {
      if (!entity || typeof entity !== 'object') {
        continue;
      }
      const label = (entity as Record<string, unknown>).label;
      if (typeof label === 'string') {
        counter.set(label, (counter.get(label) ?? 0) + 1);
      }
    }
    for (const [label, count] of counter) {
      byLabel.push({ label, count });
    }
  }
  const redacted =
    typeof privacy.redacted_text === 'string'
      ? privacy.redacted_text
      : typeof privacy.redacted === 'string'
        ? privacy.redacted
        : undefined;
  return { entityCount, byLabel, redacted, band: record.risk_band };
}

export function extractMemoryDetail(result?: TraceDemoMessageResult): {
  actionCount?: number;
  hotContext?: string;
  band?: string;
} {
  const record = result?.results.memory?.response;
  if (!record) {
    return {};
  }
  const memory = (record.memory ?? {}) as Record<string, unknown>;
  const actions = memory.actions;
  const actionCount = Array.isArray(actions) ? actions.length : undefined;
  const hot =
    typeof memory.hot_context === 'string'
      ? memory.hot_context
      : typeof memory.summary === 'string'
        ? memory.summary
        : undefined;
  return { actionCount, hotContext: hot, band: record.risk_band };
}

export function extractDriftBand(result?: TraceDemoMessageResult): {
  band?: string;
  score?: number;
  source?: 'drift' | 'rollup' | 'groundedness';
} {
  const candidates: Array<{
    key: 'drift' | 'rollup' | 'groundedness';
    record?: TraceBridgeResponse;
  }> = [
    { key: 'drift', record: result?.results.drift?.response },
    { key: 'rollup', record: result?.results['rollup' as TraceFeatureKey]?.response },
    { key: 'groundedness', record: getGroundingResponse(result) },
  ];
  for (const candidate of candidates) {
    if (!candidate.record) {
      continue;
    }
    const record = candidate.record;
    const decision = (record.runtime_decision ?? {}) as Record<string, unknown>;
    const band =
      typeof decision.band === 'string'
        ? decision.band
        : typeof record.risk_band === 'string'
          ? record.risk_band
          : undefined;
    if (!band || band === 'unknown') {
      continue;
    }
    const score =
      typeof decision.score === 'number'
        ? decision.score
        : typeof record.trace_score === 'number'
          ? record.trace_score
          : undefined;
    return { band, score, source: candidate.key };
  }
  return {};
}

function normalizeBand(value: unknown): TraceHeatBand {
  if (value === 'green' || value === 'amber' || value === 'yellow' || value === 'red') {
    return value === 'yellow' ? 'amber' : value;
  }
  return 'unknown';
}

export function getRiskForResult(result: TraceDemoMessageResult | undefined): {
  risk: string;
  score?: number | null;
} {
  if (!result) {
    return { risk: 'unknown' };
  }
  const grounding = result.results.groundedness?.response;
  if (grounding) {
    return { risk: grounding.risk_band || 'unknown', score: grounding.trace_score };
  }
  const first = Object.values(result.results).find(
    (record): record is TraceCallRecord => !!record?.response,
  );
  if (first?.response) {
    return { risk: first.response.risk_band || 'unknown', score: first.response.trace_score };
  }
  return { risk: 'unknown' };
}

function getDemoContext(useCase: TraceDemoUseCase): string | string[] {
  if (useCase === 'coding-agent') {
    return [
      'Repository rule: validate all external input before writing to disk or calling shell commands.',
      'Task file: implement a helper that stores uploaded reports and rejects unsafe paths.',
      'Security note: user-controlled filenames must be normalized and checked against the workspace root.',
    ];
  }
  return [
    'Refund policy: opened devices may be returned within 30 days only if defective.',
    'Refund policy: refunds after 30 days require manager approval and are not guaranteed.',
    'Shipping FAQ: accessories ship separately and tracking can lag by one day.',
  ];
}

function contextAsText(context: string | string[]) {
  return Array.isArray(context) ? context.join('\n\n') : context;
}

function parseSpanList(value: unknown): TraceSpan[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { text: item, label: 'Unsupported span' };
      }
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const text = firstString(
        record.text,
        record.span,
        record.claim,
        record.quote,
        record.content,
      );
      if (!text) {
        return null;
      }
      const supported = record.supported ?? record.is_supported ?? record.grounded;
      if (supported === true) {
        return null;
      }
      return {
        text,
        label: firstString(record.label, record.reason, record.status) || 'Needs support',
        confidence: firstNumber(record.confidence, record.score),
      };
    })
    .filter(Boolean) as TraceSpan[];
}

function firstString(...values: unknown[]) {
  const value = values.find((item): item is string => typeof item === 'string' && item.length > 0);
  return value ?? '';
}

function firstNumber(...values: unknown[]) {
  const value = values.find((item): item is number => typeof item === 'number');
  return value;
}

function isTraceUseCase(value: unknown): value is TraceDemoUseCase {
  return value === 'rag' || value === 'coding-agent';
}

function isTraceIntegration(value: unknown): value is TraceDemoIntegration {
  return (
    value === 'sdk-librechat' ||
    value === 'langchain-rag' ||
    value === 'langgraph-code' ||
    value === 'n8n'
  );
}
