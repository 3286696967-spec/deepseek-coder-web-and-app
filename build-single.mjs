import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(resolve(root, file), 'utf8');

let html = read('public/index.html');
const css = read('public/styles.css');
const js = read('public/app.js');
const favicon = Buffer.from(read('public/assets/favicon.svg'), 'utf8').toString('base64');

for (const [name, content] of [['styles.css', css], ['app.js', js]]) {
  if (content.includes('</style') || content.includes('</script')) {
    throw new Error(`${name} 含有不能安全内联的结束标签`);
  }
}

const styleTag = '<link rel="stylesheet" href="/styles.css">';
const scriptTag = '<script src="/app.js" defer></script>';
const iconTag = '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">';

if (!html.includes(styleTag)) throw new Error('未找到样式表引用');
if (!html.includes(scriptTag)) throw new Error('未找到脚本引用');
if (!html.includes(iconTag)) throw new Error('未找到 favicon 引用');

html = html
  .replace(iconTag, () => `<link rel="icon" href="data:image/svg+xml;base64,${favicon}" type="image/svg+xml">`)
  .replace(styleTag, () => `<style>\n${css}\n</style>`)
  .replace(scriptTag, () => `<script>\n${js}\n</script>`)
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-build="single-file">')
  .replace('</head>', '  <meta name="shiguan-build" content="single-file; inline CSS/JS; requires server API">\n</head>');

writeFileSync(resolve(root, 'public/site.html'), html);
console.log(`public/site.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
