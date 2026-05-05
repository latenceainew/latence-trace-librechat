const checks = [
  ['LibreChat', process.env.LATENCE_DEMO_PUBLIC_URL],
  ['TRACE bridge', process.env.TRACE_DEMO_BRIDGE_URL && `${process.env.TRACE_DEMO_BRIDGE_URL}/healthz`],
  ['n8n webhook', process.env.N8N_WEBHOOK_BASE_URL && `${process.env.N8N_WEBHOOK_BASE_URL}/webhook/latence-trace-demo`],
];

for (const [name, url] of checks) {
  if (!url) {
    console.log(JSON.stringify({ name, skipped: true, reason: 'url_not_configured' }));
    continue;
  }
  const response = await fetch(url, { method: name === 'n8n webhook' ? 'POST' : 'GET' });
  console.log(JSON.stringify({ name, url, status: response.status, ok: response.ok }));
}
