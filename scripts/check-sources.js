/*
  GET-only health check for video sources in config.json
  - Does not modify business code or config
  - Node >= 18 (uses global fetch)
  - Usage: node scripts/check-sources.js
*/

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const TEST_QUERY = 'test';
const TIMEOUT_MS = 10000;

function buildTestUrl(base) {
  // Normalize base without trailing spaces
  let url = String(base).trim();

  // If base already contains a query string, append with '&', else with '?'
  const sep = url.includes('?') ? '&' : '?';

  // Standard AppleCMS v10 search endpoint shape
  return `${url}${sep}ac=videolist&wd=${encodeURIComponent(TEST_QUERY)}&pg=1`;
}

async function fetchWithTimeout(url, ms) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      },
      redirect: 'follow',
      signal: ac.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, error: e && e.message ? e.message : String(e) };
  } finally {
    clearTimeout(id);
  }
}

function judgeResponseShape(text) {
  // Quick checks for typical AppleCMS JSON structures
  try {
    const json = JSON.parse(text);
    if (json && Array.isArray(json.list)) {
      return { verdict: 'ok', detail: 'JSON with list[]' };
    }
    if (json && Array.isArray(json.data)) {
      return { verdict: 'ok_maybe', detail: 'JSON with data[]' };
    }
    if (json && (json.code !== undefined || json.total !== undefined)) {
      return { verdict: 'ok_maybe', detail: 'JSON with code/total' };
    }
    return { verdict: 'unknown', detail: 'JSON but unknown shape' };
  } catch (_) {
    // Not JSON, maybe XML/HTML
    if (typeof text === 'string' && text.trim().startsWith('<')) {
      return { verdict: 'xml_or_html', detail: 'Non-JSON response (XML/HTML)' };
    }
    if (typeof text === 'string' && text.length > 0) {
      return { verdict: 'text', detail: 'Plain text response' };
    }
    return { verdict: 'empty', detail: 'Empty body' };
  }
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('config.json not found at', CONFIG_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse config.json:', e.message);
    process.exit(1);
  }
  const sites = cfg && cfg.api_site ? cfg.api_site : {};
  const entries = Object.entries(sites);
  if (entries.length === 0) {
    console.log('No api_site entries found.');
    return;
  }

  console.log(`Testing ${entries.length} sources (GET only, timeout ${TIMEOUT_MS}ms)...\n`);

  const results = [];
  let tested = 0;
  // Limit concurrency to avoid being rate-limited
  const CONCURRENCY = 8;
  const queue = entries.slice();

  async function worker(id) {
    while (queue.length) {
      const [key, site] = queue.shift();
      const base = (site && site.api) || '';
      const testUrl = buildTestUrl(base);
      const startedAt = Date.now();
      const r = await fetchWithTimeout(testUrl, TIMEOUT_MS);
      const ms = Date.now() - startedAt;
      let verdict = 'fail';
      let detail = '';
      if (r.ok) {
        const judge = judgeResponseShape(r.text || '');
        verdict = judge.verdict === 'ok' ? 'pass' : judge.verdict;
        detail = judge.detail;
      } else {
        verdict = 'fail';
        detail = r.error ? r.error : `HTTP ${r.status}`;
      }
      results.push({ key, name: site.name || key, base, testUrl, verdict, status: r.status || 0, ms, detail });
      tested += 1;
      const prefix = verdict === 'pass' ? '✅' : verdict === 'ok_maybe' ? '🟡' : '❌';
      console.log(`${prefix} [${tested}/${entries.length}] ${key} - ${site.name || ''} (${ms}ms) -> ${verdict} ${r.status || ''} ${detail}`);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  // Summaries
  const pass = results.filter((r) => r.verdict === 'pass');
  const maybe = results.filter((r) => r.verdict === 'ok_maybe');
  const xml = results.filter((r) => r.verdict === 'xml_or_html');
  const unknown = results.filter((r) => r.verdict === 'unknown' || r.verdict === 'text');
  const fail = results.filter((r) => r.verdict === 'fail' || r.verdict === 'empty');

  console.log('\n===== SUMMARY =====');
  console.log(`PASS: ${pass.length}`);
  console.log(`MAYBE: ${maybe.length}`);
  console.log(`XML/HTML (likely incompatible): ${xml.length}`);
  console.log(`UNKNOWN/TEXT: ${unknown.length}`);
  console.log(`FAIL/EMPTY: ${fail.length}`);

  // Write report JSON
  const outPath = path.join(process.cwd(), 'source-check-report.json');
  fs.writeFileSync(outPath, JSON.stringify({ when: new Date().toISOString(), results }, null, 2), 'utf-8');
  console.log(`\nReport saved to ${outPath}`);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
