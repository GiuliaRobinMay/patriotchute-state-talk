/* Serves generated artwork through our own address. The sign-in flag was
 * created with an image model; its file lives on the generator's CDN,
 * which the app must not depend on directly — this proxies it once and
 * Vercel's edge cache keeps it for a year, effectively self-hosted. */

var SOURCES = {
  flag: 'https://d8j0ntlcm91z4.cloudfront.net/user_3HBpPG4au02JHQnNtfHuixe9AKw/hf_20260820_101044_a7d9ca05-9424-4491-a015-b1b80a483091.png'
};

module.exports = async function (req, res) {
  var src = SOURCES[(req.query && req.query.k) || 'flag'];
  if (!src) { res.statusCode = 404; res.end(); return; }
  try {
    var r = await fetch(src);
    if (!r.ok) throw new Error('upstream ' + r.status);
    var buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=31536000, max-age=86400, immutable');
    res.end(buf);
  } catch (e) {
    res.statusCode = 502;
    res.end();
  }
};
