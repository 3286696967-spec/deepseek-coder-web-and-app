import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.resolve('public');
const CACHE_TTL = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 18_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FALLBACK_AT = '2026-11-02T09:30:00+08:00';

const CATEGORY_LABELS = {
  central: '中央部署',
  policy: '政策发布',
  economy: '经济产业',
  livelihood: '民生社会',
  local: '地方治理',
  theory: '理论求是',
  diplomacy: '国际外交',
  culture: '文化科技',
  other: '综合',
};

const SOURCE_DEFS = [
  {
    id: 'gov', name: '中国政府网', short: '国务院', group: 'central', region: '全国',
    url: 'https://www.gov.cn/yaowen/liebiao/', accent: '#b42318', priority: 100,
    parser: govJson, note: '国务院要闻与中央部署',
  },
  {
    id: 'policy', name: '国务院政策文件库', short: '政策', group: 'policy', region: '全国',
    url: 'https://www.gov.cn/zhengce/zuixin/', accent: '#8f1d14', priority: 105,
    parser: govPolicy, note: '最新政策文件与解读',
  },
  {
    id: 'xinhua', name: '新华网', short: '新华', group: 'media', region: '全国',
    url: 'https://www.news.cn/politics/', accent: '#c03a2b', priority: 90,
    parser: (def) => generic(def, 'https://www.news.cn/politics/', /\/2026\d{4}\//, 24), note: '国家通讯社时政频道',
  },
  {
    id: 'people', name: '人民日报', short: '人民', group: 'media', region: '全国',
    url: 'https://www.people.com.cn/', accent: '#aa2f25', priority: 88,
    parser: peoplePaper, note: '人民日报当日头版',
  },
  {
    id: 'cctv', name: '央视网', short: '央视', group: 'media', region: '全国',
    url: 'https://news.cctv.com/', accent: '#275fa8', priority: 84,
    parser: (def) => generic(def, 'https://news.cctv.com/', /\/2026\//, 20), note: '央视新闻时政',
  },
  {
    id: 'qiushi', name: '求是网', short: '求是', group: 'theory', region: '全国',
    url: 'https://www.qstheory.cn/', accent: '#7d1a13', priority: 86,
    parser: (def) => generic(def, 'https://www.qstheory.cn/', /\/2026\d{4}\//, 22), note: '求是杂志与理论文章',
  },
  {
    id: 'guangming', name: '光明网', short: '光明', group: 'media', region: '全国',
    url: 'https://www.gmw.cn/', accent: '#2e6a4f', priority: 80,
    parser: (def) => generic(def, 'https://www.gmw.cn/', /\/2026-\d{2}\//, 22), note: '光明日报时政',
  },
  {
    id: 'chinanews', name: '中国新闻网', short: '中新', group: 'media', region: '全国',
    url: 'https://www.chinanews.com.cn/', accent: '#a06b22', priority: 78,
    parser: (def) => generic(def, 'https://www.chinanews.com.cn/', /\/2026\//, 22), note: '中新社时政',
  },
  {
    id: 'ce', name: '中国经济网', short: '经济', group: 'media', region: '全国',
    url: 'http://www.ce.cn/xwzx/gnsz/gdxw/', accent: '#23617f', priority: 76,
    parser: (def) => generic(def, 'http://www.ce.cn/xwzx/gnsz/gdxw/', /\/2026\d{2}\//, 20), note: '经济日报宏观经济',
  },
  {
    id: 'guancha', name: '观察者网', short: '观察', group: 'media', region: '全国',
    url: 'https://www.guancha.cn/ZhengZhi/list_1.shtml', accent: '#5d4936', priority: 68,
    parser: (def) => generic(def, 'https://www.guancha.cn/ZhengZhi/list_1.shtml', /\/2026_\d{2}_\d{2}_/, 20), note: '头部时政评论媒体',
  },
  {
    id: 'bj', name: '北京市人民政府', short: '北京', group: 'local', region: '北京',
    url: 'https://www.beijing.gov.cn/ywdt/gzdt/', accent: '#972f3b', priority: 74,
    parser: (def) => generic(def, 'https://www.beijing.gov.cn/ywdt/gzdt/', /\/2026\d{2}\/t2026/, 16), note: '首都政务动态',
  },
  {
    id: 'sh', name: '上海市人民政府', short: '上海', group: 'local', region: '上海',
    url: 'https://www.shanghai.gov.cn/nw4411/', accent: '#365d8a', priority: 74,
    parser: (def) => generic(def, 'https://www.shanghai.gov.cn/nw4411/', /\/2026\d{4}\//, 16), note: '上海政务动态',
  },
  {
    id: 'hubei', name: '湖北省人民政府', short: '湖北', group: 'local', region: '湖北',
    url: 'https://www.hubei.gov.cn/zwgk/hbyw/hbywqb/', accent: '#4d6b3a', priority: 70,
    parser: (def) => generic(def, 'https://www.hubei.gov.cn/zwgk/hbyw/hbywqb/', /\/2026\d{2}\/t2026/, 16), note: '中部地区政务动态',
  },
  {
    id: 'henan', name: '河南省人民政府', short: '河南', group: 'local', region: '河南',
    url: 'https://www.henan.gov.cn/ywdt/', accent: '#9b5a2b', priority: 70,
    parser: (def) => generic(def, 'https://www.henan.gov.cn/ywdt/', /\/2026\/\d{2}-\d{2}\//, 16), note: '中原地区政务动态',
  },
  {
    id: 'ah', name: '安徽省人民政府', short: '安徽', group: 'local', region: '安徽',
    url: 'https://www.ah.gov.cn/zwyw/jryw/index.html', accent: '#3f6b58', priority: 70,
    parser: (def) => generic(def, 'https://www.ah.gov.cn/zwyw/jryw/index.html', /\/zwyw\/jryw\/\d+\.html/, 16), note: '华东地区政务动态',
  },
  {
    id: 'cq', name: '重庆市人民政府', short: '重庆', group: 'local', region: '重庆',
    url: 'https://www.cq.gov.cn/ywdt/jrcq/', accent: '#8e3b32', priority: 70,
    parser: (def) => generic(def, 'https://www.cq.gov.cn/ywdt/jrcq/', /\/ywdt\/jrcq\/2026\d{2}\/t2026\d{4}_\d+\.html/, 16), note: '成渝地区政务动态',
  },
  {
    id: 'sx', name: '陕西省人民政府', short: '陕西', group: 'local', region: '陕西',
    url: 'https://www.shaanxi.gov.cn/xw/sxyw/', accent: '#83603a', priority: 70,
    parser: (def) => generic(def, 'https://www.shaanxi.gov.cn/xw/sxyw/', /\/xw\/sxyw\/2026\d{2}\/t2026\d{4}_\d+\.html/, 16), note: '西北地区政务动态',
  },
];

const PROVINCES = [
  ['北京', 'https://www.beijing.gov.cn/'], ['天津', 'https://www.tj.gov.cn/'],
  ['河北', 'http://www.hebei.gov.cn/'], ['山西', 'https://www.shanxi.gov.cn/'],
  ['内蒙古', 'https://www.nmg.gov.cn/'], ['辽宁', 'https://www.ln.gov.cn/'],
  ['吉林', 'http://www.jl.gov.cn/'], ['黑龙江', 'https://www.hlj.gov.cn/'],
  ['上海', 'https://www.shanghai.gov.cn/'], ['江苏', 'https://www.jiangsu.gov.cn/'],
  ['浙江', 'https://www.zj.gov.cn/'], ['安徽', 'https://www.ah.gov.cn/'],
  ['福建', 'https://www.fujian.gov.cn/'], ['江西', 'http://www.jiangxi.gov.cn/'],
  ['山东', 'http://www.shandong.gov.cn/'], ['河南', 'https://www.henan.gov.cn/'],
  ['湖北', 'https://www.hubei.gov.cn/'], ['湖南', 'https://www.hunan.gov.cn/'],
  ['广东', 'https://www.gd.gov.cn/'], ['广西', 'http://www.gxzf.gov.cn/'],
  ['海南', 'https://www.hainan.gov.cn/'], ['重庆', 'https://www.cq.gov.cn/'],
  ['四川', 'https://www.sc.gov.cn/'], ['贵州', 'https://www.guizhou.gov.cn/'],
  ['云南', 'https://www.yn.gov.cn/'], ['西藏', 'https://www.xizang.gov.cn/'],
  ['陕西', 'https://www.shaanxi.gov.cn/'], ['甘肃', 'https://www.gansu.gov.cn/'],
  ['青海', 'http://www.qinghai.gov.cn/'], ['宁夏', 'https://www.nx.gov.cn/'],
  ['新疆', 'https://www.xinjiang.gov.cn/'], ['香港', 'https://www.gov.hk/'],
  ['澳门', 'https://www.gov.mo/'],
].map(([name, url]) => ({ name, url }));

const MINISTRIES = [
  ['国家发展改革委', 'https://www.ndrc.gov.cn/'], ['外交部', 'https://www.mfa.gov.cn/'],
  ['教育部', 'http://www.moe.gov.cn/'], ['科技部', 'https://www.most.gov.cn/'],
  ['工业和信息化部', 'https://www.miit.gov.cn/'], ['财政部', 'https://www.mof.gov.cn/'],
  ['人力资源社会保障部', 'http://www.mohrss.gov.cn/'], ['自然资源部', 'https://www.mnr.gov.cn/'],
  ['生态环境部', 'https://www.mee.gov.cn/'], ['住房城乡建设部', 'https://www.mohurd.gov.cn/'],
  ['交通运输部', 'https://www.mot.gov.cn/'], ['水利部', 'http://www.mwr.gov.cn/'],
  ['农业农村部', 'http://www.moa.gov.cn/'], ['商务部', 'http://www.mofcom.gov.cn/'],
  ['文化和旅游部', 'https://www.mct.gov.cn/'], ['国家卫生健康委', 'http://www.nhc.gov.cn/'],
  ['应急管理部', 'https://www.mem.gov.cn/'], ['中国人民银行', 'http://www.pbc.gov.cn/'],
  ['国务院国资委', 'http://www.sasac.gov.cn/'], ['海关总署', 'http://www.customs.gov.cn/'],
  ['国家税务总局', 'https://www.chinatax.gov.cn/'], ['市场监管总局', 'https://www.samr.gov.cn/'],
  ['国家统计局', 'https://www.stats.gov.cn/'], ['国家医保局', 'http://www.nhsa.gov.cn/'],
  ['国务院新闻办', 'http://www.scio.gov.cn/'],
].map(([name, url]) => ({ name, url }));

const MEDIA_DIRECTORY = [
  ['新华网', 'https://www.news.cn/', '国家通讯社'], ['人民网', 'https://www.people.com.cn/', '人民日报社'],
  ['央视网', 'https://www.cctv.com/', '中央广播电视总台'], ['求是网', 'https://www.qstheory.cn/', '求是杂志社'],
  ['光明网', 'https://www.gmw.cn/', '光明日报社'], ['中国经济网', 'http://www.ce.cn/', '经济日报社'],
  ['中国新闻网', 'https://www.chinanews.com.cn/', '中国新闻社'], ['央广网', 'https://www.cnr.cn/', '中央广播电视总台'],
  ['中国日报网', 'https://www.chinadaily.com.cn/', '中国日报社'], ['澎湃新闻', 'https://www.thepaper.cn/', '上海报业集团'],
  ['观察者网', 'https://www.guancha.cn/', '时政评论'], ['北京日报', 'https://www.bjd.com.cn/', '北京市委机关报'],
  ['解放日报', 'https://www.jfdaily.com/', '上海市委机关报'], ['南方日报', 'https://www.southcn.com/', '广东省委机关报'],
].map(([name, url, org]) => ({ name, url, org }));

const THEORY_DIRECTORY = [
  ['求是杂志', 'https://www.qstheory.cn/qs/', '党中央机关刊'],
  ['人民日报理论版', 'http://theory.people.com.cn/', '人民日报'],
  ['光明日报理论', 'https://theory.gmw.cn/', '光明日报'],
  ['学习强国', 'https://www.xuexi.cn/', '中央宣传部'],
  ['中央党史和文献研究院', 'http://www.dswxyjy.org.cn/', '党中央直属机构'],
  ['中国社会科学网', 'http://www.cssn.cn/', '中国社科院'],
  ['国务院发展研究中心', 'https://www.drc.gov.cn/', '国务院直属机构'],
].map(([name, url, org]) => ({ name, url, org }));

const BLOGGERS = [
  { name: '玉渊谭天', org: '央视旗下时政评论', initials: '谭', angle: '外交与国际局势', accent: '#b42318' },
  { name: '牛弹琴', org: '资深媒体人', initials: '牛', angle: '国际时政解读', accent: '#8a5a28' },
  { name: '侠客岛', org: '人民日报海外版', initials: '岛', angle: '高层动态与政策信号', accent: '#a52d24' },
  { name: '长安街知事', org: '北京日报', initials: '知', angle: '人事与地方政务', accent: '#365d8a' },
  { name: '政知见', org: '北京青年报', initials: '政', angle: '时政现场与人事观察', accent: '#2e6a4f' },
  { name: '团结湖参考', org: '北京青年报', initials: '团', angle: '政情分析与公共议题', accent: '#72523a' },
  { name: '陶然笔记', org: '经济日报', initials: '陶', angle: '宏观经济与政策', accent: '#23617f' },
  { name: '补壹刀', org: '环球时报', initials: '刀', angle: '国际安全与舆论', accent: '#5b3b72' },
].map((item) => ({
  ...item,
  weiboUrl: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.name)}`,
  wechatUrl: `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(item.name)}`,
}));

const VIDEO_TOPICS = {
  bilibili: [
    { title: '新闻联播 · 今日', desc: '央视《新闻联播》当日要闻与地方报道', query: '新闻联播 今日', tag: '每日必看' },
    { title: '二十届五中全会', desc: '全会公报、权威解读与专家分析', query: '二十届五中全会 解读', tag: '中央部署' },
    { title: '城市治理现场', desc: '城市更新、基层治理与政务服务创新', query: '城市治理 现场', tag: '市政' },
    { title: '地方政府发布会', desc: '省级政府新闻发布与政策吹风', query: '地方政府 新闻发布会', tag: '政务' },
  ],
  xhs: [
    { title: '市政观察', desc: '城市建设、公共服务与治理细节', query: '市政观察', tag: '城市' },
    { title: '城市更新', desc: '老旧小区、街区改造与公共空间', query: '城市更新', tag: '更新' },
    { title: '基层治理', desc: '社区治理、网格化与民生实事', query: '基层治理', tag: '基层' },
    { title: '民生实事', desc: '就业、教育、医疗与养老现场', query: '民生实事', tag: '民生' },
  ],
};

const VIDEO_ACCOUNTS = [
  { name: '央视新闻', platform: 'bilibili', query: '央视新闻' },
  { name: '新华社', platform: 'bilibili', query: '新华社' },
  { name: '人民日报', platform: 'bilibili', query: '人民日报' },
  { name: '共青团中央', platform: 'bilibili', query: '共青团中央' },
  { name: '北京发布', platform: 'xhs', query: '北京发布' },
  { name: '上海发布', platform: 'xhs', query: '上海发布' },
  { name: '广东发布', platform: 'xhs', query: '广东发布' },
  { name: '成都发布', platform: 'xhs', query: '成都发布' },
  { name: '杭州发布', platform: 'xhs', query: '杭州发布' },
  { name: '深圳发布', platform: 'xhs', query: '深圳发布' },
];

const KEYWORD_RULES = [
  ['十五五', /十五五|“十五五”/],
  ['二十届五中全会', /二十届五中全会|五中全会/],
  ['全面从严治党', /全面从严治党|从严治党|管党治党/],
  ['中国式现代化', /中国式现代化/],
  ['高质量发展', /高质量发展/],
  ['新质生产力', /新质生产力/],
  ['科技创新', /科技创新|科技自立自强|人工智能|AI/],
  ['民生保障', /就业|教育|医疗|养老|住房|社保|收入|物价|食品安全/],
  ['城市治理', /城市治理|城市更新|基层治理|社区治理|超大城市/],
  ['乡村振兴', /乡村振兴|农业农村|粮食安全|农民/],
  ['生态文明', /生态文明|绿水青山|环境保护|双碳|绿色转型/],
  ['区域协调', /京津冀|长三角|粤港澳|大湾区|成渝|长江经济带|黄河流域/],
  ['对外开放', /对外开放|进博会|一带一路|自贸区|外资|外贸/],
  ['国家安全', /国家安全|应急管理|安全生产|防灾减灾|社会稳定/],
  ['中美关系', /中美|特朗普|白宫/],
  ['立法监督', /立法|全国人大|全国政协|司法解释|法律法规/],
];

const CATEGORY_RULES = [
  ['theory', /求是|理论|马克思主义|党史|思想体系|学理化/],
  ['diplomacy', /外交|会见|会谈|访问|中美|中德|中俄|中欧|联合国|一带一路|国际社会|全球治理|进博会/],
  ['central', /习近平|总书记|党中央|中央|全会|党建|从严治党|管党治党|巡视|反腐|纪检|组织工作|党性/],
  ['policy', /国务院|常务会议|政策|意见|规划|决定|条例|办法|方案|批复|通知|部署|改革|立法|修订草案/],
  ['economy', /经济|产业|消费|投资|金融|财政|货币|科技|创新|新质生产力|民营|营商|外贸|物流|工业|农业|粮食|进博会|就业/],
  ['livelihood', /教育|医疗|养老|住房|社保|收入|物价|食品|残疾|体育|文化|旅游|生态|环境|灾害|应急|安全|民生/],
  ['local', /城市|基层|社区|乡村|治理|省政府|市政府|省委|市委/],
];

const FALLBACK_ARTICLES = [
  ['坚持从严治吏 建强组织体系——论学习贯彻党的二十届五中全会精神', 'https://www.gov.cn/yaowen/liebiao/202611/content_7084731.htm', 'gov', '2026-11-02'],
  ['中共中央关于持之以恒推进全面从严治党若干重大问题的决定', 'https://www.qstheory.cn/20261101/02dd86f0bb6440f3ac99f61f424e69ad/c.html', 'qiushi', '2026-11-01'],
  ['《国家残疾预防行动计划（2026—2030年）》发布 推动不同人群降低致残风险', 'https://www.news.cn/politics/20261102/b67a106df54248d2b8e50503142c2ee6/c.html', 'xinhua', '2026-11-02'],
  ['可再生能源法修订草案提请审议', 'https://www.news.cn/politics/20261102/d61f18e9c8514496b1252d952100f7cb/c.html', 'xinhua', '2026-11-02'],
  ['2026城发大会今在沪开幕 上海将加快建设世界城市日永久主场', 'https://www.shanghai.gov.cn/nw4411/20261102/73921a4209ad4e19b96af4aefd0454bf.html', 'sh', '2026-11-02'],
  ['首都党员干部认真学习党的二十届五中全会精神', 'https://www.beijing.gov.cn/ywdt/gzdt/202611/t20261102_4927424.html', 'bj', '2026-11-02'],
  ['2026长江文化艺术季在汉圆满闭幕', 'https://www.hubei.gov.cn/zwgk/hbyw/hbywqb/202610/t20261031_6046106.shtml', 'hubei', '2026-10-31'],
  ['牢记嘱托 勇担使命 奋力谱写中原大地推进中国式现代化新篇章', 'https://www.henan.gov.cn/2026/11-02/3443170.html', 'henan', '2026-11-02'],
];

let cache = { data: null, at: 0, promise: null };
let excerptCache = new Map();
let lastForcedRefresh = 0;

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function articleId(url) {
  return `a_${sha1(url).slice(0, 10)}`;
}

function stripTags(input = '') {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(input = '') {
  return String(input)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cleanText(input = '') {
  return decodeEntities(stripTags(input)).replace(/[\s\u00a0\u3000]+/g, ' ').trim();
}

function safeUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeTitle(value = '') {
  return value.replace(/[\s\u3000·—－\-|｜“”"'‘’（）()《》【】\[\]、，,。.!！?？:：;；]/g, '').toLowerCase();
}

function dateInShanghai(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function dateLabel() {
  const now = new Date();
  const full = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(now);
  return full.replace('星期', ' · 星期');
}

function timeLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

function todayIso() {
  return dateInShanghai(0);
}

function yesterdayIso() {
  return dateInShanghai(-1);
}

function daysAgo(iso) {
  if (!iso) return 999;
  const today = new Date(`${todayIso()}T00:00:00+08:00`).getTime();
  const date = new Date(`${iso}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(date)) return 999;
  return Math.round((today - date) / 86400000);
}

function extractDate(rawUrl = '') {
  let match = rawUrl.match(/\/t(20\d{2})(\d{2})(\d{2})_/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = rawUrl.match(/\/(20\d{2})\/(\d{1,2})[\/-](\d{1,2})\//);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  match = rawUrl.match(/\/(20\d{2})(\d{2})\/(\d{2})\//);
  if (match) {
    if (Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[3]) >= 1 && Number(match[3]) <= 31) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  match = rawUrl.match(/\/(20\d{2})(\d{2})(\d{2})\//);
  if (match) {
    if (Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[3]) >= 1 && Number(match[3]) <= 31) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  match = rawUrl.match(/\/(20\d{2})(\d{2})\//);
  if (match) return `${match[1]}-${match[2]}-01`;
  return null;
}

function decodeBuffer(buffer, contentType = '') {
  const match = /charset=["']?([\w-]+)/i.exec(contentType);
  const charset = (match?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset === 'gb2312' ? 'gbk' : charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
        referer: options.referer || 'https://www.gov.cn/',
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    return decodeBuffer(buffer, response.headers.get('content-type') || '');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  const start = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const pos = start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);
  return JSON.parse(text.slice(pos === -1 ? 0 : pos));
}

async function govJson() {
  const rows = await fetchJson('https://www.gov.cn/yaowen/liebiao/YAOWENLIEBIAO.json');
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 40).map((row) => ({
    title: cleanText(row.TITLE),
    url: safeUrl(row.URL, 'https://www.gov.cn/'),
    date: row.DOCRELPUBTIME || extractDate(row.URL || ''),
  })).filter((item) => item.title && item.url);
}

async function govPolicy() {
  const rows = await fetchJson('https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json');
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 50).map((row) => ({
    title: cleanText(row.TITLE),
    url: safeUrl(row.URL, 'https://www.gov.cn/zhengce/zuixin/'),
    date: row.DOCRELPUBTIME || extractDate(row.URL || ''),
  })).filter((item) => item.title && item.url);
}

async function peoplePaper() {
  const compact = todayIso().replaceAll('-', '');
  const year = compact.slice(0, 4);
  const month = compact.slice(4, 6);
  const day = compact.slice(6, 8);
  const parsePaper = async (pageUrl) => {
    const html = await fetchText(pageUrl);
    const items = [];
    const regex = /<a\b[^>]*href\s*=\s*["']([^"']*content_\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(regex)) {
      const title = cleanText(match[2]);
      if (title.length < 7 || title.length > 110) continue;
      if (/^(更多|首页|登录|注册|网站地图|上一版|下一版|返回顶部)$/.test(title)) continue;
      const url = safeUrl(match[1], pageUrl);
      if (!url) continue;
      const dateMatch = url.match(/\/(20\d{2})(\d{2})\/(\d{2})\//);
      const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
      if (!date || daysAgo(date) > 3) continue;
      items.push({ title, url, date });
    }
    return items.filter((item, index, all) => all.findIndex((row) => normalizeTitle(row.title) === normalizeTitle(item.title)) === index).slice(0, 24);
  };
  const base = `http://paper.people.com.cn/rmrb/pc/layout/${year}${month}/${day}`;
  try {
    const pages = await Promise.all([1, 2, 3, 4].map((node) => parsePaper(`${base}/node_0${node}.html`).catch(() => [])));
    const items = pages.flat();
    const unique = items.filter((item, index, all) => all.findIndex((row) => normalizeTitle(row.title) === normalizeTitle(item.title)) === index);
    if (unique.length) return unique.slice(0, 24);
  } catch {
    // Try the previous day's front page below.
  }
  const previous = new Date(`${todayIso()}T12:00:00+08:00`);
  previous.setDate(previous.getDate() - 1);
  const fallbackDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', day: '2-digit' }).format(previous);
  const fallbackUrl = `http://paper.people.com.cn/rmrb/pc/layout/${year}${month}/${fallbackDay}/node_01.html`;
  return parsePaper(fallbackUrl);
}

async function generic(def, pageUrl, hrefPattern, limit = 24) {
  const html = await fetchText(pageUrl);
  const anchors = [];
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const rawHref = match[1].trim();
    if (!rawHref || /^(javascript:|#|mailto:|tel:)/i.test(rawHref)) continue;
    const url = safeUrl(rawHref, pageUrl);
    if (!url || !hrefPattern.test(url)) continue;
    let title = cleanText(match[2]);
    if (title.length < 8 || title.length > 110) continue;
    if (/^(更多|首页|登录|注册|网站地图|无障碍|EN|繁体|广告|版权|举报|关于我们|联系我们|招聘|订阅|上一页|下一页|返回顶部|查看详情)$/i.test(title)) continue;
    if (/网站地图|无障碍|京ICP|公网安备|版权所有|客户端|English|手机版/i.test(title)) continue;
    const date = extractDate(url);
    if (date && daysAgo(date) > 45) continue;
    anchors.push({ title, url, date: date || todayIso() });
  }
  const unique = new Map();
  for (const item of anchors) {
    const key = normalizeTitle(item.title);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, limit);
}

function inferCategory(title, sourceGroup) {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(title)) return category;
  }
  if (sourceGroup === 'theory') return 'theory';
  if (sourceGroup === 'local') return 'local';
  return 'other';
}

function inferTags(title) {
  return KEYWORD_RULES.filter(([, pattern]) => pattern.test(title)).map(([tag]) => tag).slice(0, 3);
}

function computeHeat(item, def, date) {
  let score = def.priority || 60;
  const age = daysAgo(date);
  if (age <= 0) score += 24;
  else if (age === 1) score += 15;
  else if (age <= 3) score += 8;
  if (/习近平|总书记|中央|国务院|全会|政策|发布|决定|规划|意见/.test(item.title)) score += 10;
  if (item.title.length >= 18) score += 3;
  return Math.min(99, Math.max(30, Math.round(score * 0.85)));
}

function makeArticle(item, def) {
  if (!item?.title || !item?.url) return null;
  const date = item.date || extractDate(item.url) || todayIso();
  const category = inferCategory(item.title, def.group);
  return {
    id: articleId(item.url),
    title: item.title,
    url: item.url,
    date,
    sourceId: def.id,
    source: def.name,
    sourceShort: def.short,
    sourceGroup: def.group,
    region: def.region,
    accent: def.accent,
    category,
    categoryLabel: CATEGORY_LABELS[category] || '综合',
    tags: inferTags(item.title),
    excerpt: item.excerpt || '',
    heat: computeHeat(item, def, date),
    sourcePriority: def.priority || 60,
  };
}

async function fetchSource(def) {
  const start = Date.now();
  try {
    const items = await def.parser(def);
    return { def, items: items || [], ok: true, latency: Date.now() - start, error: '' };
  } catch (error) {
    return { def, items: [], ok: false, latency: Date.now() - start, error: error?.message || '抓取失败' };
  }
}

async function getExcerpt(url) {
  const cached = excerptCache.get(url);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.text;
  try {
    const html = await fetchText(url, { timeout: 9000 });
    let text = '';
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metaTags) {
      if (!/(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(tag)) continue;
      const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
      if (content) {
        text = cleanText(content);
        if (text.length > 30) break;
      }
    }
    if (text.length < 30) {
      const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((row) => cleanText(row[1]))
        .filter((row) => row.length >= 35 && !/责任编辑|来源：|分享到|上一篇|下一篇|相关阅读|扫一扫/.test(row));
      text = paragraphs[0] || '';
    }
    text = text.replace(/\s*[-—|]\s*(新华网|人民网|央视网|中国政府网|求是网|光明网).*$/i, '').slice(0, 220);
    excerptCache.set(url, { at: Date.now(), text });
    return text;
  } catch {
    excerptCache.set(url, { at: Date.now(), text: '' });
    return '';
  }
}

async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

function fallbackArticles() {
  return FALLBACK_ARTICLES.map(([title, url, sourceId, date]) => {
    const def = SOURCE_DEFS.find((item) => item.id === sourceId) || SOURCE_DEFS[0];
    return makeArticle({ title, url, date }, def);
  }).filter(Boolean);
}

function topKeywords(articles, limit = 12) {
  const counts = new Map();
  for (const article of articles) {
    for (const [tag, pattern] of KEYWORD_RULES) {
      if (pattern.test(article.title) || pattern.test(article.excerpt || '')) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function countBy(articles, key) {
  const map = new Map();
  for (const article of articles) {
    const value = article[key] || '其他';
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function buildBrief(articles, statuses, trends, video) {
  const today = todayIso();
  const yesterday = yesterdayIso();
  const pool = articles.filter((item) => item.date === today || item.date === yesterday);
  const basis = pool.length >= 8 ? pool : articles.slice(0, 32);
  const central = basis.filter((item) => item.category === 'central' || item.tags.includes('二十届五中全会') || item.tags.includes('全面从严治党'));
  const policy = basis.filter((item) => item.category === 'policy' || item.category === 'economy' || item.category === 'diplomacy');
  const local = basis.filter((item) => item.category === 'local' || item.category === 'livelihood' || item.region !== '全国');
  const keywords = topKeywords(basis, 10);
  const sourceCounts = countBy(basis, 'sourceGroup');
  const categoryCounts = countBy(basis, 'category');
  const regions = countBy(basis.filter((item) => item.region !== '全国'), 'region');
  const officialPolicies = articles
    .filter((item) => item.sourceGroup === 'policy')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const policyRecent = (officialPolicies.length ? officialPolicies : policy).slice(0, 6);
  const topCentral = central[0] || basis[0];
  const topPolicy = policyRecent[0] || policy[0] || basis[0];
  const topLocal = local[0] || basis[0];
  const total = basis.length;
  const centralPct = total ? Math.round((central.length / total) * 100) : 0;
  const policyPct = total ? Math.round((policy.length / total) * 100) : 0;

  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const summary = `${month}月${day}日，系统监测 ${statuses.filter((item) => item.ok).length} 个有效信源，有效样本 ${total} 条（总入库 ${articles.length} 条）。中央部署与党建议题占 ${centralPct}%，政策、经济与对外开放议题占 ${policyPct}%。政策层面的主要看点是《${topPolicy.title.replace(/[《》]/g, '')}》；地方层面，${regions.slice(0, 3).map((item) => item.name).join('、') || '多地'}动态相对集中。`;

  const mainlines = [
    {
      id: 'central',
      no: '01',
      title: '中央部署与党的建设',
      count: central.length,
      text: central.slice(0, 3).map((item) => item.title).join('；') + (central.length ? '。' : '今日暂无集中更新。'),
      articleIds: central.slice(0, 3).map((item) => item.id),
    },
    {
      id: 'policy',
      no: '02',
      title: '政策供给与经济发展',
      count: policy.length,
      text: policy.slice(0, 3).map((item) => item.title).join('；') + (policy.length ? '。' : '今日暂无集中更新。'),
      articleIds: policy.slice(0, 3).map((item) => item.id),
    },
    {
      id: 'local',
      no: '03',
      title: '地方治理与民生现场',
      count: local.length,
      text: local.slice(0, 3).map((item) => item.title).join('；') + (local.length ? '。' : '今日暂无集中更新。'),
      articleIds: local.slice(0, 3).map((item) => item.id),
    },
  ];

  const signals = policyRecent.slice(0, 4).map((item) => {
    let meaning = '进入公开政策议程，关注后续发布、适用条件与执行细则。';
    if (/中共中央.*关于|中央关于/.test(item.title)) meaning = '顶层制度安排，关注配套文件、责任分工与执行节奏。';
    else if (/人工智能/.test(item.title)) meaning = '面向人工智能就业影响的制度回应，关注岗位创造、技能转换与企业承接。';
    else if (/科技创新|产业创新/.test(item.title)) meaning = '创新链与产业链衔接信号，关注平台建设、成果转化与区域分工。';
    else if (/体育赛事|消费/.test(item.title)) meaning = '以赛事和场景扩消费，关注配套服务、审批便利与地方试点。';
    else if (/残疾|康复|医疗/.test(item.title)) meaning = '民生保障专项安排，关注服务供给、资金保障与地方实施方案。';
    else if (/意见/.test(item.title)) meaning = '政策供给文件，关注落地工具、试点安排与地方承接。';
    else if (/规划|计划|方案/.test(item.title)) meaning = '专项任务安排，关注指标分解、项目清单与年度进度。';
    else if (/批复/.test(item.title)) meaning = '国务院层面批复，关注区域或领域实施方案的细化。';
    else if (/条例|规定|法/.test(item.title)) meaning = '立法与制度供给，关注施行时间、适用范围与配套解释。';
    else if (/会议|部署/.test(item.title)) meaning = '工作部署信号，关注任务分解、责任主体与督查节点。';
    return {
      title: item.title, source: item.source, date: item.date, articleId: item.id,
      meaning,
    };
  });

  const outlook = [];
  if (keywords.some((item) => item.name === '全面从严治党')) outlook.push('党建与从严治党议题处于高密度报道期，后续可关注制度配套、警示教育与典型案例通报。');
  if (keywords.some((item) => item.name === '十五五')) outlook.push('“十五五”相关报道正在从全会精神向规划编制、指标分解和项目储备延伸，关注中央与地方衔接。');
  if (keywords.some((item) => item.name === '城市治理')) outlook.push('城市治理与基层治理议题在地方信源中活跃，关注政务服务、城市更新和民生实事的落地案例。');
  if (keywords.some((item) => item.name === '对外开放')) outlook.push('开放平台与展会经济成为对外叙事的重要窗口，关注签约成果、外资预期与制度型开放举措。');
  if (trends.length) outlook.push(`社交平台热词中，“${trends.slice(0, 3).map((item) => item.word).join('”“')}”与站内时政议题形成呼应，可用于观察公众关注点的迁移。`);
  if (video?.live) outlook.push('视频平台检索结果已纳入本期观察，短视频叙事可能先于图文报道形成议题热度，需注意信源核验。');
  outlook.push('本简报由站内信源标题、摘要与来源结构自动生成，不替代原文与权威解读；涉及政策表述、数据与人事信息，请点击引文回溯原始发布。');

  return {
    issue: `${today.slice(0, 4)}.${today.slice(5).replace('-', '.')}`,
    date: today,
    title: '今日政情分析简报',
    summary,
    readTime: 3,
    stats: {
      total, central: central.length, policy: policy.length, local: local.length,
      sources: statuses.filter((item) => item.ok).length,
      keywords: keywords.slice(0, 8),
      sourceCounts,
      categoryCounts,
      regions: regions.slice(0, 8),
    },
    mainlines,
    signals,
    outlook,
    generatedAt: new Date().toISOString(),
  };
}

async function fetchWeiboHot() {
  try {
    const data = await fetchJson('https://weibo.com/ajax/side/hotSearch', {
      timeout: 12000,
      referer: 'https://weibo.com/',
      headers: { accept: 'application/json, text/plain, */*' },
    });
    const realtime = (data?.data?.realtime || []).filter((item) => item.word || item.note);
    const noise = /胡歌|明星|演唱会|综艺|电影|电视剧|足球|篮球|游戏|手机|罗技|苹果|特斯拉|股价|彩票|网红|直播|带货|情感|离婚|结婚|怀孕|减肥|穿搭|美妆|旅游|美食|宠物|抽奖|红包|壁纸|头像|表情包/;
    const political = realtime.filter((item) => {
      const text = `${item.word || ''} ${item.note || ''}`;
      if (noise.test(text)) return false;
      return /习近平|中央|国务院|全会|政策|经济|民生|就业|教育|医疗|养老|住房|治理|反腐|党建|外交|中美|进博|十五五|发展|改革|安全|灾害|社会|城市|乡村振兴|生态|人大|政协|法律|法院|检察|政府|发布会|税|消费|物价|春运|高考|医保|社保/.test(text);
    });
    return political.slice(0, 10).map((item, index) => ({
      word: cleanText(item.word || item.note || ''),
      note: cleanText(item.note || ''),
      rank: item.realpos || index + 1,
      label: item.label_name || '',
      category: item.category || '',
      general: false,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${item.word || item.note}#`)}`,
    })).filter((item) => item.word);
  } catch {
    return [];
  }
}

function formatPlay(value) {
  const number = Number(value || 0);
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  return String(number);
}

const BILI_COOKIE = 'buvid3=shiguan-2026-1102-0001-abcdef;';

async function fetchBilibiliVideos() {
  const queries = ['新闻联播 要点', '时政新闻', '城市治理 新闻'];
  const results = [];
  await Promise.all(queries.map(async (query) => {
    try {
      const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&order=pubdate&page=1&page_size=20`;
      const data = await fetchJson(url, {
        timeout: 14000,
        referer: 'https://search.bilibili.com/',
        headers: { accept: 'application/json, text/plain, */*', cookie: BILI_COOKIE },
      });
      const rows = data?.data?.result || [];
      for (const row of rows) {
        const title = cleanText(String(row.title || '').replace(/<\/?em[^>]*>/gi, ''));
        if (title.length < 6) continue;
        if (/考公|考研|国考|省考|事业编|公基|刷题|课程|网课|笔记|申论|面试|军队文职|选调|题库|PPT|模板|放送文化|片头|片尾|停播|模拟电视|频道改版|招聘|校招|广告|带货|明星|娱乐|游戏|恭喜|破纪录|骂|武汉大学|争议|热搜|放送事故|口误|完整版|直播回放|录播|卫视|藏语|距离2027|郑丽|潘涛|数字政务|数据中台|智慧城市|数字孪生|低空|解决方案/.test(title)) continue;
        const trusted = /央视|新华社|新华网|人民日报|人民网|CMG|看看新闻|澎湃|中新|广电|发布|新闻联播/.test(row.author || '');
        const quality = /新闻联播.*(要点|解读|总结|信息差)|时政.*(解读|总结|速递|要闻)|全会|国务院|进博|政策发布|城市治理|基层治理|城市更新|民生实事/.test(title);
        if (!trusted && !quality) continue;
        const pubdate = Number(row.pubdate || 0) * 1000;
        if (!pubdate || Date.now() - pubdate > 30 * 86400000) continue;
        if (results.some((item) => item.bvid === row.bvid)) continue;
        const pic = String(row.pic || '');
        results.push({
          bvid: row.bvid,
          title,
          author: cleanText(row.author || ''),
          query,
          trusted,
          play: formatPlay(row.play),
          duration: row.duration || '',
          date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(pubdate)),
          cover: pic.startsWith('//') ? `https:${pic}` : pic,
          url: `https://www.bilibili.com/video/${row.bvid}`,
        });
      }
    } catch {
      // A failed platform query should not block the dashboard.
    }
  }));
  const chosen = results
    .filter((item) => item.trusted || /新闻联播|时政|全会|国务院|城市治理|基层治理|发布会/.test(item.title))
    .sort((a, b) => Number(b.trusted) - Number(a.trusted) || b.date.localeCompare(a.date))
    .slice(0, 6);
  return { live: chosen.length > 0, items: chosen };
}

function buildVideo(data) {
  const bilibiliTopics = VIDEO_TOPICS.bilibili.map((item) => ({
    ...item,
    url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(item.query)}`,
  }));
  const xhsTopics = VIDEO_TOPICS.xhs.map((item) => ({
    ...item,
    url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(item.query)}`,
  }));
  const accounts = VIDEO_ACCOUNTS.map((item) => ({
    ...item,
    url: item.platform === 'bilibili'
      ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(item.query)}`
      : `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(item.query)}`,
  }));
  return {
    live: Boolean(data?.live),
    bilibili: data?.items?.length ? data.items : [],
    bilibiliTopics,
    xhsTopics,
    accounts,
  };
}

function buildDirectory(statuses) {
  const statusMap = new Map(statuses.map((item) => [item.def.id, item]));
  return {
    ministries: MINISTRIES,
    provinces: PROVINCES,
    media: MEDIA_DIRECTORY,
    theory: THEORY_DIRECTORY,
    liveSources: SOURCE_DEFS.map((def) => {
      const status = statusMap.get(def.id);
      return {
        id: def.id, name: def.name, short: def.short, group: def.group,
        url: def.url, note: def.note, accent: def.accent,
        count: status?.items?.length || 0, ok: Boolean(status?.ok),
        latency: status?.latency || 0,
      };
    }),
  };
}

function buildStats(articles, statuses, trends) {
  const today = todayIso();
  const local = articles.filter((item) => item.region !== '全国');
  return {
    articles: articles.length,
    today: articles.filter((item) => item.date === today).length,
    sources: statuses.filter((item) => item.ok).length,
    sourceTotal: statuses.length,
    local: local.length,
    policy: articles.filter((item) => item.category === 'policy').length,
    regions: new Set(local.map((item) => item.region)).size,
    trends: trends.length,
    keywords: topKeywords(articles, 12),
    categories: countBy(articles, 'category'),
    groups: countBy(articles, 'sourceGroup'),
  };
}

async function refresh(force = false) {
  if (cache.promise) return cache.promise;
  if (!force && cache.data && Date.now() - cache.at < CACHE_TTL) return cache.data;
  cache.promise = (async () => {
    const started = Date.now();
    const [statuses, trends, bilibili] = await Promise.all([
      Promise.all(SOURCE_DEFS.map(fetchSource)),
      fetchWeiboHot(),
      fetchBilibiliVideos(),
    ]);

    let all = [];
    let isFallback = false;
    for (const status of statuses) {
      for (const item of status.items) {
        const article = makeArticle(item, status.def);
        if (article) all.push(article);
      }
    }
    if (all.length < 8) {
      all = fallbackArticles();
      isFallback = true;
    }

    const unique = new Map();
    for (const article of all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.heat - a.heat)) {
      const key = normalizeTitle(article.title).slice(0, 46);
      const existing = unique.get(key);
      if (!existing || article.sourcePriority > existing.sourcePriority) unique.set(key, article);
    }
    const merged = [...unique.values()];
    // 政策文件库更新频率低于新闻流，按日期预留最近 10 条，避免被 160 条上限挤掉。
    const policyReserve = merged
      .filter((article) => article.sourceGroup === 'policy')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 10);
    // 地方信源同样按来源预留最近 2 条，避免少数高频地区挤占全部地方版面。
    const localReserve = [];
    const localSeen = new Map();
    for (const article of merged
      .filter((item) => item.sourceGroup === 'local')
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.heat - a.heat)) {
      const used = localSeen.get(article.sourceId) || 0;
      if (used >= 2) continue;
      localReserve.push(article);
      localSeen.set(article.sourceId, used + 1);
    }
    const reserve = [...policyReserve, ...localReserve];
    const reservedIds = new Set(reserve.map((article) => article.id));
    const newsPool = merged
      .filter((article) => !reservedIds.has(article.id))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.heat - a.heat);
    let articles = [...reserve, ...newsPool.slice(0, Math.max(0, 160 - reserve.length))]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.heat - a.heat);

    const excerptTargets = articles.slice(0, 12);
    await mapLimit(excerptTargets, 4, async (article) => {
      if (!article.excerpt) article.excerpt = await getExcerpt(article.url);
      return article;
    });
    articles = articles.map((article) => ({
      ...article,
      excerpt: article.excerpt || '',
    }));

    const brief = buildBrief(articles, statuses, trends, { live: bilibili.live });
    const video = buildVideo(bilibili);
    const directory = buildDirectory(statuses);
    const stats = buildStats(articles, statuses, trends);
    const hero = articles[0] || null;
    const generatedAt = new Date().toISOString();
    const data = {
      meta: {
        today: todayIso(),
        yesterday: yesterdayIso(),
        dateLabel: dateLabel(),
        timeLabel: timeLabel(),
        updatedAt: generatedAt,
        updatedLabel: `${timeLabel()} 更新`,
        refreshMs: CACHE_TTL,
        isFallback,
        sourceOk: statuses.filter((item) => item.ok).length,
        sourceTotal: statuses.length,
        articleCount: articles.length,
        fetchMs: Date.now() - started,
        engine: process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'local-rag',
      },
      hero,
      articles,
      brief,
      stats,
      directory,
      bloggers: BLOGGERS,
      video,
      trends,
      status: statuses.map((status) => ({
        id: status.def.id, name: status.def.name, short: status.def.short,
        group: status.def.group, url: status.def.url, accent: status.def.accent,
        ok: status.ok, count: status.items.length, latency: status.latency,
        error: status.error ? '抓取超时或源站限制' : '',
      })),
      sourceDefs: SOURCE_DEFS.map(({ parser, ...rest }) => rest),
    };
    cache = { data, at: Date.now(), promise: null };
    return data;
  })();
  try {
    return await cache.promise;
  } catch (error) {
    cache.promise = null;
    if (cache.data) return cache.data;
    throw error;
  }
}

function queryTerms(question) {
  const normalized = question.replace(/[，。！？、,.!?；;：:“”"'（）()\[\]【】]/g, ' ').trim();
  const stop = /今天|今日|最近|最新|现在|目前|有哪些|有什么|什么|如何|怎么|怎样|请|帮我|一下|关于|相关|重要|时政|新闻|动态|情况|消息|报道|分析|解读|总结|汇总|主要|哪些|方面|可以|能否|介绍|看看|查询|搜索|检索|列出|讲讲|说说|以及|还有|这个|那个|近期|本周|本月/g;
  const terms = new Set();
  for (const [tag, pattern] of KEYWORD_RULES) {
    if (pattern.test(normalized)) terms.add(tag);
  }
  for (const { name } of PROVINCES) if (normalized.includes(name)) terms.add(name);
  for (const token of normalized.replace(stop, ' ').split(/\s+/)) {
    if (token.length >= 2 && token.length <= 10 && !/^\d+$/.test(token)) terms.add(token);
    if (token.length > 10) {
      for (let index = 0; index < token.length - 1; index += 1) {
        const bigram = token.slice(index, index + 2);
        if (!/^(的|了|是|在|有|和|与|及|为|对|从|把|被|让|就|都|也|还|这|那|其|之)/.test(bigram)) terms.add(bigram);
      }
    }
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, 18);
}

function scoreArticle(article, terms, question) {
  const title = article.title.toLowerCase();
  const excerpt = (article.excerpt || '').toLowerCase();
  const normalizedQuestion = question.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const low = term.toLowerCase();
    if (title.includes(low)) score += 12;
    else if (excerpt.includes(low)) score += 4;
    if (article.tags.some((tag) => tag.includes(term) || term.includes(tag))) score += 5;
  }
  if (title.includes(normalizedQuestion.replace(/[？?。！!]/g, ''))) score += 20;
  if (article.date === todayIso()) score += 8;
  else if (article.date === yesterdayIso()) score += 4;
  if (article.sourceGroup === 'central' || article.sourceGroup === 'policy' || article.sourceGroup === 'theory') score += 3;
  score += article.heat * 0.06;
  return score;
}

function provinceMatch(article, question) {
  return PROVINCES.some(({ name }) => question.includes(name) && article.region === name);
}

function answerLocally(question, data) {
  const terms = queryTerms(question);
  const wantsPolicy = /政策|文件|意见|规划|条例|通知|部署|措施|改革/.test(question);
  const wantsLocal = /地方|省|市|基层|城市|治理|北京|上海|广东|浙江|四川|湖北|河南|山东|江苏|湖南|福建|安徽|陕西|重庆|天津|河北|山西|辽宁|吉林|黑龙江|江西|广西|海南|贵州|云南|西藏|甘肃|青海|宁夏|新疆/.test(question);
  const wantsTheory = /求是|理论|党建|党史|马克思主义|全面从严治党/.test(question);
  const wantsToday = /今天|今日|最新|刚刚|目前|现在/.test(question);
  let pool = data.articles.slice();
  if (wantsPolicy) pool = pool.filter((article) => ['policy', 'economy', 'central', 'theory'].includes(article.category));
  if (wantsLocal) {
    const regionHit = pool.filter((article) => provinceMatch(article, question));
    if (regionHit.length >= 2) pool = regionHit;
    else pool = pool.filter((article) => article.region !== '全国' || ['local', 'livelihood'].includes(article.category));
  }
  if (wantsTheory) pool = pool.filter((article) => article.sourceGroup === 'theory' || article.category === 'central' || article.tags.includes('全面从严治党'));
  if (wantsToday && !wantsPolicy) {
    const today = pool.filter((article) => article.date === todayIso());
    if (today.length >= 3) pool = today;
  }

  const ranked = pool
    .map((article) => ({
      article,
      score: scoreArticle(article, terms, question)
        + (wantsPolicy && article.sourceGroup === 'policy' ? 18 : 0)
        + (wantsTheory && article.sourceGroup === 'theory' ? 8 : 0),
    }))
    .filter((item) => item.score > 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.article);
  const fallback = ranked.length ? ranked : data.articles.slice(0, 6);

  const isRoundup = !wantsPolicy && !wantsLocal && !wantsTheory
    && /今天|今日|综述|汇总|概览|有哪些|要闻|动态|主线|梳理/.test(question);

  const citationArticles = [];
  const addCitation = (article) => {
    if (article && !citationArticles.some((item) => item.id === article.id)) citationArticles.push(article);
  };
  const noOf = (article) => {
    const index = citationArticles.findIndex((item) => item.id === article.id);
    return index === -1 ? 0 : index + 1;
  };

  const lines = [];
  if (isRoundup) {
    const todayArticles = data.articles.filter((article) => article.date === todayIso());
    const roundupPool = todayArticles.length >= 5 ? todayArticles : data.articles.slice(0, 30);
    lines.push(`截至 ${data.meta.timeLabel}，站内信源库共监测到 ${data.stats.articles} 条时政信息，其中今日更新 ${data.stats.today} 条、有效信源 ${data.stats.sources} 个。`);
    lines.push('');
    lines.push('**三条主线**');

    const mainlines = (data.brief?.mainlines || []).slice(0, 3);
    const usedIds = new Set();
    for (const line of mainlines) {
      const article = (line.articleIds || []).map((id) => data.articles.find((item) => item.id === id)).find(Boolean)
        || roundupPool.find((item) => item.category === line.id)
        || roundupPool[0];
      if (article) {
        addCitation(article);
        usedIds.add(article.id);
        lines.push(`- **${line.title}**（${line.count} 条）：《${article.title}》——${article.source} [${noOf(article)}]`);
      }
    }

    const priority = roundupPool.filter((article) => !usedIds.has(article.id)).slice(0, 3);
    if (priority.length) {
      lines.push('');
      lines.push('**值得优先阅读**');
      for (const article of priority) {
        addCitation(article);
        lines.push(`- 《${article.title}》——${article.source}，${article.date} [${noOf(article)}]`);
      }
    }
  } else {
    fallback.slice(0, 5).forEach(addCitation);
    const heading = wantsPolicy ? '政策与文件线索' : wantsTheory ? '理论阐释线索' : wantsLocal ? '地方落实线索' : '核心信息';
    lines.push(`围绕“${question.replace(/[？?]/g, '').trim()}”，站内信源库检索到 ${fallback.length} 条相关材料，以下列出 ${Math.min(5, fallback.length)} 条最相关线索${wantsPolicy ? '（政策文件不必然按日更新）' : ''}：`);
    lines.push('');
    lines.push(`**${heading}**`);
    for (const article of fallback.slice(0, 5)) {
      const detail = article.excerpt ? ` ${article.excerpt.slice(0, 92)}${article.excerpt.length > 92 ? '…' : ''}` : '';
      lines.push(`- **《${article.title}》**——${article.source}，${article.date} [${noOf(article)}]${detail}`);
    }
    lines.push('');
    lines.push('**研判边界**');
    lines.push(wantsPolicy
      ? '以上为标题与摘要层面的政策线索；具体条款、适用范围、实施时点与责任部门，须以文件原文和权威解读为准。'
      : wantsTheory
        ? '以上为理论文章的标题与摘要线索；概念表述与论证逻辑请回溯源文章，不宜以摘要替代全文。'
        : '以上为站内信源摘要层面的线索；涉及数据、人事与政策表述，请点击引文核对原文。');
  }

  const keywordNames = data.stats.keywords.slice(0, 4).map((item) => item.name);
  const regionNames = countBy(fallback.filter((item) => item.region !== '全国'), 'region').slice(0, 3).map((item) => item.name);
  lines.push('');
  lines.push('**综合观察**');
  lines.push(`从当前信源结构看，报道主要围绕${keywordNames.length ? `“${keywordNames.join('”“')}”` : '中央部署与地方落实'}展开${regionNames.length ? `，地方层面以${regionNames.join('、')}较为集中` : ''}。${wantsPolicy ? '政策类信息需重点区分文件发布、部门解读与地方执行三个层级。' : '建议将标题层面的信号与原文表述分开看待，避免用单一报道替代完整政策文本。'}`);
  lines.push('以上为基于站内标题与摘要的检索增强摘要，重要表述、数据和人事信息请点击引文核对原文。');

  const followups = [];
  if (wantsPolicy) followups.push('这些政策文件分别由哪些部门发布？', '地方层面有哪些配套落实动作？');
  else if (wantsLocal) followups.push('该地区今日还有哪些政务动态？', '相关做法是否被中央媒体关注？');
  else if (wantsTheory) followups.push('这些理论文章的核心概念如何界定？', '有哪些地方落实案例？');
  else followups.push('把今日要闻按三条主线重新梳理', '哪些信号值得持续跟踪？');
  followups.push('检索求是杂志的理论阐释');

  const citations = citationArticles.slice(0, 8).map((article, index) => ({
    no: index + 1,
    id: article.id,
    title: article.title,
    source: article.source,
    date: article.date,
    url: article.url,
    excerpt: article.excerpt || '',
  }));

  return {
    engine: 'local-rag',
    question,
    answer: lines.join('\n'),
    citations,
    followups: [...new Set(followups)].slice(0, 3),
    scope: {
      sources: data.stats.sources,
      articles: data.stats.articles,
      terms,
      today: data.meta.today,
    },
  };
}

async function answerWithLLM(question, data) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const context = data.articles.slice(0, 18).map((article, index) => (
    `[${index + 1}] ${article.title}\n来源：${article.source} ${article.date}\n摘要：${article.excerpt || '（暂无摘要）'}\n链接：${article.url}`
  )).join('\n\n');
  try {
    const response = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: '你是一名严谨的中文时政研究助理。只能依据给定信源作答，使用 [编号] 标注引文，区分事实与判断，不编造数据、政策条款或人事信息。若材料不足，明确说明。输出简洁的 Markdown，包含“核心信息”“综合观察”。',
          },
          { role: 'user', content: `问题：${question}\n\n可用信源：\n${context}` },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return null;
    const json = await response.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text) return null;
    return {
      engine: 'deepseek',
      question,
      answer: text,
      citations: data.articles.slice(0, 18).map((article, index) => ({
        no: index + 1, id: article.id, title: article.title, source: article.source,
        date: article.date, url: article.url, excerpt: article.excerpt || '',
      })),
      followups: ['把以上内容压缩成三条研判', '列出仍需核验的信息点', '检索相关地方落实案例'],
      scope: { sources: data.stats.sources, articles: data.stats.articles, today: data.meta.today },
    };
  } catch {
    return null;
  }
}

async function buildAnswer(question, data) {
  const llm = await answerWithLLM(question, data);
  return llm || answerLocally(question, data);
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function parseBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error('请求内容过长');
  }
  if (!body) return {};
  return JSON.parse(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

async function serveStatic(response, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    const content = await readFile(filePath);
    response.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=120',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/dashboard') {
      const force = url.searchParams.get('refresh') === '1';
      if (force) {
        if (Date.now() - lastForcedRefresh < 20_000) {
          if (cache.data) return jsonResponse(response, 200, cache.data);
        }
        lastForcedRefresh = Date.now();
      }
      const data = await refresh(force);
      return jsonResponse(response, 200, data);
    }
    if (url.pathname === '/api/ask' && request.method === 'POST') {
      const body = await parseBody(request);
      const question = String(body.question || '').trim();
      if (!question) return jsonResponse(response, 400, { error: '请输入问题' });
      if (question.length > 300) return jsonResponse(response, 400, { error: '问题请控制在 300 字以内' });
      const data = cache.data || await refresh(false);
      const answer = await buildAnswer(question, data);
      return jsonResponse(response, 200, answer);
    }
    if (url.pathname === '/api/health') {
      return jsonResponse(response, 200, {
        ok: true,
        cached: Boolean(cache.data),
        updatedAt: cache.data?.meta?.updatedAt || null,
        articles: cache.data?.stats?.articles || 0,
      });
    }
    if (url.pathname.startsWith('/api/')) return jsonResponse(response, 404, { error: '接口不存在' });
    return serveStatic(response, decodeURIComponent(url.pathname));
  } catch (error) {
    return jsonResponse(response, 500, { error: '服务暂时不可用', detail: error?.message || '' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`时观 · 全国时政实时雷达 running at http://127.0.0.1:${PORT}`);
  refresh(false).catch((error) => console.error('warmup failed:', error));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
