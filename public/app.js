'use strict';

/* ============================================================
   时观 · 前端应用
   零依赖，所有外部文本均先转义；AI 回答只按受限 Markdown 渲染。
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const CATEGORY_LABELS = {
  central: '中央部署',
  policy: '政策',
  economy: '经济',
  diplomacy: '外交',
  livelihood: '民生',
  local: '地方',
  theory: '理论',
  other: '综合',
};

const FILTER_LABELS = {
  all: '全部',
  central: '中央',
  policy: '政策',
  local: '地方',
  media: '媒体',
  theory: '求是',
};

const state = {
  data: null,
  loading: false,
  filter: 'all',
  sort: 'latest',
  query: '',
  visible: 8,
  matrix: 'all',
  video: 'bilibili',
  provinceExpanded: false,
  aiBusy: false,
  aiOpened: false,
  lastFocus: null,
  refreshTimer: null,
  searchTimer: null,
};

/* ---------- escaping & format ---------- */

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function safeUrl(value = '') {
  const raw = String(value || '').trim();
  return /^https?:\/\//i.test(raw) ? esc(raw) : '#';
}

function safeColor(value = '') {
  return /^#[0-9a-f]{3,8}$/i.test(String(value)) ? String(value) : '#ad2a1f';
}

function safeCover(value = '') {
  const raw = String(value || '').trim();
  if (!/^https:\/\//i.test(raw)) return '';
  return raw.replace(/["'()\\\n\r]/g, (char) => encodeURIComponent(char));
}

function dateParts(date = '') {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return { year: '', month: '', day: '', short: date || '—' };
  return { year: match[1], month: match[2], day: match[3], short: `${match[2]}.${match[3]}` };
}

function shortDate(date = '') {
  if (!state.data) return dateParts(date).short;
  if (date === state.data.meta.today) return '今日';
  if (date === state.data.meta.yesterday) return '昨日';
  return dateParts(date).short;
}

function longDate(date = '') {
  const parts = dateParts(date);
  if (!parts.year) return date || '—';
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日`;
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  return String(number);
}

function categoryLabel(article) {
  return article?.categoryLabel || CATEGORY_LABELS[article?.category] || '综合';
}

function articleById(id) {
  return state.data?.articles.find((article) => article.id === id) || null;
}

function normalize(text = '') {
  return String(text).toLowerCase().replace(/\s+/g, '');
}

/* ---------- toast ---------- */

let toastTimer = null;
function toast(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-show'), 2800);
}

/* ---------- clock & active nav ---------- */

function tickClock() {
  const now = new Date();
  const clock = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  const clockNode = $('#headerClock');
  if (clockNode) clockNode.textContent = clock;
}

let navObserver = null;
function observeSections() {
  if (navObserver) navObserver.disconnect();
  const sections = $$('main section[id]');
  if (!sections.length || !('IntersectionObserver' in window)) return;
  navObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const id = visible.target.id;
    $$('.mainnav a, .side-nav a').forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('href') === `#${id}`);
    });
  }, { rootMargin: '-150px 0px -62% 0px', threshold: [0, .15, .4] });
  sections.forEach((section) => navObserver.observe(section));
}

/* ---------- data loading ---------- */

