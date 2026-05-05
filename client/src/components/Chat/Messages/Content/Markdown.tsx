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
  extractDecision,
  extractGroundingEvidence,
  extractTokenHeatmap,
  getGroundingResponse,
  useTraceDemo,
  type TraceDemoMessageResult,
  type TraceHeatBand,
  type TraceHeatToken,
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
  band: 'Band',
  score: 'Score',
  reason: 'Reason codes',
  evidence: 'Supporting context',
  noEvidence: 'No matching context unit returned for this span.',
  ungrouped: 'Ungrouped',
  hoverHint: 'Hover any phrase for evidence and reason codes.',
};

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
          <TraceMessageInsights result={traceResult} />
        </CodeBlockProvider>
      </ArtifactProvider>
    </MarkdownErrorBoundary>
  );
});
Markdown.displayName = 'Markdown';

const HEATMAP_BAND_STYLES: Record<
  TraceHeatBand,
  { underline: string; tooltipBorder: string; chip: string }
> = {
  green: {
    underline: latence.green,
    tooltipBorder: latence.green,
    chip: latence.greenText,
  },
  amber: {
    underline: latence.amber,
    tooltipBorder: latence.amber,
    chip: latence.amber,
  },
  red: {
    underline: latence.rose,
    tooltipBorder: latence.rose,
    chip: latence.rose,
  },
  unknown: {
    underline: 'transparent',
    tooltipBorder: latence.border,
    chip: latence.textSubtle,
  },
};

function TraceMessageInsights({ result }: { result?: TraceDemoMessageResult }) {
  const [open, setOpen] = useState(false);
  if (!result) {
    return null;
  }
  const grounding = getGroundingResponse(result);
  const tokens = extractTokenHeatmap(result);
  const decision = extractDecision(result);
  const evidence = extractGroundingEvidence(result);
  if (!grounding && tokens.length === 0 && !decision) {
    return null;
  }
  const phrases = groupTokensIntoPhrases(tokens);
  const overallScore = decision?.score ?? grounding?.trace_score ?? undefined;
  const overallBand = decision?.band ?? grounding?.risk_band ?? 'unknown';
  const bandStyle = HEATMAP_BAND_STYLES[normalizeDecisionBand(overallBand)];
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
        <span className="flex items-center gap-2">
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
        </span>
        <span style={{ color: latence.textSubtle }}>{open ? traceCopy.hide : traceCopy.show}</span>
      </button>
      {open && (
        <div className="border-t px-3 py-3" style={{ borderColor: latence.border }}>
          <p className="mb-2 text-[11px]" style={{ color: latence.textSubtle }}>
            {traceCopy.hoverHint}
          </p>
          <TraceHeatmapPhrases
            phrases={phrases}
            evidence={evidence}
            reasonCodes={decision?.reasonCodes ?? []}
          />
          {decision?.unsupportedSpans && decision.unsupportedSpans.length > 0 && (
            <div
              className="mt-3 rounded-xl border px-3 py-2"
              style={{ borderColor: latence.amber, backgroundColor: latence.amberSoft }}
            >
              <p
                className="mb-1 text-[11px] uppercase tracking-[0.16em]"
                style={{ color: latence.amber }}
              >
                Unsupported spans
              </p>
              {decision.unsupportedSpans.slice(0, 3).map((span, index) => (
                <p
                  key={`${span.label}-${index}`}
                  className="line-clamp-2"
                  style={{ color: latence.textMuted }}
                >
                  {span.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Phrase = {
  band: TraceHeatBand;
  display: string;
  averageScore?: number;
  tokens: TraceHeatToken[];
};

function groupTokensIntoPhrases(tokens: TraceHeatToken[]): Phrase[] {
  const phrases: Phrase[] = [];
  let buffer: TraceHeatToken[] = [];
  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    const display = buffer
      .map((token, index) => `${index === 0 ? '' : token.leadingSpace ? ' ' : ''}${token.display}`)
      .join('')
      .trim();
    const scores = buffer
      .map((token) => token.score)
      .filter((value): value is number => typeof value === 'number');
    const average =
      scores.length > 0 ? scores.reduce((acc, value) => acc + value, 0) / scores.length : undefined;
    phrases.push({ band: buffer[0].band, display, averageScore: average, tokens: [...buffer] });
    buffer = [];
  };
  for (const token of tokens) {
    if (token.isSpecial) {
      flush();
      continue;
    }
    if (buffer.length === 0) {
      buffer.push(token);
      continue;
    }
    if (token.band === buffer[0].band) {
      buffer.push(token);
    } else {
      flush();
      buffer.push(token);
    }
  }
  flush();
  return phrases;
}

function TraceHeatmapPhrases({
  phrases,
  evidence,
  reasonCodes,
}: {
  phrases: Phrase[];
  evidence: ReturnType<typeof extractGroundingEvidence>;
  reasonCodes: string[];
}) {
  if (phrases.length === 0) {
    return (
      <p style={{ color: latence.textSubtle }}>
        TRACE did not return token-level heatmap data for this response.
      </p>
    );
  }
  return (
    <div className="leading-relaxed" style={{ color: latence.text }}>
      {phrases.map((phrase, index) => {
        if (!phrase.display) {
          return null;
        }
        const style = HEATMAP_BAND_STYLES[phrase.band];
        const evidenceForPhrase = phrase.band === 'green' ? evidence : evidence.slice(0, 1);
        return (
          <span key={index} className="trace-heatmap-phrase">
            {index > 0 ? ' ' : ''}
            <span
              className="trace-heatmap-token"
              style={{
                borderBottom: `2px solid ${style.underline}`,
                paddingBottom: 1,
              }}
            >
              {phrase.display}
              <span
                className="trace-heatmap-popover"
                style={{ borderColor: style.tooltipBorder, backgroundColor: latence.bgRaised }}
              >
                <span className="trace-heatmap-row">
                  <span style={{ color: latence.textSubtle }}>{traceCopy.band}</span>
                  <span style={{ color: style.chip, textTransform: 'capitalize' }}>
                    {phrase.band}
                  </span>
                </span>
                {typeof phrase.averageScore === 'number' && (
                  <span className="trace-heatmap-row">
                    <span style={{ color: latence.textSubtle }}>{traceCopy.score}</span>
                    <span>
                      {phrase.averageScore <= 1
                        ? `${Math.round(phrase.averageScore * 100)}%`
                        : phrase.averageScore.toFixed(2)}
                    </span>
                  </span>
                )}
                {reasonCodes.length > 0 && (
                  <span className="trace-heatmap-row">
                    <span style={{ color: latence.textSubtle }}>{traceCopy.reason}</span>
                    <span style={{ color: latence.textMuted }}>
                      {reasonCodes.slice(0, 3).join(', ')}
                    </span>
                  </span>
                )}
                <span className="trace-heatmap-evidence">
                  <span className="trace-heatmap-row" style={{ color: latence.textSubtle }}>
                    {traceCopy.evidence}
                  </span>
                  {evidenceForPhrase.length === 0 ? (
                    <span style={{ color: latence.textMuted }}>{traceCopy.noEvidence}</span>
                  ) : (
                    evidenceForPhrase.slice(0, 2).map((item, evidenceIndex) => (
                      <span
                        key={`${item.supportId ?? evidenceIndex}`}
                        className="trace-heatmap-evidence-item"
                      >
                        <span style={{ color: latence.textMuted }}>
                          {item.text ?? item.supportId ?? '—'}
                        </span>
                      </span>
                    ))
                  )}
                </span>
              </span>
            </span>
          </span>
        );
      })}
    </div>
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
