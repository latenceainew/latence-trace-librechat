import React, { memo, useMemo, useState } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import supersub from 'remark-supersub';
import rehypeKatex from 'rehype-katex';
import { useRecoilValue } from 'recoil';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkDirective from 'remark-directive';
import type { Pluggable } from 'unified';
import { Citation, CompositeCitation, HighlightedText } from '~/components/Web/Citation';
import {
  mcpUIResourcePlugin,
  MCPUIResource,
  MCPUIResourceCarousel,
} from '~/components/MCPUIResource';
import { Artifact, artifactPlugin } from '~/components/Artifacts/Artifact';
import { ArtifactProvider, CodeBlockProvider, useMessageContext } from '~/Providers';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import { latence } from '~/components/TraceDemo/brand';
import {
  extractClaimEvidence,
  extractClaimSpans,
  extractDecision,
  extractHeatmapSummary,
  getGroundingResponse,
  useTraceDemo,
  type TraceClaimSpan,
  type TraceDemoMessageResult,
  type TraceHeatBand,
} from '~/components/TraceDemo/traceDemoState';
import { langSubset, preprocessLaTeX } from '~/utils';
import { unicodeCitation } from '~/components/Web';
import { code, a, p, img } from './MarkdownComponents';
import store from '~/store';

type TContentProps = {
  content: string;
  isLatestMessage: boolean;
};

const traceCopy = {
  title: 'TRACE groundedness',
  show: 'Show TRACE heatmap',
  hide: 'Hide TRACE heatmap',
  decision: 'Decision',
  score: 'Score',
  claims: 'Claims supported',
  parseMode: 'Parse',
  calibration: 'Calibration',
  uncalibrated: 'uncalibrated',
  channelReverse: 'reverse',
  channelLiteral: 'literal',
  channelNli: 'NLI',
  noClaims:
    'TRACE quality lane returned no per-claim NLI breakdown for this answer (the runtime may have skipped decomposition).',
  hoverHint:
    'Each highlighted span is one claim TRACE extracted from the answer. Hover for entailment, contradiction and the top supporting context chunk. Connective text between claims is shown plain.',
  entailment: 'Entailment',
  contradiction: 'Contradiction',
  neutral: 'Neutral',
  atoms: 'Atomic claims',
  evidence: 'Top supporting chunk',
  noEvidence: 'TRACE returned no support unit text for this claim.',
  reason: 'Reason codes',
};

const PARSE_MODE_LABELS: Record<string, string> = {
  markers: 'markers',
  head: 'auto: first line',
  tail: 'auto: last line',
  none: 'no question',
  preparsed: 'pre-parsed',
};

const LANGUAGE_LABELS: Record<'de' | 'en', string> = {
  de: 'de',
  en: 'en',
};

function formatPercent(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  if (value >= -1 && value <= 1) {
    return `${Math.round(value * 100)}%`;
  }
  return value.toFixed(2);
}