async function loadData({ refresh = false, silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const button = $('#refreshBtn');
  button?.classList.add('is-spinning');
  document.body.setAttribute('aria-busy', 'true');

  try {
    const response = await fetch(`/api/dashboard${refresh ? '?refresh=1' : ''}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.articles)) throw new Error('返回数据格式异常');
    state.data = data;
    renderAll();
    if (refresh && !silent) toast(`已更新 · ${data.meta.updatedLabel}`);
  } catch (error) {
    console.error('[shiguan] load failed', error);
    if (!silent) toast('数据刷新失败，保留上次内容');
    if (!state.data) renderLoadFailure(error);
  } finally {
    state.loading = false;
    button?.classList.remove('is-spinning');
    document.body.removeAttribute('aria-busy');
  }
}

function renderLoadFailure(error) {
  const title = $('#heroTitle');
  if (title) title.textContent = '信源连接失败，请稍后重试';
  const excerpt = $('#heroExcerpt');
  if (excerpt) excerpt.textContent = '本地服务可能尚未启动，或抓取任务超时。请检查终端中的 server.mjs 运行状态后点击右上角刷新。';
  const health = $('#healthOk');
  if (health) health.textContent = '连接失败';
  const updated = $('#healthUpdated');
  if (updated) updated.textContent = error?.message || '无法连接 /api/dashboard';
  const stream = $('#streamList');
  if (stream) stream.innerHTML = '<div class="local-empty">暂时无法载入要闻。请确认本地服务运行在 127.0.0.1:4173。</div>';
}

/* ---------- render orchestration ---------- */

function renderAll() {
  if (!state.data) return;
  renderMeta();
  renderTicker();
  renderHero();
  renderStream();
  renderKeywords();
  renderCoverage();
  renderLocal();
  renderQiushi();
  renderMatrix();
  renderBloggers();
  renderTrends();
  renderVideo();
  renderDirectory();
  renderHealth();
  renderBrief();
  renderAskSuggestions();
  observeSections();
}

function renderMeta() {
  const { meta, stats, brief } = state.data;
  $('#headerDate').textContent = meta.dateLabel;
  $('#heroUpdate').textContent = meta.updatedLabel;
  $('#sideUpdate').textContent = meta.timeLabel;
  $('#sideBriefIssue').textContent = brief.issue;
  $('#sideBriefMeta').textContent = `${stats.sources} 个信源 · ${stats.articles} 条`;
  $('#briefIssue').textContent = brief.issue;
  $('#briefModalIssue').textContent = brief.issue;
  $('#footerUpdated').textContent = `数据更新 ${meta.dateLabel} ${meta.timeLabel}`;
  $('#aiScope').textContent = `${stats.sources} 个信源 · ${stats.articles} 条 · ${meta.today}`;
  $('#aiEngine').textContent = meta.engine === 'deepseek' ? 'DEEPSEEK' : 'LOCAL RAG';
  if (meta.isFallback) toast('实时源不足，当前包含备用样本');
}

/* ---------- ticker ---------- */

function renderTicker() {
  const track = $('#tickerTrack');
  if (!track) return;
  const items = state.data.articles.slice(0, 9);
  if (!items.length) {
    track.innerHTML = '<a href="#stream">暂无实时快讯</a>';
    return;
  }
  const html = items.map((article) => (
    `<a href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer"><em>${esc(article.sourceShort || article.source)}</em>${esc(article.title)}</a>`
  )).join('');
  track.innerHTML = html + html;
}

/* ---------- hero ---------- */

function renderHero() {
  const { hero, articles, stats, brief, meta, directory } = state.data;
  const lead = hero || articles[0];
  if (!lead) return;

  const title = $('#heroTitle');
  title.innerHTML = `<a href="${safeUrl(lead.url)}" target="_blank" rel="noopener noreferrer">${esc(lead.title)}</a>`;
  $('#heroSource').textContent = lead.source;
  $('#heroDate').textContent = shortDate(lead.date);
  $('#heroExcerpt').textContent = lead.excerpt || '该条要闻暂无摘要，点击“阅读原文”查看权威发布全文。';
  $('#heroLink').href = safeUrl(lead.url);

  const heroStats = [
    { value: stats.today, label: '今日更新' },
    { value: stats.local, label: '地方动态' },
    { value: `${stats.sources}/${stats.sourceTotal}`, label: '有效信源' },
  ];
  $('#heroStats').innerHTML = heroStats.map((item) => (
    `<div class="hero-stat"><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`
  )).join('');

  const side = articles.filter((article) => article.id !== lead.id).slice(0, 5);
  $('#heroList').innerHTML = side.length
    ? side.map((article, index) => (
      `<li><a href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer"><span class="num">${String(index + 1).padStart(2, '0')}</span><span class="txt">${esc(article.title)}</span></a></li>`
    )).join('')
    : '<li><a href="#stream"><span class="num">01</span><span class="txt">进入实时要闻流查看今日全部更新</span></a></li>';

  const lines = brief?.mainlines?.length ? brief.mainlines : [];
  $('#frontLines').innerHTML = lines.map((line) => (
    `<a class="front-line" href="#stream" data-line="${esc(line.id)}"><span class="front-line__num">${esc(line.no)}</span><span><span class="front-line__label">${esc(line.title)} · ${esc(line.count)} 条</span><span class="front-line__title">${esc((line.text || '').split('；')[0] || '查看相关要闻')}</span></span></a>`
  )).join('');

  $('#briefTitle').textContent = brief?.title || '今日政情分析简报';
  $('#briefSummary').textContent = brief?.summary || '正在生成今日摘要。';
  $('#briefMetrics').innerHTML = [
    { value: stats.articles, label: '总入库' },
    { value: stats.today, label: '今日更新' },
    { value: stats.local, label: '地方条数' },
  ].map((item) => `<div class="brief-metric"><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join('');
  $('#briefSignals').innerHTML = (brief?.signals || []).slice(0, 2).map((signal) => (
    `<div class="brief-signal"><strong>${esc(signal.title)}</strong><span>${esc(signal.meaning)}</span></div>`
  )).join('') || '<div class="brief-signal"><strong>今日暂未识别出集中政策信号</strong><span>可进入实时流按“政策”筛选查看。</span></div>';

  const liveRegions = new Set(articles.map((article) => article.region).filter(Boolean));
  $('#provinceGrid').innerHTML = directory.provinces.map((province) => (
    `<a href="${safeUrl(province.url)}" target="_blank" rel="noopener noreferrer" data-live="${liveRegions.has(province.name) ? '1' : '0'}">${esc(province.name)}</a>`
  )).join('');
  $('#provinceGrid').classList.toggle('is-collapsed', !state.provinceExpanded);
  $('#provinceToggle').innerHTML = state.provinceExpanded ? '收起省份 <span>−</span>' : '展开全部省份 <span>+</span>';
  $('#localMeta').textContent = `${stats.regions} 个地区 · ${stats.local} 条`;

  $('#healthRing').style.setProperty('--pct', Math.round((stats.sources / Math.max(1, stats.sourceTotal)) * 100));
  $('#healthRingText').textContent = `${stats.sources}/${stats.sourceTotal}`;
  $('#healthOk').textContent = `${stats.sources} / ${stats.sourceTotal} 信源在线`;
  $('#healthUpdated').textContent = meta.updatedLabel;
  $('#healthLatency').textContent = `${meta.fetchMs} ms`;
  $('#footerUpdated').textContent = `数据更新 ${meta.dateLabel} ${meta.timeLabel}`;
}

/* ---------- stream ---------- */

function articleMatchesFilter(article, filter) {
  switch (filter) {
    case 'central': return article.sourceGroup === 'central' || article.category === 'central';
    case 'policy': return article.sourceGroup === 'policy' || article.category === 'policy' || article.category === 'economy';
    case 'local': return article.region !== '全国' || ['local', 'livelihood'].includes(article.category);
    case 'media': return article.sourceGroup === 'media';
    case 'theory': return article.sourceGroup === 'theory' || article.category === 'theory';
    default: return true;
  }
}

function searchScore(article, query) {
  const title = normalize(article.title);
  const tags = normalize((article.tags || []).join(' '));
  const region = normalize(article.region || '');
  const excerpt = normalize(article.excerpt || '');
  let score = 0;
  if (title === query) score += 200;
  else if (title.startsWith(query)) score += 120;
  else if (title.includes(query)) score += 100;
  if (tags.includes(query)) score += 40;
  if (region.includes(query)) score += 30;
  if (excerpt.includes(query)) score += 8;
  return score;
}

function filteredArticles() {
  const query = normalize(state.query);
  let items = state.data.articles.filter((article) => articleMatchesFilter(article, state.filter));
  if (query) {
    items = items.filter((article) => normalize([
      article.title, article.source, article.excerpt, article.region,
      categoryLabel(article), ...(article.tags || []),
    ].join(' ')).includes(query));
  }
  if (query) {
    items = [...items].sort((a, b) => searchScore(b, query) - searchScore(a, query) || (b.date || '').localeCompare(a.date || '') || (b.heat || 0) - (a.heat || 0));
  } else if (state.sort === 'heat') {
    items = [...items].sort((a, b) => (b.heat || 0) - (a.heat || 0) || (b.date || '').localeCompare(a.date || ''));
  } else {
    items = [...items].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.heat || 0) - (a.heat || 0));
  }
  return items;
}

function renderStream() {
  const list = $('#streamList');
  if (!list) return;
  const items = filteredArticles();
  const visible = items.slice(0, state.visible);

  if (!items.length) {
    list.innerHTML = `<div class="local-empty">没有匹配“${esc(state.query || FILTER_LABELS[state.filter])}”的要闻。<button class="text-link" type="button" data-reset-search>清除筛选</button></div>`;
  } else {
    list.innerHTML = visible.map((article, index) => {
      const excerpt = article.excerpt ? `<p class="story__excerpt">${esc(article.excerpt)}</p>` : '';
      const tags = (article.tags || []).slice(0, 3).map((tag) => `<span>${esc(tag)}</span>`).join('');
      return `<article class="story">
        <div class="story__rank">${String(index + 1).padStart(2, '0')}</div>
        <div class="story__body">
          <div class="story__meta">
            <i class="source-dot" style="--accent:${safeColor(article.accent)}"></i>
            <span class="source-name">${esc(article.sourceShort || article.source)}</span>
            <span class="dot-sep"></span>
            <time datetime="${esc(article.date)}">${esc(shortDate(article.date))}</time>
            <span class="story__cat">${esc(categoryLabel(article))}</span>
            ${article.region && article.region !== '全国' ? `<span class="story__cat">${esc(article.region)}</span>` : ''}
          </div>
          <h3 class="story__title"><a href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer">${esc(article.title)}</a></h3>
          ${excerpt}
          ${tags ? `<div class="story__tags">${tags}</div>` : ''}
        </div>
        <div class="story__actions">
          <a class="story__open" href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer" aria-label="阅读原文" title="阅读原文"><svg class="i"><use href="#i-arrow"></use></svg></a>
          <button class="story__ask" type="button" data-ask-id="${esc(article.id)}" aria-label="就这条问 AI" title="就这条问 AI">AI</button>
        </div>
      </article>`;
    }).join('');
  }

  const more = $('#loadMore');
  if (more) {
    const remaining = Math.max(0, items.length - visible.length);
    more.hidden = remaining === 0;
    more.innerHTML = `展开更多要闻（剩余 ${remaining} 条）<span>+</span>`;
  }

  $$('#filterChips button').forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const sort = $('#sortBtn');
  if (sort) sort.innerHTML = `${state.sort === 'heat' ? '热度' : '最新'} <svg class="i"><use href="#i-chevron"></use></svg>`;
}

function renderKeywords() {
  const cloud = $('#keywordCloud');
  if (!cloud) return;
  const keywords = (state.data.stats.keywords || []).slice(0, 10);
  if (!keywords.length) {
    cloud.innerHTML = '<span class="fineprint">今日暂未形成集中关键词。</span>';
    return;
  }
  const max = Math.max(...keywords.map((item) => item.count), 1);
  cloud.innerHTML = keywords.map((item) => {
    const weight = item.count >= max * .72 ? 3 : item.count >= max * .4 ? 2 : 1;
    return `<button type="button" data-kw="${esc(item.name)}" data-weight="${weight}">${esc(item.name)} <small>${esc(item.count)}</small></button>`;
  }).join('');
}

function renderCoverage() {
  const node = $('#coverageCard');
  if (!node) return;
  const { stats } = state.data;
  const pct = Math.round((stats.sources / Math.max(1, stats.sourceTotal)) * 100);
  const categoryCounts = (stats.categories || []).slice(0, 4);
  const max = Math.max(...categoryCounts.map((item) => item.count), 1);
  node.innerHTML = `<div class="coverage-ring-wrap">
      <div class="coverage-ring" style="--pct:${pct}"><strong>${pct}<small>%</small></strong></div>
      <div class="coverage-copy"><strong>${stats.sources} 个源在线</strong><span>覆盖 ${stats.regions} 个地区<br>${stats.trends} 条时政热搜</span></div>
    </div>
    <div class="coverage-bars">${categoryCounts.map((item) => (
      `<div class="coverage-bar"><span>${esc(CATEGORY_LABELS[item.name] || item.name)}</span><i><b style="width:${Math.round((item.count / max) * 100)}%"></b></i><em>${item.count}</em></div>`
    )).join('')}</div>`;
}

/* ---------- local ---------- */

function renderLocal() {
  const list = $('#localList');
  if (!list) return;
  const items = state.data.articles
    .filter((article) => article.region !== '全国' || ['local', 'livelihood'].includes(article.category))
    .slice(0, 6);
  if (!items.length) {
    list.innerHTML = '<div class="local-empty">今日地方政务动态暂未更新，可从右侧省份直通车进入官网查看。</div>';
    return;
  }
  list.innerHTML = items.map((article) => {
    const parts = dateParts(article.date);
    return `<a class="local-item" href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer">
      <span class="local-date"><strong>${esc(parts.day || '—')}</strong>${esc(parts.month)}月</span>
      <span class="local-copy"><h3>${esc(article.title)}</h3><p><b>${esc(article.region || article.sourceShort)}</b> · ${esc(article.source)} · ${esc(shortDate(article.date))}</p></span>
      <svg class="i"><use href="#i-arrow"></use></svg>
    </a>`;
  }).join('');
}

/* ---------- qiushi ---------- */

function renderQiushi() {
  const theory = state.data.articles
    .filter((article) => article.sourceGroup === 'theory' || article.category === 'theory')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const lead = theory[0];
  const leadNode = $('#qiushiLead');
  if (leadNode) {
    leadNode.innerHTML = lead ? `
      <div class="qiushi-lead__meta"><span class="tag">理论</span><span>${esc(lead.source)}</span><span>·</span><span>${esc(longDate(lead.date))}</span></div>
      <h3><a href="${safeUrl(lead.url)}" target="_blank" rel="noopener noreferrer">${esc(lead.title)}</a></h3>
      <p>${esc(lead.excerpt || '理论文章摘要暂未抓取，点击进入求是网阅读全文。')}</p>
      <a class="qiushi-lead__link" href="${safeUrl(lead.url)}" target="_blank" rel="noopener noreferrer">阅读求是原文 <svg class="i"><use href="#i-arrow"></use></svg></a>
    ` : `<div class="qiushi-lead__meta"><span class="tag">理论</span><span>求是网</span></div>
      <h3><a href="https://www.qstheory.cn/" target="_blank" rel="noopener noreferrer">求是网今日理论文章</a></h3>
      <p>实时理论文章暂未进入样本，可通过求是网入口查看最新发布。</p>`;
  }
  const rest = theory.filter((item) => item.id !== lead?.id).slice(0, 4);
  $('#qiushiList').innerHTML = rest.map((article, index) => (
    `<article class="qiushi-item"><span class="num">${String(index + 2).padStart(2, '0')}</span><div><h4><a href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer">${esc(article.title)}</a></h4><p>${esc(article.source)} · ${esc(shortDate(article.date))}</p></div></article>`
  )).join('') || '<div class="qiushi-item"><span class="num">02</span><div><h4><a href="https://www.qstheory.cn/qs/" target="_blank" rel="noopener noreferrer">进入求是杂志电子版</a></h4><p>求是杂志社</p></div></div>';

  $('#theoryLinks').innerHTML = state.data.directory.theory.map((item) => (
    `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.name)}</a>`
  )).join('');
}

