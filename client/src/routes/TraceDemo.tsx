import { useState } from 'react';
import { Link } from 'react-router-dom';

const scenarios = [
  {
    id: 'support-rag',
    title: 'Support RAG',
    integration: 'Native SDK / LangChain / LlamaIndex',
    signal: 'Unsupported refund promise is routed to review.',
    decision: 'Review',
    action: 'auto_repair',
    band: 'Amber',
    score: '0.74',
    evidence: 'Refund timelines require manual finance approval before a promise is made.',
    soWhat: 'TRACE prevents an unsupported refund promise before it reaches the customer.',
    href: '/c/new?endpoint=OpenRouter&model=nvidia%2Fnemotron-3-super-120b-a12b%3Afree',
  },
  {
    id: 'coding-agent',
    title: 'Coding Agent',
    integration: 'LangGraph',
    signal: 'TRACE decides pass, review, or retry from code-grounding evidence.',
    decision: 'Retry',
    action: 'retry',
    band: 'Red',
    score: '0.31',
    evidence: 'The answer claims a security fix, but the patch only changes retry behavior.',
    soWhat: 'TRACE routes a risky coding claim back into the graph before merge.',
    href: '/c/new?endpoint=OpenRouter&model=nvidia%2Fnemotron-3-super-120b-a12b%3Afree',
  },
  {
    id: 'privacy',
    title: 'Privacy Gate',
    integration: 'Native SDK',
    signal: 'Customer records are redacted before logs, tools, and prompts.',
    decision: 'Redact',
    action: 'redact',
    band: 'Red',
    score: '3 entities',
    evidence: 'Email, account reference, and IBAN-like content are detected in the turn.',
    soWhat: 'TRACE removes sensitive data before the workflow stores or forwards it.',
    href: '/c/new?endpoint=OpenRouter&model=nvidia%2Fnemotron-3-super-120b-a12b%3Afree',
  },
  {
    id: 'memory-rollup',
    title: 'Memory + Rollup',
    integration: 'SDK-managed session state',
    signal: 'Dead context is removed and the review-ready session summary is preserved.',
    decision: 'Log',
    action: 'rollup',
    band: 'Green',
    score: '42% saved',
    evidence: 'The session keeps approval constraints and drops stale small talk.',
    soWhat: 'TRACE reduces context cost while preserving the facts a reviewer needs.',
    href: '/c/new?endpoint=OpenRouter&model=nvidia%2Fnemotron-3-super-120b-a12b%3Afree',
  },
  {
    id: 'compression',
    title: 'Context Compression',
    integration: 'Native SDK',
    signal: 'Token-heavy policy context is compressed while preserving constraints.',
    decision: 'Compress',
    action: 'compress',
    band: 'Green',
    score: '38% saved',
    evidence: 'Approval deadlines, refund exclusions, and escalation rules stay intact.',
    soWhat: 'TRACE lowers inference cost without hiding the controls buyers care about.',
    href: '/c/new?endpoint=OpenRouter&model=nvidia%2Fnemotron-3-super-120b-a12b%3Afree',
  },
];

const outcomes = [
  {
    label: 'Risk routed',
    value: 'review / retry',
    body: 'Turns with unsupported claims are caught before customer or code-review exposure.',
  },
  {
    label: 'Integrator path',
    value: 'SDK first',
    body: 'LangChain, LlamaIndex, LangGraph, n8n, and native calls share the same bridge contract.',
  },
  {
    label: 'Ops posture',
    value: 'no raw RunPod',
    body: 'Runtime access is kept inside the SDK, with secrets isolated on the server side.',
  },
];

