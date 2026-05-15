// Build script: strips 4 themes from index.html, splits HTML/JS, minifies each,
// emits a Cognigy REST transformer that routes between the two based on ?asset=js.
//
// The split is required because Cognigy serves transformer responses with
// `Content-Security-Policy: script-src 'self'`, which blocks inline <script>.
// Loading the JS as a same-origin URL (the same endpoint with ?asset=js) is
// the only relaxation 'self' allows.
//
// Run: node .build-embed.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const SRC = 'index.html';
const OUT = 'endpoint-embed.js';
const TMP_HTML_IN = '.tmp-trimmed.html';
const TMP_HTML_OUT = '.tmp-min.html';
const TMP_JS_IN = '.tmp-script.js';
const TMP_JS_OUT = '.tmp-script.min.js';

const REMOVE = ['bloom', 'trailhead', 'minimal', 'ivory'];

let html = fs.readFileSync(SRC, 'utf8');
const origSize = html.length;

// 1) Remove preset-chip buttons for the four themes
for (const name of REMOVE) {
  const re = new RegExp(`^[ \\t]*<button class="preset-chip" data-preset="${name}">[^<]*</button>[ \\t]*\\r?\\n`, 'm');
  if (!re.test(html)) console.warn(`WARN: did not find chip for ${name}`);
  html = html.replace(re, '');
}

// 2) Remove preset object entries inside the PRESETS object literal
for (const name of REMOVE) {
  const startRe = new RegExp(`^[ \\t]{4}${name}: \\{`, 'm');
  const m = html.match(startRe);
  if (!m) { console.warn(`WARN: did not find preset entry for ${name}`); continue; }
  const startIdx = m.index;
  const braceIdx = html.indexOf('{', startIdx);
  let depth = 1;
  let i = braceIdx + 1;
  while (i < html.length && depth > 0) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (html[i] === ',') i++;
  while (html[i] === ' ' || html[i] === '\t') i++;
  if (html[i] === '\r') i++;
  if (html[i] === '\n') i++;
  html = html.slice(0, startIdx) + html.slice(i);
}

console.log(`After theme strip: ${html.length} bytes (was ${origSize})`);

// 2b) Strip the Live Preview feature for the embed.
// It depends on inline <script> in the iframe's srcdoc + fetching webchat.js from
// github.com — both blocked by Cognigy's `script-src 'self'`. The feature is
// preserved in the standalone index.html.

// Remove the "Preview live ↗" launch button (whole line).
{
  const re = /^[ \t]*<button class="preview-launch-btn"[^>]*>[^<]*<\/button>[ \t]*\r?\n/m;
  if (!re.test(html)) console.warn('WARN: preview launch button not found');
  html = html.replace(re, '');
}

// Remove the AI prompt generator modal block (depth-counted div matcher).
{
  const start = html.indexOf('<div class="preview-modal" id="aiPromptModal"');
  if (start === -1) {
    console.warn('WARN: AI prompt modal not found');
  } else {
    let i = start + '<div'.length;
    let depth = 1;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        i = nextClose + 6;
      }
    }
    if (html[i] === '\r') i++;
    if (html[i] === '\n') i++;
    html = html.slice(0, start) + html.slice(i);
  }
}

// Remove the live-preview modal block (depth-counted div matcher).
{
  const start = html.indexOf('<div class="preview-modal" id="previewModal"');
  if (start === -1) {
    console.warn('WARN: preview modal not found');
  } else {
    let i = start + '<div'.length;
    let depth = 1;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        i = nextClose + 6;
      }
    }
    // Trim a trailing newline after the modal so we don't leave a stray blank line
    if (html[i] === '\r') i++;
    if (html[i] === '\n') i++;
    html = html.slice(0, start) + html.slice(i);
  }
}

console.log(`After preview HTML strip: ${html.length} bytes`);

// 3) Extract the main inline <script>...</script> block.
// The page has exactly one inline script block (the trailing one before </body>).
// The /script/ literal embedded inside string literals uses `<\/script>` so the
// raw `</script>` only appears as the actual closing tag.
const scriptOpenRe = /<script>\s*\/\*[\s\S]*?TOKEN DEFINITIONS/;
const scriptOpen = html.search(/<script>(?=[\s\S]*?function init)/);
if (scriptOpen === -1) throw new Error('Could not find inline <script> block');
const scriptCloseToken = '</script>';
const scriptClose = html.lastIndexOf(scriptCloseToken);
if (scriptClose === -1 || scriptClose < scriptOpen) throw new Error('Could not find </script> for inline block');

let scriptBody = html.slice(scriptOpen + '<script>'.length, scriptClose);

// 3a) Strip preview-related JS so the bundle doesn't reference removed DOM elements
// or carry ~7 KB of dead functions.

// (i) Init-time event listeners for preview elements + the global Escape keydown
// handler that calls closePreview(). The block sits between the "// Live Cognigy
// preview overlay" comment and the next `chatInput` keydown listener.
{
  const startMarker = '// Live Cognigy preview overlay';
  const endMarker = "document.getElementById('chatInput').addEventListener";
  const s = scriptBody.indexOf(startMarker);
  const e = scriptBody.indexOf(endMarker, s);
  if (s === -1 || e === -1) {
    console.warn('WARN: preview init-listener block not found');
  } else {
    // Walk backwards from `endMarker` past whitespace/newlines to keep init() tidy
    let cut = e;
    while (cut > 0 && /[ \t]/.test(scriptBody[cut - 1])) cut--;
    scriptBody = scriptBody.slice(0, s) + scriptBody.slice(cut);
  }
}