/* ---------- source matrix ---------- */

function sourceMatchesGroup(source, group) {
  if (group === 'all') return true;
  if (group === 'central') return ['central', 'policy'].includes(source.group);
  return source.group === group;
}

function renderMatrix() {
  const sources = state.data.directory.liveSources.filter((source) => sourceMatchesGroup(source, state.matrix));
  $('#sourceMatrix').innerHTML = sources.map((source) => {
    const status = source.ok ? '在线' : '失败';
    return `<a class="source-card" href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer" style="--accent:${safeColor(source.accent)}">
      <div class="source-card__top"><span class="source-mark">${esc(source.short.slice(0, 1))}</span><span class="status-dot ${source.ok ? 'is-ok' : 'is-fail'}">${status}</span></div>
      <h3>${esc(source.name)}</h3>
      <p>${esc(source.note || '官方信息发布')}</p>
      <div class="source-card__foot"><span>${source.count} 条 · ${source.latency}ms</span><svg class="i"><use href="#i-arrow"></use></svg></div>
    </a>`;
  }).join('');

  $$('#matrixTabs button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.matrix === state.matrix);
  });

  const directory = state.data.directory;
  let extra = [];
  if (state.matrix === 'local') extra = directory.provinces.slice(0, 12).map((item) => ({ ...item, org: '省级政府' }));
  else if (state.matrix === 'central') extra = directory.ministries.slice(0, 10).map((item) => ({ ...item, org: '国务院部委' }));
  else if (state.matrix === 'theory') extra = directory.theory;
  else if (state.matrix === 'media') extra = directory.media;
  else extra = [...directory.media.slice(0, 7), ...directory.theory.slice(0, 3)];
  $('#sourceExtra').innerHTML = `<span class="mono">直达入口</span>${extra.map((item) => (
    `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.name)} <span>${esc(item.org || '官网')} ↗</span></a>`
  )).join('')}`;
}

