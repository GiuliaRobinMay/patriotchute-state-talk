/* Link previews, the way every chat app makes them: this function visits
 * the pasted address from the server side (the browser is not allowed to)
 * and hands back title, image, description and site name.
 *
 * Two doors, tried in order:
 *   1. The platform's own preview service (oEmbed) — YouTube, X, Vimeo,
 *      TikTok and Rumble answer these openly, with better data than their
 *      pages give to scrapers.
 *   2. The page's preview tags — the ones sites write for Facebook and
 *      friends. If the first read comes back empty, one more try in a
 *      different crawler's clothes, because sites pick who they answer.
 *
 * Runs as a Vercel serverless function at /api/preview?url=...
 * Results are cached on Vercel's edge for a day, so a link pasted into a
 * busy room is fetched once, not once per member.
 */

var OEMBED = [
  { match: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i,
    api: 'https://www.youtube.com/oembed?format=json&url=', site: 'YouTube' },
  { match: /(^|\.)(twitter|x)\.com$/i,
    api: 'https://publish.twitter.com/oembed?omit_script=1&url=', site: 'X' },
  { match: /(^|\.)vimeo\.com$/i,
    api: 'https://vimeo.com/api/oembed.json?url=', site: 'Vimeo' },
  { match: /(^|\.)tiktok\.com$/i,
    api: 'https://www.tiktok.com/oembed?url=', site: 'TikTok' },
  { match: /(^|\.)rumble\.com$/i,
    api: 'https://rumble.com/api/Media/oembed.json?url=', site: 'Rumble' }
];

/* The one real danger of a URL-fetching endpoint is being pointed at
   something internal. Refuse anything that is not a public web host. */
function refused(hostname) {
  var h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  var m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    var a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
  }
  if (h.indexOf(':') > -1) return true;   // IPv6 literals: not worth the risk
  return false;
}

function pick(html, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—');
}

function meta(name) {
  /* property/name before content, and content before property/name */
  return [
    new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
    new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + name + '["\']', 'i')
  ];
}

function get(url, ua, accept) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 6000);
  return fetch(url, {
    signal: controller.signal,
    redirect: 'follow',
    headers: { 'User-Agent': ua, 'Accept': accept || '*/*' }
  }).finally(function () { clearTimeout(timer); });
}

/* Door 1: the platform's own preview service. */
async function fromOembed(target) {
  var hit = null;
  for (var i = 0; i < OEMBED.length; i++) {
    if (OEMBED[i].match.test(target.hostname)) { hit = OEMBED[i]; break; }
  }
  if (!hit) return null;
  /* X's service still answers under its old name. */
  var asked = target.href.replace(/^https?:\/\/(www\.)?x\.com/i, 'https://twitter.com');
  try {
    var r = await get(hit.api + encodeURIComponent(asked),
      'Mozilla/5.0 (compatible; StateRoomsPreview/1.0)', 'application/json');
    if (!r.ok) return null;
    var j = await r.json();
    /* A post's text arrives as markup — keep the words, drop the tags. */
    var desc = j.html ? unescapeHtml(String(j.html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
    var title = j.title || (j.author_name ? j.author_name + ' on ' + hit.site : '');
    if (!title && !j.thumbnail_url && !desc) return null;
    return {
      title: String(title).slice(0, 200),
      desc: desc.slice(0, 300),
      image: j.thumbnail_url && /^https?:\/\//i.test(j.thumbnail_url) ? j.thumbnail_url : '',
      site: String(j.provider_name || hit.site).slice(0, 80)
    };
  } catch (e) { return null; }
}

/* Door 2: the page's own preview tags. */
async function fromTags(target, ua) {
  var r = await get(target.href, ua, 'text/html,application/xhtml+xml');
  var type = r.headers.get('content-type') || '';
  if (!r.ok || type.indexOf('html') === -1) return null;

  var reader = r.body.getReader();
  var got = '', decoder = new TextDecoder();
  while (got.length < 300000) {
    var step = await reader.read();
    if (step.done) break;
    got += decoder.decode(step.value, { stream: true });
    if (/<\/head>/i.test(got)) break;
  }
  try { reader.cancel(); } catch (e) {}

  var title = pick(got, meta('og:title')) || pick(got, meta('twitter:title')) ||
              pick(got, [/<title[^>]*>([^<]+)<\/title>/i]);
  /* Every place a picture hides. */
  var image = pick(got, meta('og:image')) ||
              pick(got, meta('og:image:secure_url')) ||
              pick(got, meta('og:image:url')) ||
              pick(got, meta('twitter:image')) ||
              pick(got, meta('twitter:image:src')) ||
              pick(got, [/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
                         /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i]);
  var desc = pick(got, meta('og:description')) || pick(got, meta('description'));
  var site = pick(got, meta('og:site_name'));

  if (image) {
    try { image = new URL(unescapeHtml(image), r.url || target.href).href; } catch (e) { image = ''; }
    if (image && !/^https?:\/\//i.test(image)) image = '';
  }
  if (!title && !image) return null;
  return {
    title: unescapeHtml(title).slice(0, 200),
    desc: unescapeHtml(desc).slice(0, 300),
    image: image,
    site: unescapeHtml(site).slice(0, 80)
  };
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');

  var raw = (req.query && req.query.url) || '';
  var target;
  try { target = new URL(raw); } catch (e) { target = null; }
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:') ||
      target.username || target.password || refused(target.hostname)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'not a previewable address' }));
    return;
  }

  var out = null;
  try { out = await fromOembed(target); } catch (e) {}
  if (!out) {
    try { out = await fromTags(target, 'facebookexternalhit/1.1 (+StateRooms link preview)'); } catch (e) {}
  }
  if (!out) {
    /* Sites pick which crawlers they answer — one more try, different clothes. */
    try { out = await fromTags(target, 'Twitterbot/1.0'); } catch (e) {}
  }

  if (!out) {
    res.statusCode = 204;
    res.end('{}');
    return;
  }
  /* A pasted link is fetched once for the whole community, then served
     from Vercel's cache for a day. */
  res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
  res.end(JSON.stringify(out));
};
