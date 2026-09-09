import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

async function walk(dir) {
  const results = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await walk(filename)); else results.push(filename);
  }
  return results;
}
const files = await walk('dist');
const html = files.filter(f => f.endsWith('.html'));
for (const file of files) {
  assert.ok((await stat(file)).size < 25 * 1024 * 1024, `Cloudflare asset too large: ${file}`);
  assert.ok(!/(?:samples|artifacts|IMG_13|\.env|research)/.test(file), `Private asset in build: ${file}`);
}
for (const file of html) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/href="(\/[^"#?]*)"/g)) {
    const route = match[1];
    const target = path.join('dist', route, route.endsWith('/') ? 'index.html' : '');
    assert.ok(files.includes(target), `Broken link in ${file}: ${route}`);
  }
  assert.ok(!/googlesyndication|google-analytics|doubleclick|clarity\.ms|hotjar/.test(content), `Unexpected third-party script: ${file}`);
}
for (const lang of ['en', 'zh-cn']) {
  const content = await readFile(`dist/${lang}/stitch/index.html`, 'utf8');
  assert.ok(content.includes('client="only"'), 'Editor must hydrate locally');
  assert.ok(!/src="https?:/.test(content), 'Editor must not fetch remote scripts');
}
assert.ok(files.some(f => /worker.*\.js$/.test(f)), 'Missing background image worker');
console.log(`Build checked: ${html.length} HTML pages, local links, no private assets or ad scripts, Cloudflare asset sizes.`);