/* ---------- bloggers & trends ---------- */

function renderBloggers() {
  const grid = $('#bloggerGrid');
  if (!grid) return;
  grid.innerHTML = state.data.bloggers.map((blogger) => (
    `<article class="blogger-card">
      <div class="blogger-card__top">
        <span class="blogger-avatar" style="background:${safeColor(blogger.accent)}">${esc(blogger.initials || blogger.name.slice(0, 1))}</span>
        <span><span class="blogger-name">${esc(blogger.name)}</span><span class="blogger-org">${esc(blogger.org)}</span></span>
      </div>
      <p class="blogger-angle">${esc(blogger.angle)}</p>
      <div class="blogger-links">
        <a href="${safeUrl(blogger.weiboUrl)}" target="_blank" rel="noopener noreferrer"><svg class="i"><use href="#i-weibo"></use></svg>微博检索</a>
        <a href="${safeUrl(blogger.wechatUrl)}" target="_blank" rel="noopener noreferrer"><svg class="i"><use href="#i-wechat"></use></svg>微信检索</a>
      </div>
    </article>`
  )).join('');
}

function renderTrends() {
  const trends = state.data.trends || [];
  const list = $('#trendList');
  list.innerHTML = trends.slice(0, 8).map((trend) => (
    `<li class="trend-item"><span class="num">${String(trend.rank || 0).padStart(2, '0')}</span><a href="${safeUrl(trend.url)}" target="_blank" rel="noopener noreferrer">${esc(trend.word)}</a><span class="heat">${esc(trend.label || trend.note || '热搜')}</span></li>`
  )).join('') || '<li class="trend-item"><span class="num">--</span><span class="trend-note">当前榜单未返回时政相关词条。</span></li>';
  $('#trendUpdate').textContent = `${trends.length} 条`;

  const keywords = (state.data.stats.keywords || []).slice(0, 8);
  const fallback = $('#trendFallback');
  if (trends.length < 4) {
    fallback.innerHTML = `<div class="trend-fallback__label">站内高频词 · 非平台热搜</div>
      <div class="keyword-cloud">${keywords.map((item) => `<button type="button" data-kw="${esc(item.name)}" data-weight="2">${esc(item.name)} <small>${item.count}</small></button>`).join('')}</div>
      <p class="trend-note">微博实时榜单中时政词条较少，因此补充站内信源高频词，二者不可等同。</p>`;
  } else {
    fallback.innerHTML = '';
  }
}

