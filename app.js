/* State Rooms — preview build.
 *
 * Everything here runs in the browser with no server. Profiles, messages and
 * announcements live in this device's local storage, which is deliberate: it
 * lets us put the real app inside a real embed and find out what the browser
 * allows before committing to a backend.
 *
 * Storage is wrapped because an embedded page is exactly where localStorage
 * throws — Safari partitions it, and some privacy modes disable it outright.
 * If it fails we fall back to memory so the app still runs for the session.
 */
(function () {
  'use strict';

  var S = window.STATES, LIVE = window.LIVE_SEED, COLORS = window.AV_COLORS;
  var KEY = 'stateRooms.v1.';

  /* ── storage ─────────────────────────────────────────────── */
  var memory = {}, storageWorks = true;
  try {
    window.localStorage.setItem(KEY + 'probe', '1');
    window.localStorage.removeItem(KEY + 'probe');
  } catch (e) { storageWorks = false; }

  function put(k, v) {
    var s = JSON.stringify(v);
    memory[k] = s;
    if (storageWorks) { try { localStorage.setItem(KEY + k, s); } catch (e) { storageWorks = false; } }
  }
  function get(k, fallback) {
    var raw = null;
    if (storageWorks) { try { raw = localStorage.getItem(KEY + k); } catch (e) { storageWorks = false; } }
    if (raw === null) raw = memory[k] || null;
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  /* ── small helpers ───────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    return (((p[0] || '')[0] || '') + ((p[1] || '')[0] || '')).toUpperCase() || '?';
  }
  function clock(ts) {
    var d = new Date(ts), h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function byAbbr(a) { for (var i = 0; i < S.length; i++) if (S[i].a === a) return S[i]; return S[34]; }
  function avatar(el, person) {
    el.textContent = '';
    if (person.photo) {
      var img = new Image();
      img.src = person.photo; img.alt = '';
      el.appendChild(img);
      el.style.background = 'transparent';
    } else {
      el.style.background = person.bg || '#7186AB';
      el.style.color = person.fg || '#0D1729';
      el.textContent = initials(person.name);
    }
  }

  /* ── state ───────────────────────────────────────────────── */
  var me = get('profile', null);
  var room = byAbbr(get('lastRoom', 'OH'));
  var view = 'vJoin';

  function show(v) {
    view = v;
    ['vJoin', 'vRooms', 'vRoom', 'vAnn'].forEach(function (id) {
      $(id).classList.toggle('on', id === v);
    });
    if (v === 'vRoom') { $('ci').focus({ preventScroll: true }); }
  }

  /* ── preview banner ──────────────────────────────────────── */
  if (get('hidePreviewBar', false)) $('pbar').hidden = true;
  $('pbarX').onclick = function () { $('pbar').hidden = true; put('hidePreviewBar', true); };

  /* ── join ────────────────────────────────────────────────── */
  var sel = $('stt');
  S.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.a; o.textContent = s.n;
    sel.appendChild(o);
  });

  var swatches = [].slice.call(document.querySelectorAll('#pick .pk'));
  var chosenColor = COLORS[0], uploaded = null;

  function paintSwatches() {
    var ini = initials($('nm').value) ;
    swatches.forEach(function (sw) {
      if (uploaded && sw.getAttribute('aria-pressed') === 'true') return;
      sw.textContent = ini;
    });
  }
  function pickColor(sw) {
    uploaded = null;
    swatches.forEach(function (x) {
      x.setAttribute('aria-pressed', String(x === sw));
      x.textContent = initials($('nm').value);
      x.style.background = x.dataset.bg;
      x.style.color = x.dataset.fg;
    });
    chosenColor = { bg: sw.dataset.bg, fg: sw.dataset.fg };
  }
  swatches.forEach(function (sw) {
    sw.onclick = function () { pickColor(sw); };
    sw.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickColor(sw); }
    };
  });

  $('upBtn').onclick = function () { $('upFile').click(); };
  $('upFile').onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('That image is over 3 MB — please pick a smaller one.'); return; }
    var r = new FileReader();
    r.onload = function () {
      uploaded = r.result;
      var first = swatches[0];
      swatches.forEach(function (x) { x.setAttribute('aria-pressed', String(x === first)); });
      first.textContent = '';
      first.style.background = 'transparent';
      var img = new Image(); img.src = uploaded; img.alt = '';
      first.appendChild(img);
    };
    r.readAsDataURL(file);
  };

  $('nm').oninput = paintSwatches;

  /* The member check is a placeholder until Zapier feeds a real list.
     The shape of the interaction is final — only the lookup changes. */
  var emchk = $('emchk');
  $('em').oninput = function () {
    var v = $('em').value.trim();
    if (!v) { emchk.className = 'chk wait'; emchk.textContent = ''; return; }
    if (/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) {
      emchk.className = 'chk ok';
      emchk.textContent = '✓ Looks good — member checking comes online with the database';
    } else {
      emchk.className = 'chk wait';
      emchk.textContent = 'checking…';
    }
  };

  $('joinBtn').onclick = function () {
    var name = $('nm').value.trim();
    if (!name) { $('nm').focus(); emchk.className = 'chk no'; emchk.textContent = '✕ We need a name to show in the room'; return; }
    me = {
      id: 'me',
      email: $('em').value.trim(),
      name: name,
      city: $('cty').value.trim(),
      state: sel.value,
      photo: uploaded,
      bg: chosenColor.bg,
      fg: chosenColor.fg
    };
    put('profile', me);
    room = byAbbr(me.state);
    put('lastRoom', room.a);
    drawGrid(''); drawRail(); openRoom(room);
  };

  /* ── rooms grid ──────────────────────────────────────────── */
  function headcount(s) { return s.seed; }

  function drawGrid(q) {
    var grid = $('grid');
    q = (q || '').trim().toLowerCase();
    grid.textContent = '';
    var list = myStates().filter(function (s) {
      return !q || s.n.toLowerCase().indexOf(q) === 0 || s.a.toLowerCase() === q;
    });
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'hint'; p.textContent = 'No state matches that.';
      grid.appendChild(p); return;
    }
    list.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'st' + (LIVE.indexOf(s.a) > -1 ? ' lv' : '') + (me && me.state === s.a ? ' mine' : '');
      var ab = document.createElement('span'); ab.className = 'ab'; ab.textContent = s.a;
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.n;
      var ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = headcount(s);
      b.appendChild(ab); b.appendChild(nm); b.appendChild(ct);
      b.onclick = function () { openRoom(s); };
      grid.appendChild(b);
    });
  }
  $('q').oninput = function (e) { drawGrid(e.target.value); };
  $('meBtn').onclick = function () {
    if (!me) return;
    if (confirm('Sign out and set up again on this device?')) {
      put('profile', null); me = null; show('vJoin');
    }
  };

  /* ── the rail ────────────────────────────────────────────── */
  /* Members belong to one state. The rail lists only their own room, plus a
     way out if they move house — browsing all 51 was making the app feel like
     a directory rather than somewhere you live. Hosts still see everything. */
  function myStates() {
    if (!me) return S;
    if (me.host) return S;
    return S.filter(function (s) { return s.a === me.state; });
  }

  function drawRail() {
    var rail = $('rail');
    rail.textContent = '';
    var mine = myStates();
    var l = document.createElement('div'); l.className = 'rl';
    l.textContent = me && !me.host ? 'Your state' : 'All states';
    rail.appendChild(l);
    mine.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ri' + (s.a === room.a ? ' cur' : '') + (LIVE.indexOf(s.a) > -1 ? ' on' : '');
      var d = document.createElement('span'); d.className = 'd';
      var n = document.createElement('span'); n.className = 'n'; n.textContent = s.n;
      var c = document.createElement('span'); c.className = 'c'; c.textContent = headcount(s);
      b.appendChild(d); b.appendChild(n); b.appendChild(c);
      b.onclick = function () { openRoom(s); };
      rail.appendChild(b);
    });
    if (me && !me.host) {
      var move = document.createElement('button');
      move.type = 'button'; move.className = 'ri';
      move.style.marginTop = '10px'; move.style.color = 'var(--faint)';
      move.textContent = 'I’ve moved state';
      move.onclick = changeState;
      rail.appendChild(move);
    }
  }

  function changeState() {
    var name = prompt('Which state are you in now?', byAbbr(me.state).n);
    if (!name) return;
    var q = name.trim().toLowerCase();
    var found = null;
    S.forEach(function (s) {
      if (s.n.toLowerCase() === q || s.a.toLowerCase() === q) found = s;
    });
    if (!found) { alert('I don’t recognise “' + name + '”. Try the full state name.'); return; }
    me.state = found.a;
    put('profile', me);
    openRoom(found);
  }

  /* ── a room ──────────────────────────────────────────────── */
  function openRoom(s) {
    room = s;
    put('lastRoom', s.a);
    $('tNm').textContent = s.n;
    $('tAb').textContent = s.a;
    $('tCt').textContent = headcount(s) + ' here';
    $('ci').placeholder = 'Message ' + s.n + '…';
    drawRail(); drawNotice(); drawChat(); drawWho();
    show('vRoom');
  }
  $('backBtn').onclick = function () { drawGrid($('q').value); show('vRooms'); };

  function msgKey() { return 'msgs.' + room.a; }

  function drawChat() {
    var chat = $('chat');
    chat.textContent = '';
    var msgs = get(msgKey(), []);
    if (!msgs.length) {
      var e = document.createElement('div');
      e.className = 'sys';
      e.textContent = 'Nothing here yet. Say hello to ' + room.n + '.';
      chat.appendChild(e);
    }
    msgs.forEach(function (m) { chat.appendChild(msgEl(m)); });
    chat.scrollTop = chat.scrollHeight;
  }

  function msgEl(m) {
    var wrap = document.createElement('div'); wrap.className = 'm';
    var av = document.createElement('span'); av.className = 'av sm';
    avatar(av, m);
    var b = document.createElement('div'); b.className = 'b';
    var h = document.createElement('div'); h.className = 'h';
    var who = document.createElement('span'); who.className = 'who'; who.textContent = m.name;
    h.appendChild(who);
    if (m.city) { var cy = document.createElement('span'); cy.className = 'cy'; cy.textContent = m.city; h.appendChild(cy); }
    var tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = clock(m.ts);
    h.appendChild(tm);
    var tx = document.createElement('div'); tx.className = 'tx'; tx.textContent = m.text;
    b.appendChild(h); b.appendChild(tx);
    wrap.appendChild(av); wrap.appendChild(b);
    return wrap;
  }

  $('cmp').onsubmit = function (e) {
    e.preventDefault();
    var i = $('ci'), text = i.value.trim();
    if (!text || !me) return;
    var msgs = get(msgKey(), []);
    var m = { name: me.name, city: me.city, photo: me.photo, bg: me.bg, fg: me.fg, text: text, ts: Date.now() };
    msgs.push(m);
    if (msgs.length > 300) msgs = msgs.slice(-300);
    put(msgKey(), msgs);
    var chat = $('chat');
    if (msgs.length === 1) chat.textContent = '';
    chat.appendChild(msgEl(m));
    chat.scrollTop = chat.scrollHeight;
    i.value = '';
  };

  /* Roster: online first with a green dot, then everyone else in the state.
     Big states run to hundreds of members, so the offline list is capped —
     a scroll of 390 grey names tells you nothing you wanted to know. */
  var OFFLINE_SHOWN = 25;

  function personRow(p, isYou) {
    var row = document.createElement('div');
    row.className = 'wp' + (p.online || isYou ? '' : ' off');
    var av = document.createElement('span'); av.className = 'av xs';
    avatar(av, {
      name: p.name, photo: p.photo,
      bg: p.bg || COLORS[p.name.length % COLORS.length].bg,
      fg: p.fg || COLORS[p.name.length % COLORS.length].fg
    });
    var t = document.createElement('span'); t.className = 't';
    var n = document.createElement('span'); n.className = 'n';
    n.textContent = p.name + (isYou ? ' (you)' : '');
    t.appendChild(n);
    if (p.city) { var c = document.createElement('span'); c.className = 'c'; c.textContent = p.city; t.appendChild(c); }
    row.appendChild(av); row.appendChild(t);
    if (p.online || isYou) { var d = document.createElement('span'); d.className = 'mk'; d.textContent = '●'; row.appendChild(d); }
    return row;
  }

  function label(text) {
    var l = document.createElement('div'); l.className = 'wl'; l.textContent = text;
    return l;
  }

  function drawWho() {
    var w = $('whoList');
    w.textContent = '';

    var sample = window.SAMPLE_PEOPLE || [];
    var online = sample.filter(function (p) { return p.online; });
    var offline = sample.filter(function (p) { return !p.online; });
    var total = headcount(room);

    w.appendChild(label('Online · ' + (online.length + (me ? 1 : 0))));
    if (me) w.appendChild(personRow(me, true));
    online.forEach(function (p) { w.appendChild(personRow(p)); });

    w.appendChild(label('Also in ' + room.n + ' · ' + total));
    offline.slice(0, OFFLINE_SHOWN).forEach(function (p) { w.appendChild(personRow(p)); });

    var rest = total - offline.slice(0, OFFLINE_SHOWN).length - online.length - (me ? 1 : 0);
    if (rest > 0) {
      var more = document.createElement('p');
      more.className = 'hint'; more.style.padding = '9px 6px 0';
      more.textContent = '+ ' + rest.toLocaleString('en-US') + ' more';
      w.appendChild(more);
    }

    var note = document.createElement('p');
    note.className = 'hint';
    note.style.cssText = 'padding:12px 6px 0;border-top:1px solid var(--line);margin-top:10px';
    note.textContent = 'Example members — real ones appear once the database is connected.';
    w.appendChild(note);
  }

  /* ── emoji ───────────────────────────────────────────────
     Deliberately a small fixed set rather than a full picker: the whole
     Unicode catalogue is a search box nobody wants in a chat this simple. */
  var EMOJI = ('😀 😂 🙂 😉 😍 🤔 😅 😮 😢 🙃 😎 🥳 👋 👍 👎 🙌 👏 🤝 💪 🙏 ❤️ 🔥 ⭐ ✅ ❌ ☕ 🎉 🎂 🚗 🏡 ☀️ 🌧️ ❄️ 🇺🇸 📌 ⏰').split(' ');
  var tray = $('emoji'), emjBtn = $('emjBtn');

  EMOJI.forEach(function (ch) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = ch; b.setAttribute('aria-label', ch);
    b.onclick = function () {
      var i = $('ci');
      i.value = i.value + (i.value && !/\s$/.test(i.value) ? ' ' : '') + ch;
      i.focus();
    };
    tray.appendChild(b);
  });

  function toggleTray(open) {
    tray.hidden = !open;
    emjBtn.setAttribute('aria-expanded', String(open));
  }
  emjBtn.onclick = function () { toggleTray(tray.hidden); };

  /* ── the ⋯ menu ──────────────────────────────────────────── */
  var meMenu = $('meMenu'), meBtn2 = $('meBtn2');
  function toggleMenu(open) {
    meMenu.hidden = !open;
    meBtn2.setAttribute('aria-expanded', String(open));
  }
  meBtn2.onclick = function (e) { e.stopPropagation(); toggleMenu(meMenu.hidden); };
  document.addEventListener('click', function () { toggleMenu(false); });
  meMenu.onclick = function (e) { e.stopPropagation(); };
  $('mMove').onclick = function () { toggleMenu(false); changeState(); };
  $('mOut').onclick = function () {
    toggleMenu(false);
    if (!confirm('Sign out and set up again on this device?')) return;
    put('profile', null); me = null; show('vJoin');
  };

  /* ── the microphone ──────────────────────────────────────
     Measured on the real community (11 Aug 2026): Mighty Networks does not
     pass microphone permission into the frame, so getUserMedia in the embed
     fails with NotAllowedError no matter what the member does.

     So when we are embedded and the policy says no, we don't ask and fail —
     we open the room in its own tab, where the microphone works normally and
     the member is already signed in. One extra tap instead of a dead end. If
     a host ever does grant the permission, the check below sees it and voice
     happens inline as it should. */
  var micStream = null, micBtn = $('micBtn');

  var framed = true;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }

  function micPermitted() {
    try {
      if (document.featurePolicy && document.featurePolicy.allowsFeature) {
        return document.featurePolicy.allowsFeature('microphone');
      }
    } catch (e) {}
    return null;              // browser won't say — worth trying
  }

  function popOut() {
    /* No 'noopener' feature here: it forces window.open to return null, which
       would make every successful pop-out look like a blocked one. Sever the
       link afterwards instead — same origin, so this is allowed. */
    var w = window.open(location.origin + location.pathname + '?voice=' + room.a, '_blank');
    try { if (w) w.opener = null; } catch (e) {}
    if (!w) {
      micBtn.className = 'jn err';
      micBtn.textContent = 'Allow pop-ups to talk';
      $('vNames').textContent = 'Your browser blocked the new tab — allow pop-ups for this site';
      return;
    }
    micBtn.className = 'jn out';
    micBtn.textContent = '🎙 Talking in the other tab';
    $('vNames').textContent = 'Voice opened in its own tab — chat carries on here';
  }

  function startMic() {
    micBtn.textContent = 'Asking…';
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micStream = stream;
      micBtn.className = 'jn out';
      micBtn.textContent = 'Leave the mic';
      renderMics();
      meter(stream);
    });
  }

  micBtn.onclick = function () {
    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
      micBtn.className = 'jn';
      micBtn.textContent = '🎙 Join the mic';
      renderMics();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micBtn.className = 'jn err';
      micBtn.textContent = 'Voice not supported here';
      return;
    }
    if (framed && micPermitted() === false) { popOut(); return; }

    startMic().catch(function (err) {
      var name = (err && err.name) || 'Error';
      if (name === 'NotAllowedError' && framed) { popOut(); return; }
      micBtn.className = 'jn err';
      micBtn.textContent = name === 'NotAllowedError' ? 'Microphone blocked' : 'No microphone found';
      $('vNames').textContent = name === 'NotAllowedError'
        ? 'You declined the microphone — press the button again to allow it'
        : 'No microphone on this device';
    });
  };

  /* Say what the button will actually do, before it's pressed. */
  if (framed && micPermitted() === false) micBtn.textContent = '🎙 Open a tab to talk';

  function renderMics() {
    var mics = $('mics');
    mics.textContent = '';
    if (!micStream || !me) {
      $('vNames').textContent = 'Nobody yet — be the first';
      return;
    }
    var w = document.createElement('span'); w.className = 'w'; w.id = 'myMic';
    var ring = document.createElement('span'); ring.className = 'ring';
    var av = document.createElement('span'); av.className = 'av sm'; avatar(av, me);
    w.appendChild(ring); w.appendChild(av);
    mics.appendChild(w);
    $('vNames').innerHTML = '';
    var b = document.createElement('b'); b.textContent = me.name;
    $('vNames').appendChild(b);
    $('vNames').appendChild(document.createTextNode(' — your mic is live'));
  }

  /* Lights the ring when you actually make noise, so it is obvious the
     microphone is working rather than merely permitted. */
  function meter(stream) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    var src = ctx.createMediaStreamSource(stream);
    var an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    var data = new Uint8Array(an.frequencyBinCount);
    (function tick() {
      if (!micStream) { try { ctx.close(); } catch (e) {} return; }
      an.getByteFrequencyData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i++) sum += data[i];
      var el = $('myMic');
      if (el) el.classList.toggle('talk', (sum / data.length) > 8);
      requestAnimationFrame(tick);
    })();
  }

  /* ── announcements ───────────────────────────────────────── */
  function currentNotice() {
    var n = get('notice', null);
    if (!n) return null;
    if (n.until && Date.now() > n.until) { put('notice', null); return null; }
    if (!n.all && n.rooms.indexOf(room.a) === -1) return null;
    if (get('dismissed.' + n.id, false)) return null;
    return n;
  }
  function drawNotice() {
    var n = currentNotice();
    var box = $('notice');
    if (!n) { box.hidden = true; return; }
    box.hidden = false;
    $('nFrom').textContent = '';
    var s1 = document.createElement('span');
    s1.textContent = '📌 Pinned by ';
    var b = document.createElement('b'); b.textContent = n.by;
    s1.appendChild(b);
    $('nFrom').appendChild(s1);
    if (n.until) {
      var s2 = document.createElement('span');
      s2.textContent = '· clears ' + new Date(n.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      $('nFrom').appendChild(s2);
    }
    $('nTitle').textContent = n.title;
    $('nBody').textContent = n.body;
    $('nX').onclick = function () { put('dismissed.' + n.id, true); box.hidden = true; };
  }

  function radio(box, after) {
    var opts = [].slice.call(box.querySelectorAll('.opt'));
    opts.forEach(function (o) {
      o.onclick = function () {
        opts.forEach(function (x) { x.setAttribute('aria-pressed', String(x === o)); });
        if (after) after(o);
      };
    });
  }

  var picking = false, chosenRooms = {};
  radio($('expiry'));
  radio($('aud'), function (o) {
    picking = o.dataset.all === '0';
    $('chips').hidden = !picking;
    tally();
  });

  S.forEach(function (s) {
    var c = document.createElement('button');
    c.type = 'button'; c.className = 'chip';
    c.setAttribute('aria-pressed', 'false');
    c.textContent = s.a;
    c.title = s.n;
    c.onclick = function () {
      var on = c.getAttribute('aria-pressed') === 'true';
      c.setAttribute('aria-pressed', String(!on));
      if (on) delete chosenRooms[s.a]; else chosenRooms[s.a] = s.seed;
      tally();
    };
    $('chips').appendChild(c);
  });

  var lastCount = S.length;
  function tally() {
    var rooms, people;
    if (!picking) {
      rooms = S.length;
      people = S.reduce(function (a, s) { return a + s.seed; }, 0);
    } else {
      var keys = Object.keys(chosenRooms);
      rooms = keys.length;
      people = keys.reduce(function (a, k) { return a + chosenRooms[k]; }, 0);
    }
    lastCount = rooms;
    var n = $('postN');
    if (n) n.textContent = rooms;
    $('reachN').textContent = people.toLocaleString('en-US');
    $('postBtn').disabled = rooms === 0;
  }

  $('aTitle').oninput = function () { $('pvT').textContent = this.value || 'Your headline'; };
  $('aBody').oninput = function () { $('pvB').textContent = this.value || 'Your note.'; };

  $('postBtn').onclick = function () {
    var title = $('aTitle').value.trim();
    if (!title) { $('aTitle').focus(); return; }
    var days = Number(document.querySelector('#expiry .opt[aria-pressed="true"]').dataset.days);
    put('notice', {
      id: String(Date.now()),
      by: (me && me.name) || 'a host',
      title: title,
      body: $('aBody').value.trim(),
      all: !picking,
      rooms: Object.keys(chosenRooms),
      until: days ? Date.now() + days * 86400000 : 0
    });
    var b = this, count = lastCount;
    b.textContent = '✓ Pinned to ' + count + ' rooms';
    setTimeout(function () {
      b.textContent = '';
      b.appendChild(document.createTextNode('Pin to '));
      var sp = document.createElement('span'); sp.id = 'postN'; sp.textContent = count;
      b.appendChild(sp);
      b.appendChild(document.createTextNode(' rooms'));
    }, 2000);
  };
  $('clearBtn').onclick = function () { put('notice', null); alert('Notice taken down.'); };
  $('annBack').onclick = function () { drawNotice(); show('vRoom'); };

  /* Host view is reachable at #announce until real roles exist. */
  function checkHash() {
    if (location.hash === '#announce') {
      $('pvWho').textContent = (me && me.name) || 'you';
      var d = new Date(Date.now() + 14 * 86400000);
      $('exp14').textContent = 'Clears itself on ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      tally();
      show('vAnn');
    }
  }
  window.addEventListener('hashchange', checkHash);

  /* ── boot ────────────────────────────────────────────────── */
  drawGrid('');

  /* ?voice=OH — this tab was opened from the embed so someone could talk.
     Land in that room and turn the microphone on without a second press. */
  var wantVoice = (location.search.match(/[?&]voice=([A-Z]{2})/) || [])[1];

  if (me) {
    $('em').value = me.email || '';
    $('nm').value = me.name;
    $('cty').value = me.city || '';
    sel.value = me.state;
    openRoom(wantVoice ? byAbbr(wantVoice) : room);
    if (wantVoice && !framed) {
      $('vNames').textContent = 'Opening your microphone…';
      startMic().catch(function () {
        micBtn.className = 'jn';
        micBtn.textContent = '🎙 Join the mic';
        $('vNames').textContent = 'Press the button when you are ready to talk';
      });
    }
  } else {
    paintSwatches();
    show('vJoin');
  }
  checkHash();

  if (!storageWorks) {
    var warn = $('pbar');
    warn.hidden = false;
    warn.firstElementChild.innerHTML =
      '<b>Heads up.</b> This browser is blocking storage inside the embed — you will be asked to set up again next visit. Worth knowing.';
  }
})();
