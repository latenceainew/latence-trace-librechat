const required = [
  'CONFIG_PATH',
  'ENDPOINTS',
  'OPENROUTER_KEY',
  'LATENCE_TRACE_URL',
  'LATENCE_TRACE_API_KEY',
  'TRACE_DEMO_BRIDGE_URL',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing required demo environment: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Demo environment is ready for reset.');
console.log('Reset is intentionally non-destructive in the scaffold.');
console.log('Hook this script to managed Mongo/user cleanup after staging credentials are available.');