/* ---------- video ---------- */

function renderVideo() {
  const { video, video: videoData } = state.data;
  const live = $('#videoLive');
  const topicsData = state.video === 'bilibili' ? videoData.bilibiliTopics : videoData.xhsTopics;

  if (state.video === 'bilibili') {
    const items = videoData.bilibili || [];
    live.innerHTML = items.length ? items.map((item) => {
      const cover = safeCover(item.cover);
      const noCover = !cover || /transparent\.gif/i.test(cover);
      const badge = item.trusted ? '权威账号' : '平台视频';
      return `<article class="video-card">
        <a class="video-cover${noCover ? ' is-empty' : ''}" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">
          ${!noCover ? `<img src="${cover}" alt="" referrerpolicy="no-referrer">` : ''}
          <span class="video-badge">${badge} · 需核验</span>
          <span class="video-play"><svg class="i"><use href="#i-play"></use></svg></span>
          ${item.duration ? `<span class="video-duration">${esc(item.duration)}</span>` : ''}
        </a>
        <div class="video-body"><h3><a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></h3>
        <div class="video-meta"><span class="author">${esc(item.author)}</span><span>${esc(item.play)} 播放</span></div></div>
      </article>`;
    }).join('') : `<div class="video-empty">B 站实时检索暂未返回 30 天内的合适结果。<br><a class="text-link" href="https://search.bilibili.com/all?keyword=${encodeURIComponent('新闻联播 今日')}" target="_blank" rel="noopener noreferrer">直接进入 B 站检索 <span>↗</span></a></div>`;
  } else {
    live.innerHTML = `<div class="video-empty">小红书搜索页需要登录，本站不抓取、不镜像其内容。<br>请通过下方主题与政务号入口，在小红书内完成检索与核验。<br><a class="text-link" href="https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent('市政观察')}" target="_blank" rel="noopener noreferrer">打开小红书检索 <span>↗</span></a></div>`;
  }

  $('#videoTopics').innerHTML = topicsData.map((topic, index) => (
    `<a class="topic-card" href="${safeUrl(topic.url)}" target="_blank" rel="noopener noreferrer">
      <span class="topic-card__num">0${index + 1} / ${esc(topic.tag || 'TOPIC')}</span>
      <h3>${esc(topic.title)}</h3>
      <p>${esc(topic.desc)}</p>
      <span class="topic-card__link">在${state.video === 'bilibili' ? ' B 站' : '小红书'}检索 <svg class="i"><use href="#i-arrow"></use></svg></span>
    </a>`
  )).join('');

  const accounts = videoData.accounts.filter((account) => account.platform === state.video);
  $('#videoAccounts').innerHTML = `<span class="mono">政务号检索</span>${accounts.map((account) => (
    `<a href="${safeUrl(account.url)}" target="_blank" rel="noopener noreferrer">${esc(account.name)} <span>↗</span></a>`
  )).join('')}`;
  $('#videoNote').textContent = state.video === 'bilibili'
    ? 'B 站视频由公开检索结果提供，含平台创作者内容，不代表本站立场；涉及政策表述请以原文和权威发布为准。'
    : '小红书内容需登录访问，本站仅提供主题与政务号检索入口，不抓取、不镜像帖子。';
  $$('#videoTabs button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.video === state.video);
  });
}

/* ---------- directory & health ---------- */

function directoryLink(item, suffix = '') {
  return `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.name)}<span>${esc(suffix || item.org || '官网')} ↗</span></a>`;
}

function renderDirectory() {
  const directory = state.data.directory;
  $('#ministryGrid').innerHTML = directory.ministries.map((item) => directoryLink(item, '部委')).join('');
  $('#provinceDirectory').innerHTML = directory.provinces.map((item) => directoryLink(item, '政府')).join('');
  $('#mediaDirectory').innerHTML = directory.media.map((item) => directoryLink(item, item.org)).join('');
  $('#theoryDirectory').innerHTML = directory.theory.map((item) => directoryLink(item, item.org)).join('');
}

function renderHealth() {
  const status = state.data.status || [];
  const ok = status.filter((item) => item.ok).length;
  $('#healthSummary').textContent = `${ok} / ${status.length}`;
  $('#healthTable').innerHTML = `<div class="health-row health-row--head"><span>信源</span><span>条数</span><span>延迟</span><span>状态</span><span></span></div>` + status.map((item) => (
    `<div class="health-row">
      <a class="name" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" title="${esc(item.name)}">${esc(item.name)}</a>
      <span class="count">${item.count}</span>
      <span class="latency">${item.latency}ms</span>
      <span class="state ${item.ok ? 'ok' : 'fail'}">${item.ok ? 'OK' : 'FAIL'}</span>
      <a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="打开${esc(item.name)}"><svg class="i"><use href="#i-arrow"></use></svg></a>
    </div>`
  )).join('');

  const top = [...status].sort((a, b) => b.count - a.count).slice(0, 4);
  const max = Math.max(...top.map((item) => item.count), 1);
  $('#healthBars').innerHTML = top.map((item) => (
    `<div class="coverage-bar"><span>${esc(item.short)}</span><i><b style="width:${Math.round((item.count / max) * 100)}%"></b></i><em>${item.count}</em></div>`
  )).join('');
}