const Markdown = memo(function Markdown({ content = '', isLatestMessage }: TContentProps) {
  const LaTeXParsing = useRecoilValue<boolean>(store.LaTeXParsing);
  const { messageId } = useMessageContext();
  const traceDemo = useTraceDemo();
  const isInitializing = content === '';

  const currentContent = useMemo(() => {
    if (isInitializing) {
      return '';
    }
    return LaTeXParsing ? preprocessLaTeX(content) : content;
  }, [content, LaTeXParsing, isInitializing]);
  const traceResult = traceDemo.active ? traceDemo.getResultForMessage(messageId) : undefined;

  const rehypePlugins = useMemo(
    () => [
      [rehypeKatex],
      [
        rehypeHighlight,
        {
          detect: true,
          ignoreMissing: true,
          subset: langSubset,
        },
      ],
    ],
    [],
  );

  const remarkPlugins: Pluggable[] = [
    supersub,
    remarkGfm,
    remarkDirective,
    artifactPlugin,
    [remarkMath, { singleDollarTextMath: false }],
    unicodeCitation,
    mcpUIResourcePlugin,
  ];

  if (isInitializing) {
    return (
      <div className="absolute">
        <p className="relative">
          <span className={isLatestMessage ? 'result-thinking' : ''} />
        </p>
      </div>
    );
  }

  return (
    <MarkdownErrorBoundary content={content} codeExecution={true}>
      <ArtifactProvider>
        <CodeBlockProvider>
          <ReactMarkdown
            /** @ts-ignore */
            remarkPlugins={remarkPlugins}
            /* @ts-ignore */
            rehypePlugins={rehypePlugins}
            components={
              {
                code,
                a,
                p,
                img,
                artifact: Artifact,
                citation: Citation,
                'highlighted-text': HighlightedText,
                'composite-citation': CompositeCitation,
                'mcp-ui-resource': MCPUIResource,
                'mcp-ui-carousel': MCPUIResourceCarousel,
              } as {
                [nodeType: string]: React.ElementType;
              }
            }
          >
            {currentContent}
          </ReactMarkdown>
          <TraceMessageInsights result={traceResult} responseText={currentContent} />
        </CodeBlockProvider>
      </ArtifactProvider>
    </MarkdownErrorBoundary>
  );
});
Markdown.displayName = 'Markdown';

const HEATMAP_BAND_STYLES: Record<
  TraceHeatBand,
  { underline: string; tooltipBorder: string; chip: string; bg: string }
> = {
  green: {
    underline: latence.green,
    tooltipBorder: latence.green,
    chip: latence.greenText,
    bg: latence.greenSoft,
  },
  amber: {
    underline: latence.amber,
    tooltipBorder: latence.amber,
    chip: latence.amber,
    bg: latence.amberSoft,
  },
  red: {
    underline: latence.rose,
    tooltipBorder: latence.rose,
    chip: latence.rose,
    bg: latence.roseSoft ?? 'rgba(244, 63, 94, 0.12)',
  },
  unknown: {
    underline: 'transparent',
    tooltipBorder: latence.border,
    chip: latence.textSubtle,
    bg: 'transparent',
  },
};

