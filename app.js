/* State Rooms.
 *
 * The app talks to window.DB and never cares which kind it got. With the
 * database configured that's a shared store and two people see the same
 * room; without it, everything stays on this device and the banner at the
 * top says so.
 */
(function () {
  'use strict';

  var S = window.STATES, COLORS = window.AV_COLORS;
  var db = window.DB;

  /* ── helpers ─────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    return (((p[0] || '')[0] || '') + ((p[1] || '')[0] || '')).toUpperCase() || '?';
  }
  function clock(ts) {
    var d = new Date(ts), h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function byAbbr(a) {
    for (var i = 0; i < S.length; i++) if (S[i].a === a) return S[i];
    return S[34];
  }
  function colorFor(name) { return COLORS[String(name).length % COLORS.length]; }

  function avatar(el, person) {
    el.textContent = '';
    el.style.background = '';
    if (person.photo) {
      var img = new Image();
      img.src = person.photo; img.alt = '';
      el.appendChild(img);
      el.style.background = 'transparent';
      return;
    }
    var c = colorFor(person.name);
    el.style.background = person.bg || c.bg;
    el.style.color = person.fg || c.fg;
    el.textContent = initials(person.name);
  }

  /* What Google handed back, captured before the data layer tidies the URL
     away. Shown on the sign-in screen when a return trip fails, so the
     reason is on screen instead of needing to be dug out of the address
     bar by hand. */
  var ARRIVED = (location.search || '') + (location.hash || '');

  /* ── state ───────────────────────────────────────────────────── */
  var framed = true;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }

  var me = null;
  var room = byAbbr('OH');
  var onlineIds = {};
  var members = [];
  var stopMessages = function () {};
  var stopPresence = function () {};

  function show(v) {
    ['vJoin', 'vRoom', 'vAnn'].forEach(function (id) {
      $(id).classList.toggle('on', id === v);
    });
    if (v === 'vRoom') { try { $('ci').focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ── the banner ──────────────────────────────────────────────── */
  function updateBanner() {
    var bar = $('pbar'), text = bar.firstElementChild;
    if (!db.storageWorks()) {
      bar.hidden = false;
      text.innerHTML = '<b>Heads up.</b> This browser is blocking storage inside the embed — you may be asked to set up again next visit.';
      return;
    }
    if (db.shared) { bar.hidden = true; return; }
    if (db.pref('hidePreviewBar', false)) { bar.hidden = true; return; }
    bar.hidden = false;
  }
  $('pbarX').onclick = function () { $('pbar').hidden = true; db.setPref('hidePreviewBar', true); };

  /* ── join ────────────────────────────────────────────────────── */
  var sel = $('stt');
  S.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.a; o.textContent = s.n;
    sel.appendChild(o);
  });

  var swatches = [].slice.call(document.querySelectorAll('#pick .pk'));
  var chosenColor = COLORS[0], uploaded = null;

  function paintSwatches() {
    var ini = initials($('nm').value);
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
    if (file.size > 1.5 * 1024 * 1024) { alert('That image is over 1.5 MB — please pick a smaller one.'); return; }
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

  /* Name availability. Debounced, because it asks the database on each
     keystroke otherwise, and it re-runs when the state changes since a name
     is only taken within one room. */
  var nmchk = $('nmchk'), nameTimer = null, nameFree = true;

  function suggest(base) {
    var m = base.match(/^(.*?)(\d+)$/);
    return m ? m[1] + (Number(m[2]) + 1) : base + ' 2';
  }

  function checkName() {
    var v = $('nm').value.trim();
    nameFree = true;
    if (!v) { nmchk.className = 'chk wait'; nmchk.textContent = ''; return; }
    if (!db.shared) { nmchk.className = 'chk ok'; nmchk.textContent = '✓ Looks good'; return; }
    nmchk.className = 'chk wait';
    nmchk.textContent = 'checking…';
    db.nameTaken(sel.value, v).then(function (taken) {
      if ($('nm').value.trim() !== v) return;          // they kept typing
      nameFree = !taken;
      if (taken) {
        nmchk.className = 'chk no';
        nmchk.textContent = '✕ Someone in ' + byAbbr(sel.value).n + ' already goes by that — try ' + suggest(v);
      } else {
        nmchk.className = 'chk ok';
        nmchk.textContent = '✓ ' + v + ' is free in ' + byAbbr(sel.value).n;
      }
    }).catch(function () {
      nmchk.className = 'chk wait';
      nmchk.textContent = '';
    });
  }

  $('nm').oninput = function () {
    paintSwatches();
    clearTimeout(nameTimer);
    nameTimer = setTimeout(checkName, 450);
  };

  function cityHint() {
    var towns = (window.CITIES || {})[sel.value];
    $('cty').placeholder = towns ? towns[0] : 'Your nearest city';
  }
  sel.onchange = function () { cityHint(); checkName(); };

  /* ── signing in ──────────────────────────────────────────────
     Google will not render its consent screen inside an iframe, so in the
     embed the button opens a tab, signs in there, and hands the session
     back by message. Outside a frame it is a plain redirect. */
  var authchk = $('authchk');
  var POPUP = 'authpopup';

  function saySigningIn(msg, kind) {
    authchk.className = 'chk ' + (kind || 'wait');
    authchk.textContent = msg;
  }

  function popupUrl() {
    return location.origin + location.pathname + '?' + POPUP + '=1';
  }

  function afterSignIn() {
    return db.init().then(function (profile) {
      me = profile;
      if (me) { openRoom(byAbbr(me.state)); return; }
      showProfileStep();
    });
  }

  function showProfileStep() {
    $('signinBox').hidden = true;
    $('profileBox').hidden = false;
    var mail = db.email && db.email();
    $('whoLead').textContent = mail
      ? 'Signed in as ' + mail + '. This is what your state room sees.'
      : 'This is what your state room sees.';
    cityHint(); paintSwatches();
    show('vJoin');
    $('nm').focus();
  }

  $('googleBtn').onclick = function () {
    saySigningIn('Opening Google…');
    if (!framed) {
      db.signInWithGoogle(location.origin + location.pathname).catch(function (err) {
        saySigningIn('✕ ' + ((err && err.message) || 'Could not start sign-in'), 'no');
      });
      return;
    }
    var w = window.open(popupUrl(), 'stateRoomsSignIn', 'width=480,height=680');
    if (!w) {
      saySigningIn('✕ Your browser blocked the sign-in window — allow pop-ups for this site', 'no');
      return;
    }
    saySigningIn('Waiting for Google in the other window…');
  };

  /* The sign-in tab posts its session here when it is done. */
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.type !== 'stateRooms.session') return;
    if (!d.tokens) { saySigningIn('✕ Sign-in was cancelled', 'no'); return; }
    saySigningIn('Signed in — one moment…', 'ok');
    db.adoptTokens(d.tokens).then(afterSignIn).catch(function (err) {
      saySigningIn('✕ ' + ((err && err.message) || 'Could not finish sign-in'), 'no');
    });
  });

  /* If we've just come back from Google and still aren't signed in, say what
     actually arrived rather than silently showing this screen again. */
  function reportReturn() {
    var err = /[?&]error/.test(ARRIVED);
    var code = /[?&]code=/.test(ARRIVED);
    if (!err && !code) return;

    if (err) {
      var m = ARRIVED.match(/error_description=([^&]*)/) || ARRIVED.match(/error=([^&]*)/);
      saySigningIn('✕ Google refused: ' + decodeURIComponent((m ? m[1] : '').replace(/\+/g, ' ')), 'no');
      return;
    }
    /* A code came back but no session came of it. */
    saySigningIn('✕ Signed in with Google, but the app could not complete it. Details below.', 'no');
    var box = document.createElement('p');
    box.className = 'hint';
    box.style.cssText = 'font-family:var(--mono);font-size:11px;line-height:1.7;margin-top:10px;' +
      'border-left:2px solid var(--red);padding-left:10px;overflow-wrap:anywhere';
    box.textContent =
      'returned with: code' +
      ' · embedded: ' + (framed ? 'yes' : 'no') +
      ' · storage: ' + (db.storageWorks() ? 'ok' : 'BLOCKED') +
      ' · verifier: ' + (hasVerifier() ? 'present' : 'MISSING') +
      ' · shared: ' + (db.shared ? 'yes' : 'no');
    $('signinBox').appendChild(box);
  }

  /* The one-time secret the browser must keep between leaving for Google and
     coming back. If it's gone, the exchange cannot succeed. */
  function hasVerifier() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        if (/code-verifier/.test(localStorage.key(i))) return true;
      }
    } catch (e) {}
    return false;
  }

  $('anonBtn').onclick = function () {
    saySigningIn('One moment…');
    db.signInAnonymous().then(afterSignIn).catch(function (err) {
      saySigningIn('✕ ' + ((err && err.message) || 'Could not continue'), 'no');
    });
  };

  $('joinBtn').onclick = function () {
    var name = $('nm').value.trim();
    if (!name) {
      $('nm').focus();
      emchk.className = 'chk no';
      emchk.textContent = '✕ We need a name to show in the room';
      return;
    }
    if (!nameFree) {
      $('nm').focus();
      checkName();
      return;
    }
    var btn = this;
    btn.disabled = true;
    var profile = {
      email: (db.email && db.email()) || '',
      name: name,
      city: $('cty').value.trim(),
      state: sel.value,
      photo: uploaded,
      bg: chosenColor.bg,
      fg: chosenColor.fg
    };
    db.saveProfile(profile).then(function (saved) {
      me = saved;
      btn.disabled = false;
      openRoom(byAbbr(me.state));
    }).catch(function (err) {
      btn.disabled = false;
      emchk.className = 'chk no';
      emchk.textContent = '✕ Could not save that — ' + ((err && err.message) || 'try again');
    });
  };

  /* ── the room ────────────────────────────────────────────────── */
  function drawRail() {
    var rail = $('rail');
    rail.textContent = '';
    var l = document.createElement('div'); l.className = 'rl'; l.textContent = 'All states';
    rail.appendChild(l);
    S.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ri' + (s.a === room.a ? ' cur' : '');
      var d = document.createElement('span'); d.className = 'd';
      var n = document.createElement('span'); n.className = 'n'; n.textContent = s.n;
      b.appendChild(d); b.appendChild(n);
      b.onclick = function () { openRoom(s); };
      rail.appendChild(b);
    });
  }


  function setTitle() {
    var online = members.filter(function (p) { return p.online; }).length || (me ? 1 : 0);
    $('tNm').textContent = room.n;
    $('tAb').textContent = room.a;
    $('tCt').textContent = members.length
      ? members.length.toLocaleString('en-US') + (members.length === 1 ? ' member · ' : ' members · ') + online + ' online now'
      : 'you are the first one here';
  }

  function openRoom(s) {
    room = s;
    db.setPref('lastRoom', s.a);

    document.querySelector('.room').classList.toggle('solo', !(me && me.host));
    if (me && me.host) drawRail();

    $('ci').placeholder = 'Message ' + s.n + '…';
    setTitle();

    if (me) {
      avatar($('meAv'), me);
      $('meName').textContent = me.name;
      var mail = db.email && db.email();
      $('meMail').textContent = mail || 'Signed in on this device only';
    }

    show('vRoom');

    stopMessages(); stopPresence();
    onlineIds = {};

    loadChat();
    loadMembers();
    loadNotice();

    stopMessages = db.onMessages(s.a, function (msg) {
      appendMessage(msg);
      $('chat').scrollTop = $('chat').scrollHeight;
    });
    if (me) {
      stopPresence = db.onPresence(s.a, me, function (ids) {
        onlineIds = {};
        ids.forEach(function (id) { onlineIds[id] = true; });
        /* Somebody online who wasn't in the list means a new member joined
           after this page loaded. Without this the roster stayed frozen at
           whoever existed when you opened the room. */
        var known = {};
        members.forEach(function (p) { known[p.id] = true; });
        var stranger = ids.some(function (id) { return !known[id]; });
        if (stranger) loadMembers(); else markOnline();
      });
    }
  }

  /* ── chat ────────────────────────────────────────────────────── */
  function messageEl(m) {
    var wrap = document.createElement('div'); wrap.className = 'm' + (m.mine ? ' mine' : '');
    var b = document.createElement('div'); b.className = 'b';
    var h = document.createElement('div'); h.className = 'h';

    /* Your own messages carry only a time. The side of the screen already
       says who wrote them, and your name on every line is just noise. */
    if (!m.mine) {
      var who = document.createElement('span'); who.className = 'who'; who.textContent = m.name;
      h.appendChild(who);
      if (m.city) { var cy = document.createElement('span'); cy.className = 'cy'; cy.textContent = m.city; h.appendChild(cy); }
    }
    var tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = clock(m.ts);
    h.appendChild(tm);

    var tx = document.createElement('div'); tx.className = 'tx'; tx.textContent = m.text;
    b.appendChild(h); b.appendChild(tx);

    if (!m.mine) {
      var av = document.createElement('span'); av.className = 'av sm';
      avatar(av, m);
      wrap.appendChild(av);
    }
    wrap.appendChild(b);
    return wrap;
  }

  function appendMessage(m) {
    var chat = $('chat');
    var empty = chat.querySelector('.sys.empty');
    if (empty) empty.remove();
    chat.appendChild(messageEl(m));
  }

  function loadChat() {
    var chat = $('chat');
    chat.textContent = '';
    db.messages(room.a).then(function (msgs) {
      chat.textContent = '';
      if (!msgs.length) {
        var e = document.createElement('div');
        e.className = 'sys empty';
        e.textContent = 'Nothing here yet. Say hello to ' + room.n + '.';
        chat.appendChild(e);
        return;
      }
      msgs.forEach(function (m) { chat.appendChild(messageEl(m)); });
      chat.scrollTop = chat.scrollHeight;
    }).catch(function (err) {
      chat.textContent = '';
      var e = document.createElement('div');
      e.className = 'sys';
      e.textContent = 'Could not load the conversation — ' + ((err && err.message) || 'try refreshing');
      chat.appendChild(e);
    });
  }

  $('cmp').onsubmit = function (e) {
    e.preventDefault();
    var i = $('ci'), text = i.value.trim();
    if (!text || !me) return;
    i.value = '';
    var msg = {
      name: me.name, city: me.city, photo: me.photo,
      bg: me.bg, fg: me.fg, text: text, ts: Date.now(), mine: true
    };
    appendMessage(msg);                          // show it immediately
    $('chat').scrollTop = $('chat').scrollHeight;
    db.send(room.a, msg).catch(function (err) {
      var e2 = document.createElement('div');
      e2.className = 'sys';
      e2.textContent = 'That message did not send — ' + ((err && err.message) || 'check your connection');
      $('chat').appendChild(e2);
    });
  };

  /* ── who's here ──────────────────────────────────────────────── */
  var OFFLINE_SHOWN = 40;

  function personRow(p) {
    var row = document.createElement('div');
    row.className = 'wp' + (p.online ? '' : ' off');
    if (p.id) row.dataset.id = p.id;
    var av = document.createElement('span'); av.className = 'av xs';
    avatar(av, p);
    var t = document.createElement('span'); t.className = 't';
    var n = document.createElement('span'); n.className = 'n';
    n.textContent = p.name + (p.you ? ' (you)' : '');
    t.appendChild(n);
    if (p.city) { var c = document.createElement('span'); c.className = 'c'; c.textContent = p.city; t.appendChild(c); }
    row.appendChild(av); row.appendChild(t);
    var d = document.createElement('span'); d.className = 'mk'; d.textContent = '●';
    if (!p.online) d.style.visibility = 'hidden';
    row.appendChild(d);
    return row;
  }

  function label(text) {
    var l = document.createElement('div'); l.className = 'wl'; l.textContent = text;
    return l;
  }

  function drawWho() {
    var w = $('whoList');
    w.textContent = '';
    var online = members.filter(function (p) { return p.online; });
    var offline = members.filter(function (p) { return !p.online; });

    w.appendChild(label('Online · ' + online.length));
    online.forEach(function (p) { w.appendChild(personRow(p)); });

    if (offline.length) {
      w.appendChild(label('Also in ' + room.n + ' · ' + offline.length));
      offline.slice(0, OFFLINE_SHOWN).forEach(function (p) { w.appendChild(personRow(p)); });
      if (offline.length > OFFLINE_SHOWN) {
        var more = document.createElement('p');
        more.className = 'hint'; more.style.padding = '9px 6px 0';
        more.textContent = '+ ' + (offline.length - OFFLINE_SHOWN).toLocaleString('en-US') + ' more';
        w.appendChild(more);
      }
    }

    if (!db.shared) {
      var note = document.createElement('p');
      note.className = 'hint';
      note.style.cssText = 'padding:12px 6px 0;border-top:1px solid var(--line);margin-top:10px';
      note.textContent = 'Other members appear once the database is connected.';
      w.appendChild(note);
    }
  }

  function markOnline() {
    members.forEach(function (p) {
      p.online = p.you || !!onlineIds[p.id];
    });
    drawWho();
    setTitle();
  }

  function loadMembers() {
    db.members(room.a, me).then(function (list) {
      members = list;
      markOnline();
    }).catch(function () { members = []; drawWho(); });
  }

  /* ── announcements ───────────────────────────────────────────── */
  function loadNotice() {
    var box = $('notice');
    db.notice(room.a).then(function (n) {
      if (!n || db.dismissed(n.id)) { box.hidden = true; return; }
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
      $('nBody').textContent = n.body || '';
      $('nX').onclick = function () { db.dismiss(n.id); box.hidden = true; };
    }).catch(function () { box.hidden = true; });
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

  var picking = false, chosenRooms = {}, lastCount = S.length;
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
    c.textContent = s.a; c.title = s.n;
    c.onclick = function () {
      var on = c.getAttribute('aria-pressed') === 'true';
      c.setAttribute('aria-pressed', String(!on));
      if (on) delete chosenRooms[s.a]; else chosenRooms[s.a] = true;
      tally();
    };
    $('chips').appendChild(c);
  });

  function tally() {
    var rooms = picking ? Object.keys(chosenRooms).length : S.length;
    lastCount = rooms;
    var n = $('postN');
    if (n) n.textContent = rooms;
    $('reachN').textContent = rooms ? (rooms === S.length ? 'Everyone' : rooms + ' of 51') : '—';
    $('postBtn').disabled = rooms === 0;
  }

  $('aTitle').oninput = function () { $('pvT').textContent = this.value || 'Your headline'; };
  $('aBody').oninput = function () { $('pvB').textContent = this.value || 'Your note.'; };

  $('postBtn').onclick = function () {
    var title = $('aTitle').value.trim();
    if (!title) { $('aTitle').focus(); return; }
    var days = Number(document.querySelector('#expiry .opt[aria-pressed="true"]').dataset.days);
    var b = this, count = lastCount;
    b.disabled = true;
    db.setNotice({
      id: String(Date.now()),
      by: (me && me.name) || 'a host',
      title: title,
      body: $('aBody').value.trim(),
      all: !picking,
      rooms: Object.keys(chosenRooms),
      until: days ? Date.now() + days * 86400000 : 0
    }).then(function () {
      b.textContent = '✓ Pinned to ' + count + ' rooms';
      setTimeout(function () {
        b.disabled = false;
        b.textContent = '';
        b.appendChild(document.createTextNode('Pin to '));
        var sp = document.createElement('span'); sp.id = 'postN'; sp.textContent = count;
        b.appendChild(sp);
        b.appendChild(document.createTextNode(' rooms'));
      }, 2000);
    }).catch(function (err) {
      b.disabled = false;
      alert('Could not pin that: ' + ((err && err.message) || 'unknown error'));
    });
  };
  $('clearBtn').onclick = function () {
    db.clearNotice().then(function () { alert('Notice taken down.'); });
  };
  $('annBack').onclick = function () { loadNotice(); show('vRoom'); };

  /* ── emoji ───────────────────────────────────────────────────── */
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
  emjBtn.onclick = function () {
    tray.hidden = !tray.hidden;
    emjBtn.setAttribute('aria-expanded', String(!tray.hidden));
  };

  /* ── the ⋯ menu ──────────────────────────────────────────────── */
  var meMenu = $('meMenu'), meBtn2 = $('meBtn2');
  function toggleMenu(open) {
    meMenu.hidden = !open;
    meBtn2.setAttribute('aria-expanded', String(open));
  }
  meBtn2.onclick = function (e) { e.stopPropagation(); toggleMenu(meMenu.hidden); };
  document.addEventListener('click', function () { toggleMenu(false); });
  meMenu.onclick = function (e) { e.stopPropagation(); };
  $('mSettings').onclick = function () { toggleMenu(false); openSettings(); };
  $('mOut').onclick = function () {
    toggleMenu(false);
    if (!confirm('Sign out and set up again on this device?')) return;
    db.signOut().then(function () { me = null; location.reload(); });
  };

  /* ── appearance ──────────────────────────────────────────────
     Three states, not two: dark, light, or whatever the device says. */
  var systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme(choice) {
    var wanted = choice === 'system'
      ? (systemDark && systemDark.matches ? 'dark' : 'light')
      : choice;
    if (wanted === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener('change', function () {
      if (db.pref('theme', 'dark') === 'system') applyTheme('system');
    });
  }

  /* ── settings ────────────────────────────────────────────────── */
  var sSel = $('sStt');
  S.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.a; o.textContent = s.n;
    sSel.appendChild(o);
  });

  var sSwatches = [].slice.call(document.querySelectorAll('#sPick .pk'));
  var sColor = null, sPhoto = null, sNameFree = true, sNameTimer = null;

  function sPaint() {
    var ini = initials($('sNm').value);
    sSwatches.forEach(function (sw) {
      if (sPhoto && sw.getAttribute('aria-pressed') === 'true') return;
      sw.textContent = ini;
      sw.style.background = sw.dataset.bg;
      sw.style.color = sw.dataset.fg;
    });
  }
  sSwatches.forEach(function (sw) {
    sw.onclick = function () {
      sPhoto = null;
      sSwatches.forEach(function (x) { x.setAttribute('aria-pressed', String(x === sw)); });
      sColor = { bg: sw.dataset.bg, fg: sw.dataset.fg };
      sPaint();
    };
    sw.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sw.onclick(); }
    };
  });

  $('sUpBtn').onclick = function () { $('sUpFile').click(); };
  $('sUpFile').onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { alert('That image is over 1.5 MB — please pick a smaller one.'); return; }
    var r = new FileReader();
    r.onload = function () {
      sPhoto = r.result;
      var first = sSwatches[0];
      sSwatches.forEach(function (x) { x.setAttribute('aria-pressed', String(x === first)); });
      first.textContent = '';
      first.style.background = 'transparent';
      var img = new Image(); img.src = sPhoto; img.alt = '';
      first.appendChild(img);
    };
    r.readAsDataURL(file);
  };

  /* Only complain about the name if they actually changed it. */
  function sCheckName() {
    var v = $('sNm').value.trim(), chk = $('sNmChk');
    sNameFree = true;
    if (!v) { chk.className = 'chk no'; chk.textContent = '✕ You need a name'; sNameFree = false; return; }
    if (!db.shared || (me && v === me.name && sSel.value === me.state)) {
      chk.className = 'chk wait'; chk.textContent = ''; return;
    }
    chk.className = 'chk wait'; chk.textContent = 'checking…';
    db.nameTaken(sSel.value, v).then(function (taken) {
      if ($('sNm').value.trim() !== v) return;
      sNameFree = !taken;
      chk.className = taken ? 'chk no' : 'chk ok';
      chk.textContent = taken
        ? '✕ Taken in ' + byAbbr(sSel.value).n + ' — try ' + suggest(v)
        : '✓ Free in ' + byAbbr(sSel.value).n;
    }).catch(function () { chk.className = 'chk wait'; chk.textContent = ''; });
  }
  $('sNm').oninput = function () {
    sPaint();
    clearTimeout(sNameTimer);
    sNameTimer = setTimeout(sCheckName, 450);
  };
  sSel.onchange = sCheckName;

  radio($('theme'), function (o) { applyTheme(o.dataset.theme); });

  function openSettings() {
    if (!me) return;
    $('sNm').value = me.name;
    $('sCty').value = me.city || '';
    sSel.value = me.state;
    sPhoto = me.photo || null;
    sColor = { bg: me.bg, fg: me.fg };

    var match = null;
    sSwatches.forEach(function (sw) {
      sw.setAttribute('aria-pressed', 'false');
      if (sw.dataset.bg === me.bg) match = sw;
    });
    (match || sSwatches[0]).setAttribute('aria-pressed', 'true');
    sPaint();
    if (sPhoto) {
      var first = match || sSwatches[0];
      first.textContent = '';
      first.style.background = 'transparent';
      var img = new Image(); img.src = sPhoto; img.alt = '';
      first.appendChild(img);
    }

    var pick = db.pref('theme', 'dark');
    [].slice.call(document.querySelectorAll('#theme .opt')).forEach(function (o) {
      o.setAttribute('aria-pressed', String(o.dataset.theme === pick));
    });

    $('sNmChk').textContent = '';
    $('setMsg').textContent = '';
    $('settings').hidden = false;
  }

  function closeSettings() {
    $('settings').hidden = true;
    applyTheme(db.pref('theme', 'dark'));      // discard an unsaved preview
  }
  $('setX').onclick = closeSettings;
  $('setCancel').onclick = closeSettings;
  $('settings').onclick = function (e) { if (e.target === $('settings')) closeSettings(); };

  $('setSave').onclick = function () {
    var name = $('sNm').value.trim();
    if (!name || !sNameFree) { $('sNm').focus(); sCheckName(); return; }
    var btn = this;
    btn.disabled = true;
    $('setMsg').className = 'chk wait';
    $('setMsg').textContent = 'Saving…';

    var moved = sSel.value !== me.state;
    me.name = name;
    me.city = $('sCty').value.trim();
    me.state = sSel.value;
    me.photo = sPhoto;
    if (sColor) { me.bg = sColor.bg; me.fg = sColor.fg; }

    var chosenTheme = (document.querySelector('#theme .opt[aria-pressed="true"]') || {}).dataset;
    db.setPref('theme', (chosenTheme && chosenTheme.theme) || 'dark');

    db.saveProfile(me).then(function (saved) {
      me = saved;
      btn.disabled = false;
      $('settings').hidden = true;
      openRoom(byAbbr(moved ? me.state : room.a));
    }).catch(function (err) {
      btn.disabled = false;
      $('setMsg').className = 'chk no';
      $('setMsg').textContent = '✕ ' + ((err && err.message) || 'Could not save');
    });
  };

  /* ── the microphone ──────────────────────────────────────────
     Measured on the live community: Mighty Networks withholds microphone
     permission from the frame, so asking there can only fail. When that's
     the case we open the room in its own tab instead of hitting a wall. */
  var micStream = null, micBtn = $('micBtn');

  function micPermitted() {
    try {
      if (document.featurePolicy && document.featurePolicy.allowsFeature) {
        return document.featurePolicy.allowsFeature('microphone');
      }
    } catch (e) {}
    return null;
  }

  function popOut() {
    /* No 'noopener': it forces window.open to return null, which would make
       every successful pop-out look like a blocked one. */
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

  function renderMics() {
    var mics = $('mics');
    mics.textContent = '';
    if (!micStream || !me) { $('vNames').textContent = 'Nobody yet — be the first'; return; }
    var w = document.createElement('span'); w.className = 'w'; w.id = 'myMic';
    var ring = document.createElement('span'); ring.className = 'ring';
    var av = document.createElement('span'); av.className = 'av sm'; avatar(av, me);
    w.appendChild(ring); w.appendChild(av);
    mics.appendChild(w);
    $('vNames').textContent = '';
    var b = document.createElement('b'); b.textContent = me.name;
    $('vNames').appendChild(b);
    $('vNames').appendChild(document.createTextNode(' — your mic is live'));
  }

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
  if (framed && micPermitted() === false) micBtn.textContent = '🎙 Open a tab to talk';

  /* ── host view ───────────────────────────────────────────────── */
  function checkHash() {
    if (location.hash !== '#announce') return;
    $('pvWho').textContent = (me && me.name) || 'you';
    var d = new Date(Date.now() + 14 * 86400000);
    $('exp14').textContent = 'Clears itself on ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    tally();
    show('vAnn');
  }
  window.addEventListener('hashchange', checkHash);

  /* ── boot ────────────────────────────────────────────────────── */
  var wantVoice = (location.search.match(/[?&]voice=([A-Z]{2})/) || [])[1];

  var isPopup = /[?&]authpopup=1/.test(location.search);

  window.DB_READY.then(function (store) {
    db = store;
    applyTheme(db.pref('theme', 'dark'));
    updateBanner();
    return db.init().then(function (profile) { return profile; });
  }).then(function (profile) {

    /* This window exists only to complete Google and hand the session back. */
    if (isPopup) {
      document.body.style.background = 'var(--nav)';
      if (db.hasSession()) {
        return db.tokens().then(function (t) {
          if (window.opener) {
            window.opener.postMessage({ type: 'stateRooms.session', tokens: t }, location.origin);
          }
          window.close();
        });
      }
      return db.signInWithGoogle(location.origin + location.pathname + '?authpopup=1');
    }

    me = profile;

    if (me) {
      $('nm').value = me.name;
      $('cty').value = me.city || '';
      sel.value = me.state;
      cityHint();
      openRoom(byAbbr(wantVoice || me.state));
      if (wantVoice && !framed) {
        $('vNames').textContent = 'Opening your microphone…';
        startMic().catch(function () {
          micBtn.className = 'jn';
          micBtn.textContent = '🎙 Join the mic';
          $('vNames').textContent = 'Press the button when you are ready to talk';
        });
      }
    } else if (db.hasSession()) {
      showProfileStep();          // signed in, but we don't know them yet
    } else {
      $('signinBox').hidden = false;
      $('profileBox').hidden = true;
      reportReturn();
      show('vJoin');
    }
    checkHash();
  }).catch(function (err) {
    console.error('Could not start:', err);
    show('vJoin');
  });
})();