/* ---------- brief ---------- */

function briefHtml(brief) {
  const stats = [
    { value: state.data.stats.articles, label: '总入库' },
    { value: state.data.stats.today, label: '今日更新' },
    { value: state.data.stats.sources, label: '有效信源' },
    { value: state.data.stats.local, label: '地方条数' },
  ];
  const mainlines = (brief.mainlines || []).map((line) => {
    const links = (line.articleIds || []).map(articleById).filter(Boolean);
    return `<div class="brief-line">
      <span class="n">${esc(line.no)}</span>
      <div><h4>${esc(line.title)} <span class="mono">${esc(line.count)} 条</span></h4>
        <p>${esc(line.text)}</p>
        <div class="brief-line__sources">${links.map((article) => `<a href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer">${esc(article.sourceShort || article.source)} · 原文 ↗</a>`).join('')}</div>
      </div>
    </div>`;
  }).join('');

  const signals = (brief.signals || []).map((signal, index) => {
    const article = articleById(signal.articleId);
    return `<div class="brief-signal-row"><strong>${String(index + 1).padStart(2, '0')} · ${esc(signal.title)}</strong>
      <p>${esc(signal.meaning)}</p>
      ${article ? `<a href="${safeUrl(article.url)}" target="_blank" rel="noopener noreferrer">${esc(article.source)} · ${esc(shortDate(article.date))} · 核原文 ↗</a>` : ''}
    </div>`;
  }).join('');

  return `<p class="brief-lead">${esc(brief.summary)}</p>
    <div class="brief-stats">${stats.map((item) => `<div class="brief-stat"><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join('')}</div>
    <div class="brief-block"><div class="brief-block__head"><span class="mono">01</span><h3>三条主线</h3></div>${mainlines}</div>
    <div class="brief-block"><div class="brief-block__head"><span class="mono">02</span><h3>政策信号与含义</h3></div>${signals || '<p class="fineprint">今日暂未识别出集中政策信号。</p>'}</div>
    <div class="brief-block"><div class="brief-block__head"><span class="mono">03</span><h3>高频议题</h3></div>
      <div class="brief-keywords">${(state.data.stats.keywords || []).slice(0, 10).map((item) => `<span>${esc(item.name)}<b>${esc(item.count)}</b></span>`).join('')}</div>
    </div>
    <div class="brief-block"><div class="brief-block__head"><span class="mono">04</span><h3>研判提示</h3></div>
      <ul class="brief-outlook">${(brief.outlook || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
    </div>
    <p class="brief-disclaimer">本简报由站内信源标题、摘要与来源结构自动生成，阅读时间约 ${esc(brief.readTime || 3)} 分钟。它不替代原文、权威解读或政策文件；涉及政策表述、数据与人事信息，请点击“原文”回溯核验。生成时间：${esc(new Date(brief.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))}。</p>`;
}

function renderBrief() {
  $('#briefModalBody').innerHTML = briefHtml(state.data.brief);
}

function briefMarkdown() {
  const { brief, stats, meta } = state.data;
  const lines = [
    `# 时观 · ${brief.title}`,
    '',
    `> 期号：${brief.issue} ｜ 生成：${meta.dateLabel} ${meta.timeLabel} ｜ 有效信源：${stats.sources}/${stats.sourceTotal}`,
    '',
    '## 摘要',
    '',
    brief.summary,
    '',
    '## 数据概览',
    '',
    `- 总入库：${stats.articles} 条`,
    `- 今日更新：${stats.today} 条`,
    `- 地方动态：${stats.local} 条`,
    `- 覆盖地区：${stats.regions} 个`,
    '',
    '## 三条主线',
    '',
  ];
  for (const line of brief.mainlines || []) {
    lines.push(`### ${line.no} ${line.title}（${line.count} 条）`, '', line.text, '');
    for (const id of line.articleIds || []) {
      const article = articleById(id);
      if (article) lines.push(`- [${article.title}](${article.url}) — ${article.source}，${article.date}`);
    }
    lines.push('');
  }
  lines.push('## 政策信号与含义', '');
  for (const signal of brief.signals || []) {
    lines.push(`- **${signal.title}**：${signal.meaning}`);
  }
  lines.push('', '## 高频议题', '', (stats.keywords || []).slice(0, 12).map((item) => `${item.name}（${item.count}）`).join(' · '), '');
  lines.push('## 研判提示', '');
  for (const item of brief.outlook || []) lines.push(`- ${item}`);
  lines.push('', '## 信源样本', '');
  for (const article of state.data.articles.slice(0, 20)) {
    lines.push(`- [${article.title}](${article.url}) — ${article.source}，${article.date}`);
  }
  lines.push('', '---', '', '本简报由站内信源自动生成，不替代原文与权威解读；重要表述、数据和人事信息请回溯原文。');
  return lines.join('\n');
}

/* ---------- AI suggestions ---------- */

function suggestionList() {
  const keywords = state.data?.stats?.keywords || [];
  const first = keywords[0]?.name;
  return [
    '今天国务院有哪些政策信号？',
    first ? `“${first}”在今日报道中如何呈现？` : '把今日要闻按三条主线梳理',
    '地方层面有哪些值得关注的治理动作？',
    '求是杂志今天关注什么理论议题？',
  ];
}

function renderAskSuggestions() {
  const list = suggestionList();
  $('#askSuggestions').innerHTML = list.map((text) => `<button type="button" data-suggest="${esc(text)}">${esc(text)}</button>`).join('');
  $('#aiStarters').innerHTML = list.map((text, index) => `<button type="button" data-suggest="${esc(text)}"><span>0${index + 1}</span>${esc(text)}</button>`).join('');
}

/* ---------- drawer / modal ---------- */

function lockBody() {
  const locked = !$('#aiLayer').hidden || !$('#briefLayer').hidden;
  document.body.classList.toggle('is-locked', locked);
}

function openAI(question = '', autoSubmit = false) {
  state.lastFocus = document.activeElement;
  const layer = $('#aiLayer');
  layer.hidden = false;
  lockBody();
  if (question) $('#aiInput').value = question;
  setTimeout(() => $('#aiInput').focus(), 80);
  if (autoSubmit && question) setTimeout(() => sendQuestion(question), 160);
}

function closeAI() {
  $('#aiLayer').hidden = true;
  lockBody();
  state.lastFocus?.focus?.();
}

function openBrief() {
  state.lastFocus = document.activeElement;
  $('#briefLayer').hidden = false;
  lockBody();
  setTimeout(() => $('#briefLayer .brief-modal')?.focus?.(), 80);
}

function closeBrief() {
  $('#briefLayer').hidden = true;
  lockBody();
  state.lastFocus?.focus?.();
}

function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const layer = !$('#aiLayer').hidden ? $('#aiLayer') : !$('#briefLayer').hidden ? $('#briefLayer') : null;
  if (!layer) return;
  const focusable = $$('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])', layer)
    .filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ---------- AI answer rendering ---------- */

function renderMarkdown(text, messageId) {
  const source = String(text || '').trim();
  if (!source) return '<p>暂未生成回答。</p>';
  const lines = source.split(/\r?\n/);
  const output = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      output.push('</ul>');
      listOpen = false;
    }
  };

  const inline = (line) => esc(line)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(\d{1,2})\]/g, (match, number) => (
      `<a class="cite-ref" href="#cite-${messageId}-${number}" data-cite="${number}">[${number}]</a>`
    ));

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^[-•]\s+/.test(line)) {
      if (!listOpen) {
        output.push('<ul>');
        listOpen = true;
      }
      output.push(`<li>${inline(line.replace(/^[-•]\s+/, ''))}</li>`);
      continue;
    }
    closeList();
    const heading = /^\*\*([^*]+)\*\*$/.exec(line);
    if (heading) {
      output.push(`<h4>${esc(heading[1])}</h4>`);
    } else {
      output.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return output.join('');
}