function TraceMessageInsights({
  result,
  responseText,
}: {
  result?: TraceDemoMessageResult;
  responseText: string;
}) {
  const [open, setOpen] = useState(false);
  if (!result) {
    return null;
  }
  const grounding = getGroundingResponse(result);
  const decision = extractDecision(result);
  const heatmapSummary = extractHeatmapSummary(result);
  const claims = extractClaimSpans(result);
  if (!grounding && claims.length === 0 && !decision) {
    return null;
  }
  const overallScore = decision?.score ?? grounding?.trace_score ?? undefined;
  const overallBand = decision?.band ?? grounding?.risk_band ?? 'unknown';
  const bandStyle = HEATMAP_BAND_STYLES[normalizeDecisionBand(overallBand)];
  const claimsTotal = heatmapSummary.claimsTotal ?? claims.length;
  const claimsSupported =
    heatmapSummary.claimsSupported ?? claims.filter((c) => c.band === 'green').length;
  const parseMode = heatmapSummary.parseMode;
  const parseLabel = parseMode ? PARSE_MODE_LABELS[parseMode] : undefined;
  return (
    <div
      className="mt-3 rounded-2xl border text-xs"
      style={{
        backgroundColor: latence.bgSurface,
        borderColor: latence.border,
        color: latence.text,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]"
            style={{
              backgroundColor: latence.greenSoft,
              color: bandStyle.chip,
            }}
          >
            {traceCopy.title}
          </span>
          {typeof overallScore === 'number' && (
            <span style={{ color: latence.textMuted }}>
              {traceCopy.score}{' '}
              {overallScore <= 1 ? `${Math.round(overallScore * 100)}%` : overallScore.toFixed(2)}
            </span>
          )}
          {claimsTotal > 0 && (
            <span style={{ color: latence.textMuted }}>
              {traceCopy.claims} {claimsSupported} / {claimsTotal}
            </span>
          )}
          {decision?.action && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]"
              style={{
                backgroundColor: bandStyle.chip + '20',
                color: bandStyle.chip,
                border: `1px solid ${bandStyle.tooltipBorder}`,
              }}
            >
              {traceCopy.decision}: {decision.action}
            </span>
          )}
          {parseLabel && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]"
              style={{
                backgroundColor: latence.bgRaised,
                color: latence.textSubtle,
                border: `1px solid ${latence.border}`,
              }}
              title={
                heatmapSummary.parseQuery
                  ? `Detected query: "${heatmapSummary.parseQuery}"`
                  : 'How the bridge parsed your input into query + context'
              }
            >
              {traceCopy.parseMode}: {parseLabel}
            </span>
          )}
          {(() => {
            // Calibration chip. Show ``Calibration: en`` (or ``de``) and
            // surface "uncalibrated" when the runtime is using the English
            // fallback bundle on a German request -- the user must know
            // when scoring is comparing German content against English
            // thresholds. The chip never lies: the language we display is
            // the one the runtime actually used when it returned that
            // value; we fall back to the bridge's bridge-side detection
            // only when the runtime did not yet expose the field.
            const displayLanguage =
              heatmapSummary.effectiveLanguage ?? heatmapSummary.bridgeLanguage;
            if (!displayLanguage) {
              return null;
            }
            const label = LANGUAGE_LABELS[displayLanguage];
            const calibrated = heatmapSummary.bundleCalibrated;
            const showUncalibratedHint = calibrated === false;
            const tooltipParts: string[] = [];
            if (heatmapSummary.effectiveLanguageSource) {
              tooltipParts.push(`source: ${heatmapSummary.effectiveLanguageSource}`);
            }
            if (heatmapSummary.bundleLanguage) {
              tooltipParts.push(`bundle: ${heatmapSummary.bundleLanguage}`);
            }
            if (showUncalibratedHint) {
              tooltipParts.push(
                'German bundles ship in v0.2; this request was scored against the English fallback.',
              );
            }
            return (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]"
                style={{
                  backgroundColor: showUncalibratedHint
                    ? latence.amberSoft ?? latence.bgRaised
                    : latence.bgRaised,
                  color: latence.textSubtle,
                  border: `1px solid ${latence.border}`,
                }}
                title={tooltipParts.join(' · ')}
              >
                {traceCopy.calibration}: {label}
                {showUncalibratedHint ? ` (${traceCopy.uncalibrated})` : ''}
              </span>
            );
          })()}
        </span>
        <span style={{ color: latence.textSubtle }}>{open ? traceCopy.hide : traceCopy.show}</span>
      </button>
      {(() => {
        // Per-channel score row, surfaced under the headline so the user
        // can see which fused channel drove the band. We render only when
        // at least one channel has a value so this strip never shows up
        // empty on responses that skipped NLI / literal scoring.
        const channels: Array<{ label: string; value: number | undefined }> = [
          { label: traceCopy.channelReverse, value: heatmapSummary.reverseContext },
          { label: traceCopy.channelLiteral, value: heatmapSummary.literalGuarded },
          { label: traceCopy.channelNli, value: heatmapSummary.nliAggregate },
        ];
        const populated = channels.filter((c) => formatPercent(c.value) !== undefined);
        if (populated.length === 0) {
          return null;
        }
        return (
          <div
            className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-[10px]"
            style={{
              borderColor: latence.border,
              color: latence.textMuted,
            }}
          >
            {populated.map((channel) => (
              <span
                key={channel.label}
                className="rounded-md px-1.5 py-0.5"
                style={{
                  backgroundColor: latence.bgRaised,
                  color: latence.textSubtle,
                }}
                title={`Fused channel score (0-100%); higher means more grounded.`}
              >
                {channel.label}: {formatPercent(channel.value)}
              </span>
            ))}
          </div>
        );
      })()}
      {open && (
        <div className="border-t px-3 py-3" style={{ borderColor: latence.border }}>
          <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
            {traceCopy.hoverHint}
          </p>
          <TraceClaimRenderer
            claims={claims}
            responseText={responseText}
            result={result}
            reasonCodes={decision?.reasonCodes ?? []}
          />
        </div>
      )}
    </div>
  );
}

