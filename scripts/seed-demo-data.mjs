import { readFile } from 'node:fs/promises';

const bridgeUrl = process.env.TRACE_DEMO_BRIDGE_URL;
if (!bridgeUrl) {
  throw new Error('TRACE_DEMO_BRIDGE_URL is required');
}

const scenarios = JSON.parse(await readFile(new URL('../demo-data/scenarios.json', import.meta.url)));

for (const scenario of scenarios) {
  const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/api/trace/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scenario),
  });
  if (!response.ok) {
    throw new Error(`Scenario ${scenario.scenario} failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  console.log(
    JSON.stringify({
      scenario: scenario.scenario,
      integration: scenario.integration,
      risk_band: body.risk_band,
      action: body.runtime_decision?.graph_route || body.runtime_decision?.action || body.risk_band,
      request_id: body.request_id,
    }),
  );
}