function citationsHtml(citations, messageId) {
  if (!Array.isArray(citations) || !citations.length) return '';
  return `<div class="msg__cites"><div class="msg__cites-label">CITATIONS / 点击核验原文</div>${citations.map((citation) => (
    `<a class="cite-item" id="cite-${messageId}-${citation.no}" href="${safeUrl(citation.url)}" target="_blank" rel="noopener noreferrer">
      <span class="n">${String(citation.no).padStart(2, '0')}</span>
      <span><span class="t">${esc(citation.title)}</span><span class="s">${esc(citation.source)} · ${esc(citation.date)}</span></span>
      <svg class="i"><use href="#i-arrow"></use></svg>
    </a>`
  )).join('')}</div>`;
}

function followupsHtml(followups) {
  if (!Array.isArray(followups) || !followups.length) return '';
  return `<div class="msg__followups">${followups.map((item) => `<button type="button" data-suggest="${esc(item)}">${esc(item)}</button>`).join('')}</div>`;
}

function assistantMessageHtml(payload, messageId) {
  const engineLabel = payload.engine === 'deepseek' ? 'DEEPSEEK 辅助' : 'LOCAL RAG';
  return `<div class="msg__bubble">
    <div class="msg__role"><span class="ai-mini">时观</span><span>检索回答</span><span>·</span><span>${esc(engineLabel)}</span></div>
    <div class="msg__text">${renderMarkdown(payload.answer, messageId)}</div>
    ${citationsHtml(payload.citations, messageId)}
    ${followupsHtml(payload.followups)}
    <div class="msg__note">基于站内 ${esc(payload.scope?.articles ?? state.data?.stats.articles ?? '—')} 条信源检索。回答仅作线索，不替代原文与权威解读。</div>
  </div>`;
}

async function sendQuestion(rawQuestion) {
  const question = String(rawQuestion || '').trim().slice(0, 300);
  if (!question || state.aiBusy) return;

  if ($('#aiLayer').hidden) openAI();
  const messages = $('#aiMessages');
  $('.ai-welcome')?.remove();

  const userId = `u${Date.now()}`;
  messages.insertAdjacentHTML('beforeend', `<div class="msg msg--user" id="${userId}"><div class="msg__bubble">${esc(question).replace(/\n/g, '<br>')}</div></div>`);

  const messageId = `a${Date.now()}`;
  messages.insertAdjacentHTML('beforeend', `<div class="msg msg--assistant" id="${messageId}"><div class="msg__bubble"><div class="msg__role"><span class="ai-mini">时观</span><span>正在检索站内信源</span></div><div class="typing" aria-label="正在生成"><i></i><i></i><i></i></div></div></div>`);

  const input = $('#aiInput');
  input.value = '';
  state.aiBusy = true;
  const submit = $('#aiForm button[type="submit"]');
  if (submit) submit.disabled = true;
  messages.scrollTop = messages.scrollHeight;

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload.answer) throw new Error('回答为空');
    const node = document.getElementById(messageId);
    if (node) {
      node.innerHTML = assistantMessageHtml(payload, messageId);
      const top = node.getBoundingClientRect().top - messages.getBoundingClientRect().top + messages.scrollTop;
      messages.scrollTop = Math.max(0, top - 8);
    }
  } catch (error) {
    console.error('[shiguan] ask failed', error);
    const node = document.getElementById(messageId);
    if (node) {
      node.innerHTML = `<div class="msg__bubble"><div class="msg__role"><span class="ai-mini">时观</span><span>检索未完成</span></div><div class="msg__text"><p>${esc(error?.message || '问答服务暂时不可用')}</p><p>请确认本地服务运行正常，或改用上方搜索框筛选今日信源。</p></div></div>`;
    }
  } finally {
    state.aiBusy = false;
    if (submit) submit.disabled = false;
    input.focus();
  }
}