const copy = {
  brand: 'LATENCE TRACE',
  openChat: 'Open chat',
  eyebrow: 'Live integration showcase',
  headline: 'See what TRACE catches before an agent answer reaches production.',
  body: 'This LibreChat fork is the visual host for Latence TRACE demos: OpenRouter models, real TRACE runtime calls, SDK-first framework integrations, and a buyer-readable evidence panel.',
  startDemo: 'Start demo chat',
  viewSdk: 'View SDK code',
  preview: 'TRACE decision preview',
  decisionLabel: 'Decision',
  decision: 'Review',
  whyLabel: 'Why it matters',
  why: 'The answer promises a 48-hour refund, but the policy context requires manual finance approval first.',
  riskBandLabel: 'Risk band',
  riskBand: 'Amber',
  integrationLabel: 'Integration',
  integration: 'LangChain',
  scenarioLauncher: 'Scenario launcher',
  tracePanel: 'TRACE side panel',
  evidenceLabel: 'Top evidence',
  actionLabel: 'Runtime action',
  scoreLabel: 'TRACE score',
  soWhatLabel: 'So what',
  integrationSwitcher: 'Integration switcher',
  bridgeStatus: 'SDK-only bridge ready',
  dashboard: 'Demo dashboard',
};

export default function TraceDemo() {
  const [selectedId, setSelectedId] = useState(scenarios[0].id);
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-10">
        <nav className="flex items-center justify-between">
          <Link to="/" className="text-sm font-semibold tracking-[0.3em] text-cyan-300">
            {copy.brand}
          </Link>
          <Link
            to="/c/new"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:border-cyan-300 hover:text-white"
          >
            {copy.openChat}
          </Link>
        </nav>

        <div className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="mb-5 inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
              {copy.eyebrow}
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight md:text-7xl">
              {copy.headline}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">{copy.body}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/c/new"
                className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-200"
              >
                {copy.startDemo}
              </Link>
              <a
                href="https://github.com/latenceainew/latence-trace-python"
                className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-white/40"
              >
                {copy.viewSdk}
              </a>
            </div>
          </div>

          <TracePanel scenario={selectedScenario} />
        </div>

        <section className="pb-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                {copy.scenarioLauncher}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{copy.integrationSwitcher}</h2>
            </div>
            <p className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-sm text-emerald-200">
              {copy.bridgeStatus}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {scenarios.map((scenario) => (
              <div
                key={scenario.id}
                className={`rounded-3xl border p-5 text-left transition hover:-translate-y-1 hover:border-cyan-300/60 ${
                  selectedId === scenario.id
                    ? 'border-cyan-300/70 bg-cyan-300/10'
                    : 'border-white/10 bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(scenario.id)}
                  className="block w-full text-left"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                    {scenario.integration}
                  </p>
                  <h2 className="mt-4 text-2xl font-semibold">{scenario.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{scenario.signal}</p>
                </button>
                <Link
                  to={scenario.href}
                  className="mt-5 inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-slate-100 hover:border-cyan-300"
                >
                  {copy.startDemo}
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 pb-12 md:grid-cols-3">
          {outcomes.map((outcome) => (
            <div
              key={outcome.label}
              className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                {copy.dashboard}
              </p>
              <h2 className="mt-4 text-xl font-semibold">{outcome.label}</h2>
              <p className="mt-2 text-3xl font-semibold text-cyan-100">{outcome.value}</p>
              <p className="mt-3 text-sm leading-6 text-slate-300">{outcome.body}</p>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}

function TracePanel({ scenario }: { scenario: (typeof scenarios)[number] }) {
  return (
    <aside className="sticky top-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-cyan-950/40">
      <div className="rounded-2xl border border-cyan-300/20 bg-slate-900/80 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
          {copy.tracePanel}
        </p>
        <h2 className="mt-3 text-3xl font-semibold">{scenario.title}</h2>
        <div className="mt-5 grid gap-3">
          <PanelCard label={copy.decisionLabel} value={scenario.decision} accent="amber" />
          <PanelCard label={copy.actionLabel} value={scenario.action} />
          <PanelCard label={copy.riskBandLabel} value={scenario.band} />
          <PanelCard label={copy.scoreLabel} value={scenario.score} />
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="text-sm text-slate-400">{copy.evidenceLabel}</p>
            <p className="mt-1 text-slate-100">{scenario.evidence}</p>
          </div>
          <div className="rounded-2xl bg-cyan-300/10 p-4">
            <p className="text-sm text-cyan-100">{copy.soWhatLabel}</p>
            <p className="mt-1 text-slate-100">{scenario.soWhat}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function PanelCard({ label, value, accent }: { label: string; value: string; accent?: 'amber' }) {
  const valueClass = accent === 'amber' ? 'text-amber-200' : 'text-white';
  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