// (ii) The LIVE COGNIGY PREVIEW section: 2 const declarations + 6 function
// declarations. Strip from the section banner to the end of clearPreview().
{
  const start = scriptBody.indexOf('LIVE COGNIGY PREVIEW');
  if (start === -1) {
    console.warn('WARN: LIVE COGNIGY PREVIEW banner not found');
  } else {
    // Back up to the start of the banner comment block (`/* =====`)
    let bannerStart = scriptBody.lastIndexOf('/*', start);
    if (bannerStart === -1) bannerStart = start;
    // Back up further to the previous newline so we drop preceding indent
    while (bannerStart > 0 && /[ \t]/.test(scriptBody[bannerStart - 1])) bannerStart--;

    // Find `function clearPreview()` then brace-match its body
    const fnIdx = scriptBody.indexOf('function clearPreview', start);
    if (fnIdx === -1) throw new Error('clearPreview function not found');
    const braceIdx = scriptBody.indexOf('{', fnIdx);
    let depth = 1, i = braceIdx + 1;
    while (i < scriptBody.length && depth > 0) {
      const c = scriptBody[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    // Consume trailing whitespace + one newline
    while (i < scriptBody.length && /[ \t]/.test(scriptBody[i])) i++;
    if (scriptBody[i] === '\r') i++;
    if (scriptBody[i] === '\n') i++;
    scriptBody = scriptBody.slice(0, bannerStart) + scriptBody.slice(i);
  }
}

// 3b) Strip the AI prompt generator feature for the embed. Same rationale as the
// live-preview strip: it's an agency/consultant tool that's most useful in the
// standalone builder, and it adds ~7-8 KB that pushes the embed over the
// transformer size limit. The standalone index.html keeps the feature.

// AI top-level: banner + template const + 7 functions, ending at openInClaude()
{
  const start = scriptBody.indexOf('AI PROMPT GENERATOR');
  if (start === -1) {
    console.warn('WARN: AI PROMPT GENERATOR banner not found');
  } else {
    let bannerStart = scriptBody.lastIndexOf('/*', start);
    if (bannerStart === -1) bannerStart = start;
    while (bannerStart > 0 && /[ \t]/.test(scriptBody[bannerStart - 1])) bannerStart--;

    const fnIdx = scriptBody.indexOf('function openInClaude', start);
    if (fnIdx === -1) throw new Error('openInClaude function not found');
    const braceIdx = scriptBody.indexOf('{', fnIdx);
    let depth = 1, i = braceIdx + 1;
    while (i < scriptBody.length && depth > 0) {
      const c = scriptBody[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    while (i < scriptBody.length && /[ \t]/.test(scriptBody[i])) i++;
    if (scriptBody[i] === '\r') i++;
    if (scriptBody[i] === '\n') i++;
    scriptBody = scriptBody.slice(0, bannerStart) + scriptBody.slice(i);
  }
}

// The AI button added by renderSavedThemes
scriptBody = scriptBody.replace(
  /^\s*html \+= `<button class="save-theme-btn" id="aiThemeBtn"[^`]*`;\s*\n/m,
  ''
);

// The AI button branch in the saved-themes click handler
scriptBody = scriptBody.replace(
  /^\s*if \(e\.target\.closest\('#aiThemeBtn'\)\)[^\n]*\n/m,
  ''
);

console.log(`After AI strip: ${scriptBody.length} bytes`);

const htmlWithExternalScript =
  html.slice(0, scriptOpen) +
  '<script src="?asset=js"></script>' +
  html.slice(scriptClose + scriptCloseToken.length);

fs.writeFileSync(TMP_HTML_IN, htmlWithExternalScript);
fs.writeFileSync(TMP_JS_IN, scriptBody);
console.log(`Split sizes — HTML: ${htmlWithExternalScript.length}, JS: ${scriptBody.length}`);

// 4) Minify HTML (no --minify-js needed; only inline CSS remains)
execSync([
  'npx', '--yes', 'html-minifier-terser',
  '--collapse-whitespace',
  '--remove-comments',
  '--remove-redundant-attributes',
  '--remove-script-type-attributes',
  '--remove-style-link-type-attributes',
  '--minify-css', 'true',
  TMP_HTML_IN,
  '-o', TMP_HTML_OUT,
].join(' '), { stdio: 'inherit' });

// 5) Minify JS with terser. --mangle off to keep stack traces readable; --compress
// gives ~30% savings without aggressive transforms that could break the code.
execSync([
  'npx', '--yes', 'terser',
  TMP_JS_IN,
  '--compress',
  '--mangle',
  '-o', TMP_JS_OUT,
].join(' '), { stdio: 'inherit' });

const minHtml = fs.readFileSync(TMP_HTML_OUT, 'utf8');
const minJs = fs.readFileSync(TMP_JS_OUT, 'utf8');
console.log(`Minified — HTML: ${minHtml.length}, JS: ${minJs.length}, total: ${minHtml.length + minJs.length}`);

// 6) Escape both for inclusion in a JS template literal
const esc = s => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const out =
`const HTML = \`${esc(minHtml)}\`;
const JS = \`${esc(minJs)}\`;
createRestTransformer({
  handleInput: async ({ endpoint, request, response }) => {
    const isJs = (request && request.query && request.query.asset === 'js')
      || (request && typeof request.url === 'string' && request.url.indexOf('asset=js') !== -1);
    if (isJs) {
      response.set('Content-Type', 'application/javascript; charset=utf-8');
      response.send(JS);
    } else {
      response.set('Content-Type', 'text/html; charset=utf-8');
      response.send(HTML);
    }
    return null;
  }
});
`;

fs.writeFileSync(OUT, out);
console.log(`\nWrote ${OUT}: ${out.length} bytes`);

// Cleanup
for (const f of [TMP_HTML_IN, TMP_HTML_OUT, TMP_JS_IN, TMP_JS_OUT]) {
  try { fs.unlinkSync(f); } catch {}
}