/** Render the assistant text with each claim wrapped in a hoverable
 * highlight using char_start/char_end from `nli_diagnostics.claims[]`.
 * Connective tissue between claims renders plain so the reader can still
 * follow the answer.
 *
 * The char ranges from TRACE refer to the *plain text* response that the
 * bridge sent. We render against `responseText` (the markdown content),
 * which is normally identical for short/medium answers. Edge cases
 * (markdown formatting that shifts characters) degrade gracefully: a
 * claim whose char range falls outside the available text simply falls
 * back to its own `claim.text`. */
function TraceClaimRenderer({
  claims,
  responseText,
  result,
  reasonCodes,
}: {
  claims: TraceClaimSpan[];
  responseText: string;
  result?: TraceDemoMessageResult;
  reasonCodes: string[];
}) {
  if (claims.length === 0) {
    return (
      <p style={{ color: latence.textSubtle }} className="text-[11px]">
        {traceCopy.noClaims}
      </p>
    );
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  claims.forEach((claim, index) => {
    let displayText = '';
    if (
      claim.charStart < responseText.length &&
      claim.charEnd <= responseText.length &&
      claim.charEnd > claim.charStart
    ) {
      displayText = responseText.slice(claim.charStart, claim.charEnd);
    }
    if (!displayText.trim()) {
      displayText = claim.text;
    }
    if (claim.charStart >= cursor && claim.charStart < responseText.length) {
      const between = responseText.slice(cursor, claim.charStart);
      if (between) {
        segments.push(
          <span key={`between-${index}`} style={{ color: latence.text }}>
            {between}
          </span>,
        );
      }
    }
    segments.push(
      <ClaimSpan
        key={`claim-${claim.index}`}
        claim={claim}
        displayText={displayText}
        evidence={extractClaimEvidence(result, claim)}
        reasonCodes={reasonCodes}
      />,
    );
    cursor = Math.max(cursor, claim.charEnd);
  });
  if (cursor < responseText.length) {
    const tail = responseText.slice(cursor);
    if (tail) {
      segments.push(
        <span key="tail" style={{ color: latence.text }}>
          {tail}
        </span>,
      );
    }
  }
  return (
    <div className="trace-claim-prose whitespace-pre-wrap leading-relaxed" style={{ color: latence.text }}>
      {segments}
    </div>
  );
}

function ClaimSpan({
  claim,
  displayText,
  evidence,
  reasonCodes,
}: {
  claim: TraceClaimSpan;
  displayText: string;
  evidence: ReturnType<typeof extractClaimEvidence>;
  reasonCodes: string[];
}) {
  const style = HEATMAP_BAND_STYLES[claim.band];
  const fmt = (value: number) =>
    Math.abs(value) <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(2);
  return (
    <span
      className="trace-heatmap-token trace-claim-span"
      style={{
        backgroundColor: style.bg,
        borderBottom: `2px solid ${style.underline}`,
        borderRadius: 4,
        padding: '0 2px',
        paddingBottom: 1,
      }}
    >
      {displayText}
      <span
        className="trace-heatmap-popover"
        style={{ borderColor: style.tooltipBorder, backgroundColor: latence.bgRaised }}
      >
        <span
          className="trace-heatmap-row"
          style={{ color: latence.textSubtle, fontWeight: 600 }}
        >
          Claim {claim.index + 1}
        </span>
        <span className="trace-heatmap-row">
          <span style={{ color: style.chip, textTransform: 'capitalize' }}>{claim.band}</span>
          <span style={{ color: latence.textMuted }}>
            chars {claim.charStart}–{claim.charEnd}
          </span>
        </span>
        <NliBars
          entailment={claim.entailment}
          neutral={claim.neutral}
          contradiction={claim.contradiction}
        />
        {claim.atoms.length > 0 && (
          <span className="trace-heatmap-evidence">
            <span className="trace-heatmap-row" style={{ color: latence.textSubtle }}>
              {traceCopy.atoms} ({claim.atoms.length})
            </span>
            {claim.atoms.slice(0, 4).map((atom) => (
              <span
                key={atom.atomIndex}
                className="trace-heatmap-evidence-item"
                style={{ borderLeft: `2px solid ${style.underline}`, paddingLeft: 6 }}
              >
                <span style={{ color: latence.textMuted }}>{atom.text}</span>
                <span className="text-[10px]" style={{ color: latence.textSubtle }}>
                  ent {fmt(atom.entailment)} · con {fmt(atom.contradiction)}
                </span>
              </span>
            ))}
          </span>
        )}
        <span className="trace-heatmap-evidence">
          <span className="trace-heatmap-row" style={{ color: latence.textSubtle }}>
            {traceCopy.evidence}
          </span>
          {!evidence || (!evidence.text && !evidence.supportId) ? (
            <span style={{ color: latence.textMuted }}>{traceCopy.noEvidence}</span>
          ) : (
            <span className="trace-heatmap-evidence-item">
              <span className="text-[10px]" style={{ color: latence.textSubtle }}>
                {evidence.supportId ?? '—'}
                {typeof evidence.coverage === 'number'
                  ? ` · coverage ${fmt(evidence.coverage)}`
                  : ''}
                {evidence.usageState ? ` · ${evidence.usageState}` : ''}
              </span>
              <span style={{ color: latence.textMuted }}>
                {evidence.text ? evidence.text.slice(0, 320) : '—'}
                {evidence.text && evidence.text.length > 320 ? '…' : ''}
              </span>
            </span>
          )}
        </span>
        {reasonCodes.length > 0 && (
          <span className="trace-heatmap-row">
            <span style={{ color: latence.textSubtle }}>{traceCopy.reason}</span>
            <span style={{ color: latence.textMuted }}>{reasonCodes.slice(0, 3).join(', ')}</span>
          </span>
        )}
      </span>
    </span>
  );
}

function NliBars({
  entailment,
  neutral,
  contradiction,
}: {
  entailment: number;
  neutral: number;
  contradiction: number;
}) {
  const fmt = (value: number) => `${Math.round(value * 100)}%`;
  const Bar = ({
    label,
    value,
    color,
  }: {
    label: string;
    value: number;
    color: string;
  }) => (
    <span className="trace-heatmap-row" style={{ display: 'block' }}>
      <span className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: latence.textSubtle, minWidth: 80 }}>
          {label}
        </span>
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            height: 4,
            width: `${Math.max(2, Math.round(Math.max(0, Math.min(1, value)) * 100))}%`,
            maxWidth: 120,
            backgroundColor: color,
            borderRadius: 999,
          }}
        />
        <span className="text-[10px]" style={{ color: latence.textMuted, marginLeft: 'auto' }}>
          {fmt(value)}
        </span>
      </span>
    </span>
  );
  return (
    <span className="trace-heatmap-evidence" style={{ display: 'block' }}>
      <Bar label={traceCopy.entailment} value={entailment} color={latence.green} />
      <Bar label={traceCopy.neutral} value={neutral} color={latence.amber} />
      <Bar label={traceCopy.contradiction} value={contradiction} color={latence.rose} />
    </span>
  );
}

function normalizeDecisionBand(band?: string | null): TraceHeatBand {
  const value = (band ?? 'unknown').toLowerCase();
  if (value === 'green' || value === 'red') {
    return value;
  }
  if (value === 'amber' || value === 'yellow') {
    return 'amber';
  }
  return 'unknown';
}

export default Markdown;