/* ---------- copy & download ---------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('已复制到剪贴板');
    } catch {
      toast('复制失败，请手动选择文本');
    }
    area.remove();
  }
}

function downloadMarkdown() {
  if (!state.data) return;
  const blob = new Blob([briefMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `时观-每日简报-${state.data.meta.today}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('Markdown 简报已导出');
}

/* ---------- interactions ---------- */

function resetSearch() {
  state.query = '';
  state.filter = 'all';
  state.visible = 8;
  $('#searchInput').value = '';
  $('#searchClear').hidden = true;
  renderStream();
}

function applyKeyword(keyword) {
  state.query = keyword;
  state.filter = 'all';
  state.visible = 12;
  $('#searchInput').value = keyword;
  $('#searchClear').hidden = false;
  renderStream();
  $('#stream').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindEvents() {
  $('#refreshBtn')?.addEventListener('click', () => loadData({ refresh: true }));

  $('#searchForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('#searchInput').value.trim();
    if (!query) return;
    state.query = query;
    state.filter = 'all';
    state.visible = 12;
    renderStream();
    document.querySelector('#stream')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#searchInput')?.addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    if (state.query) state.filter = 'all';
    state.visible = 8;
    $('#searchClear').hidden = !state.query;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(renderStream, 120);
  });

  $('#searchClear')?.addEventListener('click', resetSearch);

  $('#filterChips')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    state.visible = 8;
    renderStream();
  });

  $('#sortBtn')?.addEventListener('click', () => {
    state.sort = state.sort === 'latest' ? 'heat' : 'latest';
    state.visible = 8;
    renderStream();
    toast(state.sort === 'heat' ? '已按站内热度排序' : '已按发布时间排序');
  });

  $('#loadMore')?.addEventListener('click', () => {
    state.visible = Math.min(state.visible + 8, 40);
    renderStream();
  });

  $('#streamList')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-reset-search]')) {
      resetSearch();
      return;
    }
    const ask = event.target.closest('[data-ask-id]');
    if (ask) {
      const article = articleById(ask.dataset.askId);
      if (article) openAI(`请解读这条报道的核心信息与政策信号：${article.title}`, true);
    }
  });

  $('#frontLines')?.addEventListener('click', (event) => {
    const line = event.target.closest('[data-line]');
    if (!line) return;
    state.filter = line.dataset.line;
    state.visible = 8;
    renderStream();
  });

  document.addEventListener('click', (event) => {
    const keyword = event.target.closest('[data-kw]');
    if (keyword) {
      applyKeyword(keyword.dataset.kw);
      return;
    }
    const askHero = event.target.closest('[data-ask-hero]');
    if (askHero) {
      const article = state.data?.hero || state.data?.articles?.[0];
      if (article) openAI(`请解读今日头条《${article.title}》的核心信息、政策背景与需要核验的要点。`, true);
      return;
    }
    if (event.target.closest('[data-open-ai]')) {
      openAI();
      return;
    }
    if (event.target.closest('[data-open-brief]')) {
      openBrief();
      return;
    }
    if (event.target.closest('[data-close-ai]')) {
      closeAI();
      return;
    }
    if (event.target.closest('[data-close-brief]')) {
      closeBrief();
      return;
    }
    const suggest = event.target.closest('[data-suggest]');
    if (suggest) {
      openAI(suggest.dataset.suggest, true);
    }
  });

  $('#matrixTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-matrix]');
    if (!button) return;
    state.matrix = button.dataset.matrix;
    renderMatrix();
  });

  $('#videoTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-video]');
    if (!button) return;
    state.video = button.dataset.video;
    renderVideo();
  });

  $('#provinceToggle')?.addEventListener('click', () => {
    state.provinceExpanded = !state.provinceExpanded;
    $('#provinceGrid').classList.toggle('is-collapsed', !state.provinceExpanded);
    $('#provinceToggle').innerHTML = state.provinceExpanded ? '收起省份 <span>−</span>' : '展开全部省份 <span>+</span>';
  });

  $('#exportBrief')?.addEventListener('click', openBrief);
  $('#copyBrief')?.addEventListener('click', () => {
    if (state.data) copyText(state.data.brief.summary);
  });
  $('#downloadBrief')?.addEventListener('click', downloadMarkdown);

  $('#aiForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendQuestion($('#aiInput').value);
  });

  $('#aiInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendQuestion(event.target.value);
    }
  });

  $('#menuBtn')?.addEventListener('click', () => {
    const menu = $('#mobileMenu');
    const open = menu.hidden;
    menu.hidden = !open;
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  });

  $('#mobileMenu')?.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      $('#mobileMenu').hidden = true;
      $('#menuBtn').setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    trapFocus(event);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openAI();
      return;
    }
    if (event.key === 'Escape') {
      if (!$('#aiLayer').hidden) closeAI();
      else if (!$('#briefLayer').hidden) closeBrief();
      else if (document.activeElement === $('#searchInput') && $('#searchInput').value) resetSearch();
      else if (!$('#mobileMenu').hidden) {
        $('#mobileMenu').hidden = true;
        $('#menuBtn').setAttribute('aria-expanded', 'false');
      }
    }
  });

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-inview');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    $$('.reveal').forEach((node) => revealObserver.observe(node));
  }
}

/* ---------- boot ---------- */

function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  bindEvents();
  loadData();
  state.refreshTimer = setInterval(() => {
    if (!document.hidden && !state.loading) loadData({ silent: true });
  }, 120_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.loading) tickClock();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
