/* Link previews, the way every chat app makes them: this function visits
 * the pasted address from the server side (the browser is not allowed to),
 * reads the page's own preview tags — the ones sites write for Facebook
 * and friends — and hands back title, image and site name.
 *
 * Runs as a Vercel serverless function at /api/preview?url=...
 * Results are cached on Vercel's edge for a day, so a link pasted into a
 * busy room is fetched once, not once per member.
 */

/* The one real danger of a URL-fetching endpoint is being pointed at
   something internal. Refuse anything that is not a public web host. */
function refused(hostname) {
  var h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  /* IP literals: allow none of the private/reserved ranges. */
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
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'");
}

function meta(name) {
  /* property/name before content, and content before property/name */
  return [
    new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
    new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + name + '["\']', 'i')
  ];
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

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 6000);

  try {
    var r = await fetch(target.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        /* Sites hand their preview tags to the fetchers they know. */
        'User-Agent': 'facebookexternalhit/1.1 (+StateRooms link preview)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timer);

    var type = r.headers.get('content-type') || '';
    if (!r.ok || type.indexOf('html') === -1) {
      res.statusCode = 204;
      res.end('{}');
      return;
    }

    /* The preview tags live in the head — the first chunk is enough. */
    var reader = r.body.getReader();
    var got = '', decoder = new TextDecoder();
    while (got.length < 300000) {
      var step = await reader.read();
      if (step.done) break;
      got += decoder.decode(step.value, { stream: true });
      if (/<\/head>/i.test(got)) break;
    }
    try { controller.abort(); } catch (e) {}

    var title = pick(got, meta('og:title')) || pick(got, meta('twitter:title')) ||
                pick(got, [/<title[^>]*>([^<]+)<\/title>/i]);
    /* Every place a picture hides: Facebook and friends use several. */
    var image = pick(got, meta('og:image')) ||
                pick(got, meta('og:image:secure_url')) ||
                pick(got, meta('og:image:url')) ||
                pick(got, meta('twitter:image')) ||
                pick(got, meta('twitter:image:src')) ||
                pick(got, [/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
                           /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i]);
    var desc  = pick(got, meta('og:description')) || pick(got, meta('description'));
    var site  = pick(got, meta('og:site_name'));

    if (image) {
      try { image = new URL(unescapeHtml(image), r.url || target.href).href; } catch (e) { image = ''; }
      if (image && !/^https?:\/\//i.test(image)) image = '';
    }

    /* A pasted link is fetched once for the whole community, then served
       from Vercel's cache for a day. */
    res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
    res.end(JSON.stringify({
      title: unescapeHtml(title).slice(0, 200),
      desc: unescapeHtml(desc).slice(0, 300),
      image: image,
      site: unescapeHtml(site).slice(0, 80)
    }));
  } catch (e) {
    clearTimeout(timer);
    res.statusCode = 204;
    res.end('{}');
  }
};
