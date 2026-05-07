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
  user_input?: string;
  assistant_response?: string;
  question?: string;
  context?: string | string[];
  answer?: string;
  text?: string;
  turns?: Array<Record<string, unknown>>;
  prior_memory_state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type TraceParseInfo = {
  mode: 'markers' | 'head' | 'tail' | 'none' | 'preparsed';
  query?: string | null;
  context_char_count: number;
  context_chunk_count: number;
  marker_present: boolean;
  // Bridge-side language detection. The runtime is the source of truth
  // for the *effective* language used during scoring (see
  // ``runtime_decision.profile_diagnostics.language``); this field is the
  // bridge's view, set even when the runtime is unreachable so the
  // calibration chip is never blank.
  language?: 'de' | 'en' | null;
  language_source?: 'request' | 'auto' | 'fallback_en' | null;
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
  parse?: TraceParseInfo | null;
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

export type TraceHeatBand = 'green' | 'amber' | 'red' | 'skipped' | 'unknown';

export type TraceEvidenceItem = {
  supportId?: string;
  text?: string;
  coverage?: number;
  usageState?: string;
  usageConfidence?: number;
  trustState?: string;
  trustScore?: number;
  trustLabels?: string[];
  matchedTokens?: number;
  totalTokens?: number;
  metadataPath?: string;
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
export const TRACE_DEMO_URL = 'https://trace.latence.ai/trace-demo';

const TRACE_DEMO_MODELS: Record<TraceDemoUseCase, string> = {
  rag: 'nvidia/nemotron-3-nano-30b-a3b:free',
  'coding-agent': 'minimax/minimax-m2.5:free',
};

export function getTraceDemoModel(useCase: TraceDemoUseCase): string {
  return TRACE_DEMO_MODELS[useCase];
}

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
  'memory',
  'privacy',
  'compression',
];

const CODING_FEATURES: TraceFeatureKey[] = [
  'groundedness',
  'context-util',
  'drift',
  'memory',
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
      return {
        active: true,
        useCase: parsed.useCase,
        integration: parsed.integration,
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      };
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
  // ``OpenRouter`` is a user-defined custom endpoint declared in
  // ``librechat.yaml`` -> ``endpoints.custom``. The data-provider parser
  // (``packages/data-provider/src/parsers.ts``) requires either a known
  // built-in schema name for ``endpoint`` *or* an explicit ``endpointType``
  // so it can fall back to the ``custom`` schema; without ``endpointType``
  // a fresh chat with no cached preset throws ``Unknown endpoint: OpenRouter``
  // and the Ask call aborts before reaching the backend. Mirror what the
  // ``trace-rag-demo`` / ``trace-coding-demo`` modelSpecs already declare in
  // their preset so the URL handoff resolves identically with or without
  // server-side preset hydration.
  return new URLSearchParams({
    trace_demo: '1',
    trace_use_case: selection.useCase,
    trace_integration: selection.integration,
    spec: selection.useCase === 'coding-agent' ? 'trace-coding-demo' : 'trace-rag-demo',
    endpoint: 'OpenRouter',
    endpointType: 'custom',
    model: getTraceDemoModel(selection.useCase),
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
  const scenario = `trace_${selection.useCase}_${feature}_${selection.integration}`.replace(
    /-/g,
    '_',
  );
  const metadata: Record<string, unknown> = {
    use_case: selection.useCase,
    feature,
    integration: selection.integration,
    source: 'librechat_trace_demo',
  };

  // The chat message is the verbatim user input; the bridge's parser
  // splits it into (query, context). We DO NOT pre-split on the
  // frontend, and we DO NOT inject a hardcoded refund-policy / coding
  // fallback. Empty user_input is forwarded so the bridge can record
  // mode='none'.
  const userInput = question ?? '';
  const assistantResponse = answer ?? '';

  if (kind === 'privacy') {
    return {
      scenario,
      integration,
      kind,
      user_input: userInput,
      assistant_response: assistantResponse,
      text: `${userInput}\n\n${assistantResponse}`,
      metadata,
    };
  }
  if (kind === 'memory') {
    return {
      scenario,
      integration,
      kind,
      user_input: userInput,
      assistant_response: assistantResponse,
      text: assistantResponse,
      prior_memory_state: priorMemoryState,
      metadata,
    };
  }
  if (kind === 'compression') {
    return {
      scenario,
      integration,
      kind,
      user_input: userInput,
      assistant_response: assistantResponse,
      text: `${userInput}\n\n${assistantResponse}`,
      metadata,
    };
  }
  if (kind === 'rollup') {
    return {
      scenario,
      integration,
      kind,
      user_input: userInput,
      assistant_response: assistantResponse,
      turns,
      metadata,
    };
  }
  return {
    scenario,
    integration,
    kind,
    user_input: userInput,
    assistant_response: assistantResponse,
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
  const rawScores = (response.raw as { scores?: Record<string, unknown> } | undefined)?.scores;
  for (const key of keys) {
    const value =
      response.raw?.[key] ??
      rawScores?.[key] ??
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
  // Dedupe by support_id and merge fields across the three sources, since
  // `raw.support_units` carries usage/coverage signal but no text, while
  // `runtime_decision.evidence` carries the actual chunk text. Keying purely
  // on support_id (and falling back to text) avoids the duplicate "raw-0
  // empty + raw-0 with text" rendering bug.
  const merged = new Map<string, TraceEvidenceItem>();
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
    const coverage =
      typeof record.coverage_score === 'number'
        ? record.coverage_score
        : typeof record.coverage === 'number'
          ? record.coverage
          : undefined;
    const usageState = typeof record.usage_state === 'string' ? record.usage_state : undefined;
    const usageConfidence = typeof record.usage_confidence === 'number' ? record.usage_confidence : undefined;
    const trustState =
      typeof record.context_trust_state === 'string' ? record.context_trust_state : undefined;
    const trustScore = typeof record.context_trust_score === 'number' ? record.context_trust_score : undefined;
    const trustLabels = Array.isArray(record.context_trust_labels)
      ? record.context_trust_labels.filter((l): l is string => typeof l === 'string')
      : undefined;
    const matchedTokens = typeof record.matched_response_tokens === 'number' ? record.matched_response_tokens : undefined;
    const totalTokens = typeof record.token_count === 'number' ? record.token_count : undefined;
    const meta = (record.metadata ?? {}) as Record<string, unknown>;
    const metadataPath = typeof meta.path === 'string' ? meta.path : undefined;
    const key = supportId ?? `__txt:${(text ?? '').slice(0, 40)}` ?? `__pos:${merged.size}`;
    const prev = merged.get(key);
    merged.set(key, {
      supportId: supportId ?? prev?.supportId,
      text: text ?? prev?.text,
      coverage: coverage ?? prev?.coverage,
      usageState: usageState ?? prev?.usageState,
      usageConfidence: usageConfidence ?? prev?.usageConfidence,
      trustState: trustState ?? prev?.trustState,
      trustScore: trustScore ?? prev?.trustScore,
      trustLabels: trustLabels ?? prev?.trustLabels,
      matchedTokens: matchedTokens ?? prev?.matchedTokens,
      totalTokens: totalTokens ?? prev?.totalTokens,
      metadataPath: metadataPath ?? prev?.metadataPath,
    });
  }
  const list = Array.from(merged.values());
  // Strongest first by coverage so per-span popovers can pick the top chunk.
  list.sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));
  return list;
}

/**
 * One claim span as parsed from `nli_diagnostics.claims[]` (TRACE quality
 * lane). char_start/char_end refer into the assistant response text. Atoms
 * are present when atomic decomposition fired (German requires de_core_news_sm).
 */
export type TraceClaimAtom = {
  atomIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
  entailment: number;
  neutral: number;
  contradiction: number;
  score: number;
  skipped?: boolean;
  supportIds: string[];
  supportUnitIndices: number[];
};

export type TraceClaimSpan = {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  entailment: number;
  neutral: number;
  contradiction: number;
  score: number;
  // ``skipped`` is its own band so the renderer never paints a
  // not-yet-scored sentence (entailment defaults to 0) the same red as
  // a genuinely contradicted one. ``skipped`` claims are styled with a
  // neutral grey underline in ``Markdown.tsx``.
  band: TraceHeatBand;
  skipped: boolean;
  skipReason?: string;
  premiseCount: number;
  supportIds: string[];
  supportUnitIndices: number[];
  atoms: TraceClaimAtom[];
};

const NLI_CLAIM_GREEN_MIN = 0.30;
const NLI_CLAIM_AMBER_MIN = 0.05;
const NLI_CONTRADICTION_FLOOR = 0.50;

/**
 * Compute a claim-level band from NLI scores. Uses the backend's
 * ``claim.band`` when already stamped (single source of truth); falls
 * back to a client-side replica of the same ``_claim_band`` logic from
 * ``groundedness.py`` so older runtimes still get correct rendering.
 */
function bandForClaim(
  claim: {
    score: number;
    entailment: number;
    contradiction: number;
    skipped?: boolean;
    band?: string;
  },
): 'green' | 'amber' | 'red' | 'skipped' {
  if (claim.band === 'green' || claim.band === 'amber' || claim.band === 'red' || claim.band === 'skipped') {
    return claim.band;
  }
  if (claim.skipped) {
    return 'skipped';
  }
  if (claim.contradiction >= NLI_CONTRADICTION_FLOOR) {
    return 'red';
  }
  if (claim.score >= NLI_CLAIM_GREEN_MIN) {
    return 'green';
  }
  if (claim.score >= NLI_CLAIM_AMBER_MIN) {
    return 'amber';
  }
  return 'red';
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asAtom(record: Record<string, unknown>): TraceClaimAtom | null {
  const text = typeof record.text === 'string' ? record.text : null;
  if (text === null) {
    return null;
  }
  const supportIds = Array.isArray(record.support_ids)
    ? record.support_ids.filter((id): id is string => typeof id === 'string')
    : [];
  const supportUnitIndices = Array.isArray(record.support_unit_indices)
    ? record.support_unit_indices.filter((i): i is number => typeof i === 'number')
    : [];
  return {
    atomIndex: num(record.atom_index) ?? 0,
    text,
    charStart: num(record.char_start) ?? 0,
    charEnd: num(record.char_end) ?? 0,
    entailment: num(record.entailment) ?? 0,
    neutral: num(record.neutral) ?? 0,
    contradiction: num(record.contradiction) ?? 0,
    score: num(record.score) ?? 0,
    skipped: typeof record.skipped === 'boolean' ? record.skipped : undefined,
    supportIds,
    supportUnitIndices,
  };
}

export function extractClaimSpans(result?: TraceDemoMessageResult): TraceClaimSpan[] {
  const response = getGroundingResponse(result);
  const raw = response?.raw as
    | {
        nli_diagnostics?: { claims?: unknown };
        heatmap?: { thresholds?: Record<string, unknown> };
      }
    | undefined;
  const claims = raw?.nli_diagnostics?.claims;
  if (!Array.isArray(claims)) {
    return [];
  }
  const out: TraceClaimSpan[] = [];
  for (const claim of claims) {
    if (!claim || typeof claim !== 'object') {
      continue;
    }
    const record = claim as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text : '';
    if (!text) {
      continue;
    }
    const entailment = num(record.entailment) ?? 0;
    const contradiction = num(record.contradiction) ?? 0;
    const score = num(record.score) ?? 0;
    const supportIds = Array.isArray(record.support_ids)
      ? record.support_ids.filter((id): id is string => typeof id === 'string')
      : [];
    const supportUnitIndices = Array.isArray(record.support_unit_indices)
      ? record.support_unit_indices.filter((i): i is number => typeof i === 'number')
      : [];
    const atoms = Array.isArray(record.atoms)
      ? (record.atoms
          .map((entry) =>
            entry && typeof entry === 'object' ? asAtom(entry as Record<string, unknown>) : null,
          )
          .filter((a): a is TraceClaimAtom => a !== null) as TraceClaimAtom[])
      : [];
    const isSkipped = typeof record.skipped === 'boolean' ? record.skipped : false;
    const skipReason =
      typeof record.skip_reason === 'string' ? record.skip_reason : undefined;
    const backendBand = typeof record.band === 'string' ? record.band : undefined;
    const band: TraceClaimSpan['band'] = bandForClaim({
      score,
      entailment,
      contradiction,
      skipped: isSkipped,
      band: backendBand,
    });
    out.push({
      index: num(record.index) ?? out.length,
      text,
      charStart: num(record.char_start) ?? 0,
      charEnd: num(record.char_end) ?? text.length,
      entailment,
      neutral: num(record.neutral) ?? 0,
      contradiction: num(record.contradiction) ?? 0,
      score: num(record.score) ?? 0,
      band,
      skipped: isSkipped,
      skipReason,
      premiseCount: num(record.premise_count) ?? 0,
      supportIds,
      supportUnitIndices,
      atoms,
    });
  }
  out.sort((a, b) => a.charStart - b.charStart);
  return out;
}

/**
 * Pick the single best supporting evidence chunk for a claim. Walks
 * `claim.support_unit_indices` into `support_units[]` and returns the
 * chunk with the highest coverage_score that actually carries text. If no
 * indexed unit has text we fall back to the first text-bearing chunk
 * across all evidence sources.
 */
export function extractClaimEvidence(
  result: TraceDemoMessageResult | undefined,
  claim: TraceClaimSpan,
): TraceEvidenceItem | undefined {
  const all = extractGroundingEvidence(result);
  if (all.length === 0) {
    return undefined;
  }
  const indexed: TraceEvidenceItem[] = [];
  for (const i of claim.supportUnitIndices) {
    const item = all[i];
    if (item && (item.text ?? '').trim().length > 0) {
      indexed.push(item);
    }
  }
  if (indexed.length > 0) {
    indexed.sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));
    return indexed[0];
  }
  for (const id of claim.supportIds) {
    const match = all.find((item) => item.supportId === id && (item.text ?? '').trim().length > 0);
    if (match) {
      return match;
    }
  }
  return all.find((item) => (item.text ?? '').trim().length > 0);
}

export type TraceHeatmapSummary = {
  headlineScore?: number;
  groundednessPct?: number;
  deadWeightPct?: number;
  riskBand?: string;
  claimsTotal?: number;
  claimsSupported?: number;
  // Coverage observability surfaced from ``nli_diagnostics``. When the
  // runtime ran NLI on every sentence in the response (the production
  // default), ``claimsScored == claimsTotal``. When the per-request
  // latency budget triggered, ``claimsSkippedForBudget`` reports how
  // many sentences were deferred; the demo renders an explicit
  // "X of Y sentences fully scored" chip instead of silently
  // colouring the unscored tail red.
  claimsScored?: number;
  claimsSkippedForBudget?: number;
  claimsSkippedForNoPremises?: number;
  parseMode?: TraceParseInfo['mode'];
  parseQuery?: string;
  // Bridge-resolved language (chip on the heatmap header).
  bridgeLanguage?: 'de' | 'en';
  // Runtime-effective language read out of
  // ``runtime_decision.profile_diagnostics.language`` and
  // ``language_source``. May differ from ``bridgeLanguage`` when the
  // request explicitly forced a language.
  effectiveLanguage?: 'de' | 'en';
  effectiveLanguageSource?: 'request' | 'auto' | 'fallback_en';
  // Whether the loaded calibration bundle is language-matched. Until
  // Phase C ships German bundles, this is "uncalibrated" for de
  // requests so the user knows the bundle is the English fallback.
  bundleLanguage?: 'de' | 'en';
  bundleCalibrated?: boolean;
  // Raw fused channel scores, surfaced under the headline so the user
  // can see the per-channel breakdown (reverse_context / literal_guarded
  // / nli_aggregate). Numbers between 0 and 1; ``undefined`` when the
  // scores block did not include the channel.
  reverseContext?: number;
  literalGuarded?: number;
  nliAggregate?: number;
  thresholds?: {
    tokenGreenMin?: number;
    tokenAmberMin?: number;
    fileGreenMin?: number;
    fileAmberMin?: number;
  };
};

export function extractHeatmapSummary(result?: TraceDemoMessageResult): TraceHeatmapSummary {
  const response = getGroundingResponse(result);
  const raw = (response?.raw ?? {}) as Record<string, unknown>;
  const heatmap = (raw as { heatmap?: Record<string, unknown> }).heatmap;
  const summary =
    heatmap && typeof heatmap === 'object'
      ? ((heatmap as { summary?: Record<string, unknown> }).summary ?? {})
      : {};
  const thresholds =
    heatmap && typeof heatmap === 'object'
      ? ((heatmap as { thresholds?: Record<string, unknown> }).thresholds ?? {})
      : {};
  const claims = extractClaimSpans(result);
  const claimsSupported = claims.filter((c) => c.band === 'green').length;

  // Per-channel scores live under raw.scores. We surface them next to the
  // headline so the user can see the *why* (e.g. high reverse_context but
  // low nli_aggregate signals dilution).
  const scores = (raw as { scores?: Record<string, unknown> }).scores ?? {};
  const reverseContext = num(scores.reverse_context_calibrated) ?? num(scores.reverse_context);
  const literalGuarded = num(scores.literal_guarded);
  const nliAggregate = num(scores.nli_aggregate);

  // Language: prefer the runtime's effective language (set by the
  // service.py per-request language resolver) so the chip reflects what
  // *actually* drove the calibration / NLI defaults. Fall back to the
  // bridge's bridge-side detection when the runtime is older / not yet
  // returning the field.
  //
  // ``profile_diagnostics`` is a TOP-LEVEL field on
  // ``GroundednessResponse`` — pre-fix the frontend looked for it at
  // ``raw.runtime_decision.profile_diagnostics`` (it never lived there)
  // which is why the demo always rendered "DE (UNCALIBRATED)" even
  // when the German bundle had been correctly loaded by the corpus
  // router. The new path matches the canonical TRACE schema; the
  // legacy nested location is kept as a tertiary fallback for any
  // proxy/integration that re-shapes the response.
  const profileDiag = (
    (raw.profile_diagnostics as Record<string, unknown> | undefined) ??
    ((raw as { runtime_decision?: { profile_diagnostics?: Record<string, unknown> } })
      .runtime_decision?.profile_diagnostics) ??
    {}
  ) as Record<string, unknown>;
  // ``corpus_route`` is the canonical place the latence-trace router
  // stamps the resolved language tuple onto the response. Reading it
  // here means we render the right chip even when ``profile_diagnostics``
  // is absent (older runtimes, integration-only payloads, etc.).
  const corpusRoute = (raw.corpus_route as Record<string, unknown> | undefined) ?? {};

  const effectiveLanguageRaw = profileDiag.language ?? corpusRoute.language;
  const effectiveLanguage =
    effectiveLanguageRaw === 'de' || effectiveLanguageRaw === 'en'
      ? (effectiveLanguageRaw as 'de' | 'en')
      : undefined;
  const effectiveLanguageSourceRaw =
    profileDiag.language_source ?? corpusRoute.language_source;
  const effectiveLanguageSource =
    effectiveLanguageSourceRaw === 'request' ||
    effectiveLanguageSourceRaw === 'auto' ||
    effectiveLanguageSourceRaw === 'fallback_en'
      ? (effectiveLanguageSourceRaw as 'request' | 'auto' | 'fallback_en')
      : undefined;
  const bridgeLanguageRaw = response?.parse?.language;
  const bridgeLanguage =
    bridgeLanguageRaw === 'de' || bridgeLanguageRaw === 'en'
      ? (bridgeLanguageRaw as 'de' | 'en')
      : undefined;

  // Bundle calibration: read ``bundle_language`` from
  // ``profile_diagnostics`` first, then from the typed
  // ``corpus_route.bundle_language`` field that ships in
  // latence-trace >= 0.5.x. Either signal is enough to confirm that
  // the German artefact (or any per-language artefact) was used.
  const bundleHintRaw =
    typeof profileDiag.bundle_language === 'string'
      ? (profileDiag.bundle_language as string)
      : typeof corpusRoute.bundle_language === 'string'
        ? (corpusRoute.bundle_language as string)
        : undefined;
  const bundleLanguage =
    bundleHintRaw === 'de' || bundleHintRaw === 'en'
      ? (bundleHintRaw as 'de' | 'en')
      : undefined;
  // The chip says "calibrated" only when the language we display matches
  // the bundle language the runtime actually loaded. A German request
  // with the English fallback bundle is "uncalibrated".
  const displayLanguage = effectiveLanguage ?? bridgeLanguage;
  const bundleCalibrated =
    displayLanguage === undefined
      ? undefined
      : bundleLanguage !== undefined
        ? bundleLanguage === displayLanguage
        : displayLanguage === 'en';

  // Coverage diagnostics from the runtime's nli_diagnostics block. We
  // prefer the runtime-reported total (``claims_total``) over the
  // claims-array length so a budget-skipped tail is still counted as
  // "we know there were N sentences, scored M" rather than silently
  // collapsing into the array length.
  const nliDiag = (raw as { nli_diagnostics?: Record<string, unknown> }).nli_diagnostics ?? {};
  const claimsTotalRaw = num(nliDiag.claims_total) ?? (claims.length || undefined);
  const claimsScoredRaw = num(nliDiag.claims_scored);
  const claimsSkippedForBudgetRaw = num(nliDiag.claims_skipped_for_budget);
  const claimsSkippedForNoPremisesRaw = num(nliDiag.claims_skipped_for_no_premises);

  return {
    headlineScore: num(summary.headline_score) ?? num(summary.groundedness_pct),
    groundednessPct: num(summary.groundedness_pct),
    deadWeightPct: num(summary.dead_weight_pct),
    riskBand: typeof summary.risk_band === 'string' ? summary.risk_band : undefined,
    claimsTotal: claimsTotalRaw,
    claimsSupported: claims.length ? claimsSupported : undefined,
    claimsScored: claimsScoredRaw,
    claimsSkippedForBudget: claimsSkippedForBudgetRaw,
    claimsSkippedForNoPremises: claimsSkippedForNoPremisesRaw,
    parseMode: response?.parse?.mode,
    parseQuery: response?.parse?.query ?? undefined,
    bridgeLanguage,
    effectiveLanguage,
    effectiveLanguageSource,
    bundleLanguage,
    bundleCalibrated,
    reverseContext,
    literalGuarded,
    nliAggregate,
    thresholds: {
      tokenGreenMin: num(thresholds.token_green_min),
      tokenAmberMin: num(thresholds.token_amber_min),
      fileGreenMin: num(thresholds.file_green_min),
      fileAmberMin: num(thresholds.file_amber_min),
    },
  };
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
  // Band: prefer the calibration `risk_band` (the per-class bundle's
  // verdict on the fused groundedness signal — same field the event
  // log row reads). The runtime `decision.band` is now coerced to
  // match calibration on the backend, but we still read calibration
  // first so that any future SDK consumer that exposes only one of
  // the two fields renders a band consistent with the event log,
  // heatmap header, and SDK-direct `risk_band` callers. Falling back
  // to `decision.band` only when calibration is absent keeps the
  // pre-coercion fallback path covered.
  const calibrationBand =
    typeof response.risk_band === 'string' && response.risk_band.length > 0
      ? response.risk_band
      : undefined;
  // Score: prefer `trace_score` (the user-visible calibration score
  // that the event log Score column already shows). The runtime
  // `decision.score` is the head's intermediate score (e.g. the
  // claim_decomposer's atomized verdict in [0, 1]) and using it as
  // the display score gives buyers a number that doesn't match the
  // band — mid-range head scores happily coexist with red bands.
  return {
    action: typeof decision.action === 'string' ? decision.action : undefined,
    band:
      calibrationBand ??
      (typeof decision.band === 'string' ? decision.band : undefined),
    score:
      typeof response.trace_score === 'number'
        ? response.trace_score
        : typeof decision.score === 'number'
          ? decision.score
          : undefined,
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
    ? (attribution.per_file
        .map((entry): TraceFileAttribution | null => {
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
        .filter((entry): entry is TraceFileAttribution => entry !== null) as TraceFileAttribution[])
    : [];
  return {
    ratio:
      typeof attribution.dead_weight_ratio === 'number' ? attribution.dead_weight_ratio : undefined,
    files,
  };
}

export type TracePromptGuardSummary = {
  enabled: boolean;
  provider?: string;
  trustedCount: number;
  suspiciousCount: number;
  blockedCount: number;
  score: number;
  labels: string[];
};

export function extractPromptGuardSummary(result?: TraceDemoMessageResult): TracePromptGuardSummary | undefined {
  const response = getGroundingResponse(result);
  if (!response) return undefined;
  const raw = (response.raw ?? {}) as Record<string, unknown>;
  const diag = raw.context_trust_diagnostics as Record<string, unknown> | undefined;
  if (!diag) return undefined;
  return {
    enabled: diag.enabled === true,
    provider: typeof diag.provider === 'string' ? diag.provider : undefined,
    trustedCount: typeof diag.trusted_count === 'number' ? diag.trusted_count : 0,
    suspiciousCount: typeof diag.suspicious_count === 'number' ? diag.suspicious_count : 0,
    blockedCount: typeof diag.blocked_count === 'number' ? diag.blocked_count : 0,
    score: typeof diag.score === 'number' ? diag.score : 0,
    labels: Array.isArray(diag.labels) ? diag.labels.filter((l): l is string => typeof l === 'string') : [],
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

export type TracePrivacyEntity = {
  label: string;
  text: string;
  score: number;
  start?: number;
  end?: number;
  redactedValue?: string;
};

export function extractPrivacyDetail(result?: TraceDemoMessageResult): {
  entityCount?: number;
  byLabel: Array<{ label: string; count: number }>;
  entities: TracePrivacyEntity[];
  redacted?: string;
  band?: string;
} {
  const record = result?.results.privacy?.response;
  if (!record) {
    return { byLabel: [], entities: [] };
  }
  const privacy = (record.privacy ?? {}) as Record<string, unknown>;
  const raw = (record.raw ?? {}) as Record<string, unknown>;
  const entityCount = typeof privacy.entity_count === 'number' ? privacy.entity_count : undefined;
  const byLabel: Array<{ label: string; count: number }> = [];
  const entities: TracePrivacyEntity[] = [];

  const rawEntities = (Array.isArray(raw.entities) ? raw.entities : Array.isArray(privacy.entities) ? privacy.entities : []) as Array<Record<string, unknown>>;
  for (const entity of rawEntities) {
    if (!entity || typeof entity !== 'object') {
      continue;
    }
    const label = typeof entity.label === 'string' ? entity.label : '';
    const text = typeof entity.text === 'string' ? entity.text : '';
    const score = typeof entity.score === 'number' ? entity.score : 0;
    if (label && text) {
      entities.push({
        label,
        text,
        score,
        start: typeof entity.start === 'number' ? entity.start : undefined,
        end: typeof entity.end === 'number' ? entity.end : undefined,
        redactedValue: typeof entity.redacted_value === 'string' ? entity.redacted_value : undefined,
      });
    }
  }

  if (entities.length > 0) {
    const counter = new Map<string, number>();
    for (const e of entities) {
      counter.set(e.label, (counter.get(e.label) ?? 0) + 1);
    }
    for (const [label, count] of counter) {
      byLabel.push({ label, count });
    }
  } else {
    const labelMap = (privacy.entities_by_label ?? privacy.by_label) as
      | Record<string, unknown>
      | undefined;
    if (labelMap && typeof labelMap === 'object') {
      for (const [label, count] of Object.entries(labelMap)) {
        if (typeof count === 'number') {
          byLabel.push({ label, count });
        }
      }
    }
  }

  const redacted =
    typeof privacy.redacted_text === 'string'
      ? privacy.redacted_text
      : typeof privacy.redacted === 'string'
        ? privacy.redacted
        : typeof raw.redacted_text === 'string'
          ? raw.redacted_text
          : undefined;
  return { entityCount, byLabel, entities, redacted, band: record.risk_band };
}

export type TraceMemorySpan = {
  text: string;
  spanType: string;
  layer: string;
  relevance?: number;
  salience?: number;
  survivalValue?: number;
  attribution?: number;
  redundancy?: number;
  rareTerms: string[];
  source?: string;
  tokenCount?: number;
};

export function extractMemoryDetail(result?: TraceDemoMessageResult): {
  actionCount?: number;
  hotContext?: string;
  band?: string;
  spans: TraceMemorySpan[];
  hotCount: number;
  coldCount: number;
} {
  const record = result?.results.memory?.response;
  if (!record) {
    return { spans: [], hotCount: 0, coldCount: 0 };
  }
  const memory = (record.memory ?? {}) as Record<string, unknown>;
  const raw = (record.raw ?? {}) as Record<string, unknown>;
  const actions = memory.actions;
  const actionCount = Array.isArray(actions) ? actions.length : undefined;
  const hot =
    typeof memory.hot_context === 'string'
      ? memory.hot_context
      : typeof memory.summary === 'string'
        ? memory.summary
        : undefined;

  const spans: TraceMemorySpan[] = [];
  const nextState = (memory.next_memory_state ?? raw.next_memory_state) as Record<string, unknown> | undefined;
  const rawSpans = nextState?.spans;
  if (Array.isArray(rawSpans)) {
    for (const s of rawSpans) {
      if (!s || typeof s !== 'object') continue;
      const rec = s as Record<string, unknown>;
      const text = typeof rec.text === 'string' ? rec.text : '';
      if (!text) continue;
      const scores = (rec.scores ?? {}) as Record<string, unknown>;
      const sig = (rec.signature ?? {}) as Record<string, unknown>;
      spans.push({
        text,
        spanType: typeof rec.span_type === 'string' ? rec.span_type : 'unknown',
        layer: typeof rec.layer === 'string' ? rec.layer : 'unknown',
        relevance: typeof scores.relevance === 'number' ? scores.relevance : undefined,
        salience: typeof scores.salience === 'number' ? scores.salience : undefined,
        survivalValue: typeof scores.survival_value === 'number' ? scores.survival_value : undefined,
        attribution: typeof scores.attribution === 'number' ? scores.attribution : undefined,
        redundancy: typeof scores.redundancy === 'number' ? scores.redundancy : undefined,
        rareTerms: Array.isArray(sig.rare_terms) ? sig.rare_terms.filter((t): t is string => typeof t === 'string') : [],
        source: typeof rec.source === 'string' ? rec.source : undefined,
        tokenCount: typeof rec.token_count === 'number' ? rec.token_count : undefined,
      });
    }
  }

  const hotCount = spans.filter((s) => s.layer === 'hot').length;
  const coldCount = spans.filter((s) => s.layer === 'cold').length;

  return { actionCount, hotContext: hot, band: record.risk_band, spans, hotCount, coldCount };
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
    // Calibration band first, runtime decision band as fallback —
    // matches ``extractDecision`` and the backend coercion contract
    // (``runtime_decision.band`` is forced to match ``risk_band`` when
    // calibration is red, but for older callers without coercion the
    // calibration band is the canonical user-visible verdict).
    const band =
      typeof record.risk_band === 'string' && record.risk_band.length > 0
        ? record.risk_band
        : typeof decision.band === 'string'
          ? decision.band
          : undefined;
    if (!band || band === 'unknown') {
      continue;
    }
    // Calibration score first, head-channel ``runtime_decision.score``
    // only as a last resort. Otherwise the drift card shows numbers
    // that disagree with the live overlay's calibration trace_score.
    const score =
      typeof record.trace_score === 'number'
        ? record.trace_score
        : typeof decision.score === 'number'
          ? decision.score
          : undefined;
    return { band, score, source: candidate.key };
  }
  return {};
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
