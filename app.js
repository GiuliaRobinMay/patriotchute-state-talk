/* State Rooms.
 *
 * The app talks to window.DB and never cares which kind it got. With the
 * database configured that's a shared store and two people see the same
 * room; without it, everything stays on this device and the banner at the
 * top says so.
 */
(function () {
  'use strict';

  var BUILD = 'build 55';   // bump on every deploy — shown on the sign-in screen and in the name menu

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
  /* One room the whole community shares, alongside the state rooms. */
  var USA = { n: 'All USA', a: 'US' };

  function byAbbr(a) {
    if (a === 'US') return USA;
    for (var i = 0; i < S.length; i++) if (S[i].a === a) return S[i];
    return S[34];
  }
  function colorFor(name) { return COLORS[String(name).length % COLORS.length]; }

  /* Native confirm()/alert() are silently swallowed inside a sandboxed
     embed — exactly where this app lives — so decisions and notices are
     drawn by the app itself. */
  var askEl = null;
  function ask(message) {
    return new Promise(function (resolve) {
      if (!askEl) {
        askEl = document.createElement('div');
        askEl.className = 'sheet';
        askEl.style.zIndex = '90';
        var card = document.createElement('div'); card.className = 'card';
        card.setAttribute('role', 'alertdialog');
        var body = document.createElement('div'); body.className = 'cbody';
        var msg = document.createElement('p'); msg.className = 'askmsg';
        body.appendChild(msg);
        var foot = document.createElement('div'); foot.className = 'cfoot';
        var sp = document.createElement('span'); sp.style.flex = '1';
        var no = document.createElement('button'); no.type = 'button'; no.className = 'btn g'; no.textContent = 'Cancel'; no.dataset.a = 'no';
        var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn'; yes.textContent = 'Yes, do it'; yes.dataset.a = 'yes';
        foot.appendChild(sp); foot.appendChild(no); foot.appendChild(yes);
        card.appendChild(body); card.appendChild(foot);
        askEl.appendChild(card);
        document.body.appendChild(askEl);
      }
      askEl.querySelector('.askmsg').textContent = message;
      askEl.hidden = false;
      function done(v) { askEl.hidden = true; resolve(v); }
      askEl.querySelector('[data-a="no"]').onclick = function () { done(false); };
      askEl.querySelector('[data-a="yes"]').onclick = function () { done(true); };
      askEl.onclick = function (e) { if (e.target === askEl) done(false); };
    });
  }

  var toastEl = null, toastTimer = null;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
  }

  function adminStar() {
    var st = document.createElement('span');
    st.className = 'astar';
    st.textContent = '★';
    st.title = 'Admin';
    return st;
  }

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
  var stopVoiceWatch = function () {};
  var stopReacts = function () {};
  var lastSeenTouch = 0;
  var stopPeek = function () {};
  var unread = {};              // room -> messages since you last had it open
  var otherMics = 0;            // people on the mic in the room you are not in
  var unreadTab = 0;            // chat messages while the Live Room tab is open

  function otherAb() { return me ? (room.a === 'US' ? me.state : 'US') : null; }

  /* One place decides every badge: the 🎙 on each room pill, the unread
     count on the room you are not in, and the count on the Chat tab. */
  function updateSignals() {
    var curMics = lastVoiceList.filter(function (p) { return p.role !== 'listen'; }).length;
    var stateAb = me ? me.state : null;
    var inUsa = room.a === 'US';
    var stateMics = inUsa ? otherMics : curMics;
    var usaMics = inUsa ? curMics : otherMics;

    function pill(micId, nId, mics, count) {
      $(micId).hidden = !mics;
      $(nId).hidden = !count;
      if (count) $(nId).textContent = count > 9 ? '9+' : count;
    }
    pill('rsStateMic', 'rsStateN', stateMics, inUsa && stateAb ? (unread[stateAb] || 0) : 0);
    pill('rsUsaMic', 'rsUsaN', usaMics, !inUsa ? (unread.US || 0) : 0);

    if (me && me.host && railHasMics !== (curMics > 0)) {
      railHasMics = curMics > 0;
      drawRail();
    }
    $('talkLive').hidden = !curMics;
    $('chatN').hidden = !unreadTab;
    if (unreadTab) $('chatN').textContent = unreadTab > 9 ? '9+' : unreadTab;
  }

  var hotVoice = {}, hotPeople = {}, unseenChat = {};
  var stopPulseMsg = null, stopPulseVoice = null, stopPulsePeople = null;
  var railHasMics = false;

  function startHostPulse() {
    if (!me || !me.host || !db.shared) return;
    if (!stopPulseMsg) {
      stopPulseMsg = db.onAnyMessage(function (ab, author) {
        if (ab === room.a) return;
        if (me && author === me.id) return;
        if (!unseenChat[ab]) { unseenChat[ab] = true; drawRail(); }
      });
    }
    if (stopPulseVoice) stopPulseVoice();
    if (stopPulsePeople) stopPulsePeople();
    var abs = S.map(function (x) { return x.a; }).concat(['US'])
      .filter(function (ab) { return ab !== room.a; });
    stopPulseVoice = db.peekVoiceMany(abs, function (ab, mics) {
      var had = !!hotVoice[ab];
      hotVoice[ab] = mics;
      if (had !== (mics > 0)) drawRail();
    });
    /* People are watched in every room — the one you're standing in too,
       so its dot goes green when somebody else is in there with you. */
    var absAll = S.map(function (x) { return x.a; }).concat(['US']);
    stopPulsePeople = db.peekPeopleMany(absAll, me.id, function (ab, n) {
      var had = !!hotPeople[ab];
      hotPeople[ab] = n;
      if (had !== (n > 0)) drawRail();
    });
  }

  /* The banner that says something is happening in All USA right now —
     shown in every room except All USA itself. */
  var stopUsWatch = null, usLive = 0, usInfo = null;
  function drawLiveBanner() {
    var b = $('liveBanner');
    var show = usLive > 0 && room.a !== 'US';
    b.hidden = !show;
    if (!show) return;
    b.textContent = '';
    var mic = document.createElement('b'); mic.textContent = '🎙 LIVE in All USA';
    b.appendChild(mic);
    var rest = ' — ';
    if (usInfo && usInfo.topic) rest += '“' + usInfo.topic + '”';
    if (usInfo && usInfo.name) rest += (usInfo.topic ? ' with ' : '') + usInfo.name;
    if (rest === ' — ') rest = ' — a State Talk is on';
    var sp = document.createElement('span'); sp.textContent = rest + ' · tap to listen';
    b.appendChild(sp);
  }
  function startUsWatch() {
    if (stopUsWatch) stopUsWatch();
    stopUsWatch = null;
    usLive = 0; usInfo = null;
    drawLiveBanner();
    if (!db.shared || !me || room.a === 'US') return;
    stopUsWatch = db.peekVoiceMany(['US'], function (ab, mics, info) {
      usLive = mics;
      usInfo = info || null;
      drawLiveBanner();
    });
  }
  $('liveBanner').onclick = function () {
    openRoom(USA);
    showTalk(true);
  };

  /* Every member's app announces which room it has open, so admins can
     see life on the rail. Ends by itself when the app closes. */
  var hereIv = null, hereRoom = null;
  function startHereBeat() {
    if (!db.shared || !me) return;
    if (hereRoom && hereRoom !== room.a) {
      try { db.herePulse(hereRoom, me.id, true); } catch (e) {}
    }
    hereRoom = room.a;
    if (hereIv) clearInterval(hereIv);
    var beat = function () { try { db.herePulse(room.a, me.id); } catch (e) {} };
    beat();
    hereIv = setInterval(beat, 20000);
  }

  function startPeek() {
    stopPeek();
    stopPeek = function () {};
    var oa = otherAb();
    otherMics = 0;
    if (!oa || !db.shared || !me) { updateSignals(); return; }
    stopPeek = db.peekRoom(oa, {
      onMsg: function () { unread[oa] = (unread[oa] || 0) + 1; updateSignals(); },
      onVoice: function (mics) { otherMics = mics; updateSignals(); }
    });
  }

  function show(v) {
    $('boot').hidden = true;
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
    if (file.size > 1.5 * 1024 * 1024) { toast('That image is over 1.5 MB — please pick a smaller one.'); return; }
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
     embed the button opens the app in its own tab and the whole sign-in
     happens there, in plain sight — the ordinary full-page flow, the one
     path that has always worked. The tab then sends the finished session
     back over a Realtime channel named by a secret the two windows agreed
     on beforehand (nothing else survives between them: Google severs the
     window-to-window link and the browser separates their storage).
     Outside a frame the button is a plain redirect. */
  var authchk = $('authchk');
  var stopHandoff = null, adopted = false;

  function saySigningIn(msg, kind) {
    authchk.className = 'chk ' + (kind || 'wait');
    authchk.textContent = msg;
  }

  /* "Nothing happens" is the worst possible error message. Anything that
     breaks shows itself on the sign-in screen instead — and if the app is
     stuck on the boot screen, the error un-sticks it first. */
  function surfaceError(msg) {
    try {
      if (!$('boot').hidden) {
        $('boot').hidden = true;
        $('signinBox').hidden = false;
        $('buildTag').textContent = BUILD;
        show('vJoin');
      }
      if (!$('signinBox').hidden) saySigningIn('✕ App error: ' + msg, 'no');
    } catch (x) {}
  }
  window.addEventListener('error', function (e) {
    surfaceError(e.message || 'unknown');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    surfaceError((r && r.message) || String(r || 'unknown'));
  });

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

  /* The session arriving from the sign-in tab. Adopt it exactly once. */
  function receiveSession(d) {
    if (adopted) return;
    if (!d.tokens) { saySigningIn('✕ ' + (d.reason || 'Sign-in was cancelled'), 'no'); return; }
    adopted = true;
    if (stopHandoff) { stopHandoff(); stopHandoff = null; }
    saySigningIn('Signed in — one moment…', 'ok');
    db.adoptTokens(d.tokens).then(afterSignIn).catch(function (err) {
      adopted = false;
      saySigningIn('✕ ' + ((err && err.message) || 'Could not finish sign-in') +
        ' — press the Google button to try again', 'no');
    });
  }

  $('googleBtn').onclick = function () {
    if (!framed) {
      saySigningIn('Opening Google…');
      db.signInWithGoogle(location.origin + location.pathname).catch(function (err) {
        saySigningIn('✕ ' + ((err && err.message) || 'Could not start sign-in'), 'no');
      });
      return;
    }
    if (!db.shared) {
      saySigningIn('✕ Could not reach the database from here — reload and try again', 'no');
      return;
    }
    var pair = 'k' + Math.random().toString(36).slice(2) +
                     Math.random().toString(36).slice(2);
    adopted = false;
    if (stopHandoff) stopHandoff();
    stopHandoff = db.onHandoff(pair, receiveSession);
    /* A small window floating over the community — the community itself
       stays right where it is, visible behind it. */
    var w = window.open(location.origin + location.pathname + '?link=' + encodeURIComponent(pair),
      'stateRoomsSignIn', 'width=480,height=720');
    if (!w) {
      saySigningIn('✕ Your browser blocked the sign-in window — allow pop-ups for this site', 'no');
      return;
    }
    saySigningIn('Choose your Google account in the small window — this page follows by itself.');
  };

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
    function railItem(label, ab, target) {
      var b = document.createElement('button');
      b.type = 'button';
      var cur = ab === room.a;
      var mics = cur
        ? lastVoiceList.filter(function (p) { return p.role !== 'listen'; }).length
        : (hotVoice[ab] || 0);
      b.className = 'ri' + (cur ? ' cur' : '') + (!cur && unseenChat[ab] ? ' unseen' : '');
      var ppl = hotPeople[ab] || 0;
      var d = document.createElement('span');
      d.className = 'd' + (mics ? ' hot' : ppl ? ' ppl' : '');
      if (ppl) d.title = ppl === 1 ? '1 person in there now' : ppl + ' people in there now';
      var n = document.createElement('span'); n.className = 'n'; n.textContent = label;
      b.appendChild(d); b.appendChild(n);
      if (mics) {
        var mi = document.createElement('span'); mi.className = 'rmic'; mi.textContent = '🎙';
        b.appendChild(mi);
      }
      b.onclick = function () { openRoom(target); };
      return b;
    }
    rail.appendChild(railItem('🇺🇸 All USA', 'US', USA));
    var l = document.createElement('div'); l.className = 'rl'; l.textContent = 'All states';
    rail.appendChild(l);
    S.forEach(function (s) { rail.appendChild(railItem(s.n, s.a, s)); });
  }


  function setTitle() {
    var online = members.filter(function (p) { return p.online; }).length || (me ? 1 : 0);
    $('tNm').textContent = room.n;
    $('tAb').textContent = room.a;
    if (room.a === 'US') {
      $('tCt').textContent = 'the whole community · ' + online + ' here now';
      return;
    }
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
      $('meMail').textContent = (mail || 'Signed in on this device only') + ' · ' + BUILD;
    }

    if (me) {
      $('mAdmin').hidden = !me.host;
      $('rsStateTxt').textContent = byAbbr(me.state).n;
      $('rsState').setAttribute('aria-selected', String(s.a !== 'US'));
      $('rsUsa').setAttribute('aria-selected', String(s.a === 'US'));
    }

    show('vRoom');

    if (inCall) leaveVoice();
    stopPeek(); stopPeek = function () {};
    stopMessages(); stopPresence(); stopVoiceWatch(); stopReacts();
    onlineIds = {};
    clearReply();
    if (me && Date.now() - lastSeenTouch > 180000) {
      lastSeenTouch = Date.now();
      db.touchSeen();
    }

    unread[s.a] = 0;
    unreadTab = 0;
    unseenChat[s.a] = false;

    showTalk(false);
    if (db.shared && window.Voice) stopVoiceWatch = window.Voice.watch(s.a, renderVoice);
    else renderVoice([]);
    startPeek();
    startHostPulse();
    startHereBeat();
    startUsWatch();

    loadChat();
    loadMembers();
    loadNotice();

    stopMessages = db.onMessages(s.a, function (msg) {
      appendMessage(msg);
      $('chat').scrollTop = $('chat').scrollHeight;
      if (talkOpen) { unreadTab++; updateSignals(); }
    }, function (goneId) {
      var el = $('chat').querySelector('[data-id="' + goneId + '"]');
      if (el) el.remove();
      delete msgIndex[goneId];
    });

    /* Other people's hearts land live; your own were drawn on the click. */
    stopReacts = db.onReactions(s.a, function (mid, emoji, member, on) {
      var m = msgIndex[mid];
      if (!m || member === db.myId()) return;
      applyReact(m, emoji, on, false);
    });
    if (me) {
      stopPresence = db.onPresence(s.a, me, function (people) {
        onlineIds = {};
        people.forEach(function (p) { onlineIds[p.id] = true; });
        /* The national room has no state to look members up by, so whoever
           presence says is here IS the roster. */
        if (room.a === 'US') {
          members = people.map(function (p) {
            var you = me && p.id === me.id;
            return { id: p.id, name: p.name || 'Someone', city: p.city,
                     bg: p.bg, fg: p.fg, admin: p.admin,
                     photo: you ? me.photo : (photoByUid[p.id] || null),
                     online: true, you: you };
          });
          markOnline();
          fillPhotosFor(people.map(function (p) { return p.id; }), function () {
            members.forEach(function (mm) {
              if (!mm.photo) mm.photo = photoByUid[mm.id] || null;
            });
            markOnline();
          });
          return;
        }
        /* Somebody online who wasn't in the list means a new member joined
           after this page loaded. Without this the roster stayed frozen at
           whoever existed when you opened the room. */
        var known = {};
        members.forEach(function (p) { known[p.id] = true; });
        var stranger = people.some(function (p) { return !known[p.id]; });
        if (stranger) loadMembers(); else markOnline();
      });
    }
  }

  /* ── chat ────────────────────────────────────────────────────── */
  /* Message text stays plain text — nobody can inject anything into the
     room — but pieces that look like web addresses become real links.
     Only http(s) and www. shapes qualify, and they open in a new tab. */
  function linkify(el, text) {
    var re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[^\s<>"']{2,})/g;
    var last = 0, m2, first = '';
    while ((m2 = re.exec(text)) !== null) {
      if (m2.index > last) el.appendChild(document.createTextNode(text.slice(last, m2.index)));
      var raw = m2[0];
      /* A sentence's closing punctuation is not part of the address. */
      var trimmed = raw.replace(/[.,;:!?)\]]+$/, '');
      var a = document.createElement('a');
      a.href = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
      a.textContent = trimmed;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      el.appendChild(a);
      if (!first) first = a.href;
      if (trimmed.length < raw.length) {
        el.appendChild(document.createTextNode(raw.slice(trimmed.length)));
      }
      last = m2.index + raw.length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
    return first;
  }

  /* A card under the message, the way the big platforms do it: the page's
     own title and image, fetched once for everyone via /api/preview. Some
     sites (Instagram, X) keep their previews behind a login — then there
     is simply no card, and the link stays a link. */
  var previewCache = {};

  function stickToBottom() {
    var c = $('chat');
    if (c.scrollHeight - c.scrollTop - c.clientHeight < 130) c.scrollTop = c.scrollHeight;
  }

  function attachPreview(bubble, url) {
    if (!db.shared) return;
    function card(d) {
      if (!d || (!d.title && !d.image)) return;
      var a = document.createElement('a');
      a.className = 'lcard';
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      if (d.image) {
        var im = new Image();
        /* Some image hosts refuse pictures when they can see which site is
           asking. Don't tell them — that's what the platforms do too. */
        im.referrerPolicy = 'no-referrer';
        im.src = d.image; im.alt = ''; im.loading = 'lazy';
        im.onerror = function () { im.remove(); };
        im.onload = stickToBottom;
        a.appendChild(im);
      }
      var host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
      var t = document.createElement('span'); t.className = 'lt';
      t.textContent = d.title || d.site || host;
      a.appendChild(t);
      if (d.desc) {
        var ds = document.createElement('span'); ds.className = 'ls';
        ds.textContent = d.desc;
        a.appendChild(ds);
      }
      var dm = document.createElement('span'); dm.className = 'ld';
      dm.textContent = d.site ? d.site + ' · ' + host : host;
      a.appendChild(dm);
      bubble.appendChild(a);
      stickToBottom();
    }
    var hit = previewCache[url];
    if (hit) {
      if (hit.then) hit.then(card); else card(hit);
      return;
    }
    previewCache[url] = fetch('/api/preview?url=' + encodeURIComponent(url))
      .then(function (r) { return r.ok && r.status === 200 ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) { previewCache[url] = d; card(d); return d; });
  }

  /* ── reactions and replies ───────────────────────────────────── */
  var msgIndex = {};            // id -> message, for quotes and live updates
  var replyingTo = null;
  var EMOJIS = ['❤️', '👍', '🙏', '🇺🇸', '😂', '‼️'];
  var palette = null;

  function closePalette() {
    if (palette) { palette.remove(); palette = null; }
  }
  document.addEventListener('click', function (e) {
    if (palette && !palette.contains(e.target)) closePalette();
  }, true);

  function openPalette(btn, m) {
    closePalette();
    palette = document.createElement('div');
    palette.className = 'rpal';
    EMOJIS.forEach(function (em) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = em;
      b.onclick = function () { closePalette(); toggleReact(m, em); };
      palette.appendChild(b);
    });
    document.body.appendChild(palette);
    var r = btn.getBoundingClientRect();
    palette.style.top = Math.max(6, r.top - 44) + 'px';
    palette.style.left = Math.min(window.innerWidth - palette.offsetWidth - 8,
      Math.max(8, r.left - palette.offsetWidth / 2)) + 'px';
  }

  function renderReacts(bEl, m) {
    var old = bEl.querySelector('.rxs');
    if (old) old.remove();
    var keys = Object.keys(m.reacts || {});
    if (!keys.length) return;
    var row = document.createElement('div'); row.className = 'rxs';
    keys.forEach(function (em) {
      var e = m.reacts[em];
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rc' + (e.mine ? ' mine' : '');
      chip.textContent = em + ' ' + e.n;
      chip.onclick = function () { toggleReact(m, em); };
      row.appendChild(chip);
    });
    bEl.appendChild(row);
  }

  function applyReact(m, emoji, on, mineFlag) {
    m.reacts = m.reacts || {};
    var slot = m.reacts[emoji] || (m.reacts[emoji] = { n: 0, mine: false });
    slot.n += on ? 1 : -1;
    if (mineFlag) slot.mine = on;
    if (slot.n <= 0) delete m.reacts[emoji];
    var el = $('chat').querySelector('.m[data-id="' + m.id + '"] .b');
    if (el) renderReacts(el, m);
  }

  function toggleReact(m, emoji) {
    if (!m.id || !db.shared) return;
    var e = m.reacts && m.reacts[emoji];
    var on = !(e && e.mine);
    applyReact(m, emoji, on, true);           // show it instantly
    var p = on ? db.react(m.id, room.a, emoji) : db.unreact(m.id, emoji);
    p.catch(function (err) {
      applyReact(m, emoji, !on, true);
      var why = (err && err.message) || 'unknown reason';
      toast(/reactions/.test(why) && /find|exist|cache/.test(why)
        ? 'Reactions need the database update — paste the SQL block in Supabase first.'
        : '✕ The reaction was refused: ' + why);
    });
  }

  function startReply(m) {
    replyingTo = m;
    $('rbWho').textContent = m.mine ? 'yourself' : m.name;
    $('rbTx').textContent = m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text;
    $('rbar').hidden = false;
    $('ci').focus();
  }
  function clearReply() {
    replyingTo = null;
    $('rbar').hidden = true;
  }
  $('rbX').onclick = clearReply;

  function messageEl(m) {
    var wrap = document.createElement('div'); wrap.className = 'm' + (m.mine ? ' mine' : '');
    if (m.id) wrap.dataset.id = m.id;
    var b = document.createElement('div'); b.className = 'b';
    var h = document.createElement('div'); h.className = 'h';

    /* Your own messages carry only a time. The side of the screen already
       says who wrote them, and your name on every line is just noise. */
    if (!m.mine) {
      var who = document.createElement('span'); who.className = 'who'; who.textContent = m.name;
      h.appendChild(who);
      if (m.admin) h.appendChild(adminStar());
      if (m.city) { var cy = document.createElement('span'); cy.className = 'cy'; cy.textContent = m.city; h.appendChild(cy); }
    }
    var tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = clock(m.ts);
    h.appendChild(tm);

    if (m.id && db.shared) {
      var rx = document.createElement('button');
      rx.type = 'button'; rx.className = 'rep';
      rx.title = 'React to this message';
      rx.textContent = '☺';
      rx.onclick = function (e) { e.stopPropagation(); openPalette(rx, m); };
      h.appendChild(rx);
      var rpl = document.createElement('button');
      rpl.type = 'button'; rpl.className = 'rep';
      rpl.title = 'Reply to this message';
      rpl.textContent = '↩';
      rpl.onclick = function () { startReply(m); };
      h.appendChild(rpl);
    }
    if (!m.mine && m.id && db.shared) {
      var rep = document.createElement('button');
      rep.type = 'button'; rep.className = 'rep';
      rep.title = 'Report this message to the admins';
      rep.textContent = '⚑';
      rep.onclick = function () {
        ask('Report this message to the admins?').then(function (ok) {
          if (!ok) return;
          db.report(m.id).then(function () {
            rep.textContent = '✓'; rep.disabled = true;
            toast('Reported. An admin will take a look.');
          }).catch(function () {});
        });
      };
      h.appendChild(rep);
    }

    var tx = document.createElement('div'); tx.className = 'tx';
    /* An answer carries a little quote of what it answers — click it to
       jump there. */
    if (m.replyTo) {
      var q = msgIndex[m.replyTo];
      var qd = document.createElement('div'); qd.className = 'qt';
      var qn = document.createElement('b');
      qn.textContent = q ? q.name : 'An earlier message';
      var qx = document.createElement('span');
      qx.textContent = q ? (q.text.length > 90 ? q.text.slice(0, 90) + '…' : q.text) : '';
      qd.appendChild(qn); qd.appendChild(qx);
      qd.onclick = function () {
        var t = $('chat').querySelector('.m[data-id="' + m.replyTo + '"]');
        if (!t) return;
        t.scrollIntoView({ behavior: 'smooth', block: 'center' });
        t.classList.add('flash');
        setTimeout(function () { t.classList.remove('flash'); }, 1500);
      };
      tx.appendChild(qd);
    }
    var firstLink = linkify(tx, m.text);
    b.appendChild(h); b.appendChild(tx);
    /* The card lives inside the bubble — one message, one box. */
    if (firstLink) attachPreview(tx, firstLink);
    renderReacts(b, m);

    var av = document.createElement('span'); av.className = 'av sm' + (m.admin ? ' admring' : '');
    avatar(av, m);
    if (m.mine) {
      /* your face on the right, where your messages sit */
      wrap.appendChild(b);
      wrap.appendChild(av);
    } else {
      wrap.appendChild(av);
      wrap.appendChild(b);
    }
    return wrap;
  }

  function appendMessage(m) {
    var chat = $('chat');
    var empty = chat.querySelector('.sys.empty');
    if (empty) empty.remove();
    if (m.id) msgIndex[m.id] = m;
    var el = messageEl(m);
    chat.appendChild(el);
    return el;
  }

  function loadChat() {
    var chat = $('chat');
    chat.textContent = '';
    msgIndex = {};
    db.messages(room.a).then(function (msgs) {
      chat.textContent = '';
      if (!msgs.length) {
        var e = document.createElement('div');
        e.className = 'sys empty';
        e.textContent = 'Nothing here yet. Say hello to ' + room.n + '.';
        chat.appendChild(e);
        return;
      }
      /* Index first, so a reply can quote a message further down the list. */
      msgs.forEach(function (m) { if (m.id) msgIndex[m.id] = m; });
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
      bg: me.bg, fg: me.fg, text: text, ts: Date.now(), mine: true,
      admin: !!me.host,
      replyTo: replyingTo ? replyingTo.id : 0
    };
    var replyId = msg.replyTo;
    clearReply();
    var el = appendMessage(msg);                 // show it immediately
    $('chat').scrollTop = $('chat').scrollHeight;
    db.send(room.a, msg, replyId).then(function (saved) {
      /* Once the database has named it, redraw it whole — with its id it
         can be reacted to and replied to straight away. */
      msg.id = saved.id;
      msgIndex[msg.id] = msg;
      var el2 = messageEl(msg);
      el.replaceWith(el2);
    }).catch(function (err) {
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
    var av = document.createElement('span'); av.className = 'av xs' + (p.admin ? ' admring' : '');
    avatar(av, p);
    var t = document.createElement('span'); t.className = 't';
    var n = document.createElement('span'); n.className = 'n';
    n.textContent = p.name + (p.you ? ' (you)' : '');
    if (p.admin) n.appendChild(adminStar());
    t.appendChild(n);
    if (p.city) { var c = document.createElement('span'); c.className = 'c'; c.textContent = p.city; t.appendChild(c); }
    row.appendChild(av); row.appendChild(t);
    /* No dot here: the 'Online' heading above already says who is online. */
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
    if (room.a === 'US') {
      members = me ? [{ id: me.id, name: me.name, city: me.city, bg: me.bg,
                        fg: me.fg, photo: me.photo, online: true, you: true }] : [];
      markOnline();
      return;
    }
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
      var when = $('nWhen');
      if (n.starts) {
        var wd = new Date(n.starts);
        var live = Date.now() >= n.starts && Date.now() < n.starts + 3 * 3600000;
        when.hidden = false;
        when.classList.toggle('live', live);
        when.textContent = (live ? '● State Talk Time — join the mic' : '🗓 ' +
          wd.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) +
          ' · ' + wd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
          ' — your local time');
      } else {
        when.hidden = true;
      }
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
    var whenVal = $('aWhen').value;
    var starts = whenVal ? new Date(whenVal).getTime() : 0;
    var b = this, count = lastCount;
    b.disabled = true;
    db.setNotice({
      id: String(Date.now()),
      by: (me && me.name) || 'a host',
      title: title,
      body: $('aBody').value.trim(),
      all: !picking,
      rooms: Object.keys(chosenRooms),
      starts: starts,
      repeats: starts ? $('aRepeat').checked : false,
      until: days ? Date.now() + days * 86400000 : 0
    }).then(function () {
      b.textContent = '✓ Pinned to ' + count + ' rooms';
      loadAnnList();
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
      toast('Could not pin that: ' + ((err && err.message) || 'unknown error'));
    });
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
  $('mAdmin').onclick = function () {
    toggleMenu(false);
    if (location.hash === '#admin') checkHash();
    else location.hash = '#admin';
  };
  $('mOut').onclick = function () {
    toggleMenu(false);
    ask('Sign out on this device?').then(function (ok) {
      if (!ok) return;
      /* the reload happens even if something above never settles */
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 1500);
      db.signOut().then(function () { location.reload(); })
        .catch(function () { location.reload(); });
    });
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
    if (file.size > 1.5 * 1024 * 1024) { toast('That image is over 1.5 MB — please pick a smaller one.'); return; }
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

  var inCall = false;
  var talkOpen = false;
  var lastVoiceList = [];

  /* Presence only carries ids and colors — faces are looked up once per
     person and remembered, then the view redraws itself. */
  var photoByUid = {};
  function fillPhotosFor(ids, done) {
    var need = ids.filter(function (id) {
      return id && !(id in photoByUid) && !(me && id === me.id);
    });
    if (!need.length) return;
    need.forEach(function (id) { photoByUid[id] = null; });   // in flight
    db.profilesByIds(need).then(function (map) {
      var got = false;
      need.forEach(function (id) {
        photoByUid[id] = (map[id] && map[id].photo) || null;
        if (photoByUid[id]) got = true;
      });
      if (got && done) done();
    }).catch(function () {});
  }

  function voiceFace(p) {
    return {
      name: p.name, bg: p.bg, fg: p.fg,
      photo: p.you ? (me && me.photo) : (p.uid ? photoByUid[p.uid] : null)
    };
  }

  /* One renderer feeding both places the call appears: the thin strip on
     the chat view, and the Live Room stage. */
  function renderVoice(list) {
    lastVoiceList = list || [];
    fillPhotosFor(lastVoiceList.map(function (p) { return p.uid; }),
      function () { renderVoice(lastVoiceList); });
    var speakers = lastVoiceList.filter(function (p) { return p.role !== 'listen'; });
    var ears = lastVoiceList.filter(function (p) { return p.role === 'listen'; });

    /* the strip (chat view) shows only who is audible */
    var mics = $('mics');
    mics.textContent = '';
    var names = [];
    speakers.forEach(function (p) {
      var w = document.createElement('span');
      w.className = 'w' + (p.talking ? ' talk' : '') + (p.muted ? ' muted' : '');
      w.dataset.vid = p.id;
      var ring = document.createElement('span'); ring.className = 'ring';
      var av = document.createElement('span'); av.className = 'av sm' + (p.admin ? ' admring' : '');
      avatar(av, voiceFace(p));
      w.appendChild(ring); w.appendChild(av);
      mics.appendChild(w);
      names.push(p.you ? 'you' : String(p.name).split(/\s+/)[0]);
    });
    var v = $('vNames');
    var stripTopic = '';
    speakers.forEach(function (p) { if (p.claim && p.topic && !stripTopic) stripTopic = p.topic; });
    if (!speakers.length) v.textContent = 'The Live Room is quiet — be the first on the mic';
    else if (speakers.length === 1) {
      v.textContent = speakers[0].you
        ? 'Your mic is live — talk while others join'
        : names[0] + ' is on the mic';
    } else {
      v.textContent = names.join(', ') + ' are on the mic';
    }
    if (stripTopic && speakers.length) v.textContent = '“' + stripTopic + '” · ' + v.textContent;
    $('muteBtn').hidden = !inCall;

    /* the stage (Live Room view) */
    var stage = $('stageMics');
    stage.textContent = '';
    $('stageN').textContent = speakers.length;
    if (!speakers.length) {
      var n0 = document.createElement('p');
      n0.className = 'none';
      n0.textContent = 'Nobody on the mic yet.';
      stage.appendChild(n0);
    }
    speakers.forEach(function (p) {
      var d = document.createElement('div');
      d.className = 'spk2' + (p.talking ? ' talk' : '') + (p.muted ? ' muted' : '');
      d.dataset.vid = p.id;
      var avw = document.createElement('span'); avw.className = 'avw';
      if (p.hand) { var hs = document.createElement('span'); hs.className = 'handup'; hs.textContent = '✋'; avw.appendChild(hs); }
      var ring = document.createElement('span'); ring.className = 'ring';
      var av = document.createElement('span'); av.className = 'av' + (p.admin ? ' admring' : '');
      avatar(av, voiceFace(p));
      avw.appendChild(ring); avw.appendChild(av);
      var nm = document.createElement('span'); nm.className = 'nm';
      if (p.you) { var bb = document.createElement('b'); bb.textContent = 'You'; nm.appendChild(bb); }
      else nm.textContent = p.name;
      if (p.admin) nm.appendChild(adminStar());
      if (p.muted) {
        var mk = document.createElement('span');
        mk.className = 'mutemark'; mk.textContent = ' 🔇'; mk.title = 'Muted — still listening';
        nm.appendChild(mk);
      }
      d.appendChild(avw); d.appendChild(nm);
      if (p.moderator) {
        var mo = document.createElement('span');
        mo.className = 'modchip'; mo.textContent = 'MODERATOR';
        d.appendChild(mo);
      }
      /* the moderator can tap another speaker to hand them the room */
      var meMod = lastVoiceList.some(function (x) { return x.you && x.moderator; });
      if (meMod && !p.you && window.Voice && window.Voice.hasClaim && window.Voice.hasClaim()) {
        d.classList.add('passable');
        d.title = 'Make ' + p.name + ' the moderator';
        d.onclick = function () {
          ask('Hand the room to ' + p.name + '? They become the moderator.').then(function (ok) {
            if (ok) window.Voice.passModerator(p.id);
          });
        };
      }
      stage.appendChild(d);
    });

    var hb = $('handBtn');
    if (hb && window.Voice) {
      var up = window.Voice.handUp && window.Voice.handUp();
      hb.textContent = up ? '✋ Lower hand' : '✋ Raise hand';
      hb.classList.toggle('up', !!up);
    }

    /* The talk's name, above the stage: whatever the room's claim holder
       called it. The claim holder gets the input to (re)name it. */
    var holder = null;
    lastVoiceList.forEach(function (p) { if (p.claim && p.role !== 'listen') holder = holder || p; });
    var tt = $('talkTopic');
    if (tt) {
      var mod2 = null;
      lastVoiceList.forEach(function (p) { if (p.moderator) mod2 = p; });
      var topicTxt = holder && holder.topic ? holder.topic : '';
      tt.hidden = !topicTxt;
      if (topicTxt) {
        tt.textContent = '“' + topicTxt + '”' +
          (mod2 ? ' — with ' + (mod2.you ? 'you' : mod2.name) : '');
      }
    }
    var tr = $('topicRow');
    if (tr && window.Voice) {
      var canName = !!(window.Voice.hasClaim && window.Voice.hasClaim());
      tr.hidden = !canName;
      if (canName && document.activeElement !== $('topicIn')) {
        $('topicIn').value = window.Voice.topic ? window.Voice.topic() : '';
      }
    }

    var earBox = $('stageEars');
    earBox.textContent = '';
    $('earN').textContent = ears.length;
    if (!ears.length) {
      var n1 = document.createElement('p');
      n1.className = 'none';
      n1.textContent = 'Nobody listening yet.';
      earBox.appendChild(n1);
    }
    ears.forEach(function (p) {
      var d = document.createElement('div');
      d.className = 'ear' + (p.hand ? ' asking' : '');
      d.dataset.vid = p.id;
      if (p.hand) { var hs = document.createElement('span'); hs.className = 'handup'; hs.textContent = '✋'; d.appendChild(hs); }
      var av = document.createElement('span'); av.className = 'av' + (p.admin ? ' admring' : '');
      avatar(av, voiceFace(p));
      var nm = document.createElement('span'); nm.className = 'nm';
      nm.textContent = p.you ? 'You' : p.name;
      d.appendChild(av); d.appendChild(nm);
      earBox.appendChild(d);
    });

    $('talkJoin').textContent = inCall ? 'Leave the mic'
      : (framed && micPermitted() === false ? '🎙 Open a tab to talk' : '🎙 Join the mic');
    $('talkJoin').className = inCall ? 'btn g' : 'btn';
    $('talkMute').hidden = !inCall;
    updateSignals();
  }

  /* Where a gathering happens: All USA unless it was pinned to one state. */
  function gatheringRoom(g) {
    if (!g.rooms || !g.rooms.length || g.rooms.indexOf('US') > -1) return 'US';
    var target = g.rooms[0];
    if (me && !me.host && target !== me.state) return 'US';   // members can't enter other states
    return target;
  }

  function loadUpcoming() {
    if (!db.shared) { $('upWrap').hidden = true; return; }
    db.upcoming(room.a).then(function (list) {
      $('upWrap').hidden = !list.length;
      var box = $('upList');
      box.textContent = '';
      list.forEach(function (g) {
        var d = new Date(g.starts);
        var card = document.createElement('div');
        card.className = 'gcard';

        var date = document.createElement('div');
        date.className = 'gdate' + (g.live ? ' live' : '');
        var gm = document.createElement('div'); gm.className = 'gm';
        var gd = document.createElement('div'); gd.className = 'gd';
        if (g.live) { gm.textContent = 'TALK'; gd.textContent = 'NOW'; }
        else if (g.repeats) {
          gm.textContent = 'EVERY';
          gd.textContent = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        } else {
          gm.textContent = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          gd.textContent = String(d.getDate());
        }
        date.appendChild(gm); date.appendChild(gd);

        var body = document.createElement('div'); body.className = 'gbody';
        var tt = document.createElement('div'); tt.className = 'gt'; tt.textContent = g.title;
        var sub = document.createElement('div'); sub.className = 'gs';
        var when = (g.repeats
          ? 'every ' + d.toLocaleDateString('en-US', { weekday: 'long' })
          : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })) +
          ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' your time';
        var where = gatheringRoom(g) === 'US' ? 'All USA' : byAbbr(gatheringRoom(g)).n;
        sub.textContent = when + ' · in ' + where + ' · by ' + g.by;
        body.appendChild(tt); body.appendChild(sub);

        var go = document.createElement('button');
        go.type = 'button';
        go.className = g.live ? 'btn gjoin' : 'btn g gjoin';
        go.textContent = g.live ? '🎙 Join now' : 'Open the room';
        go.onclick = function () {
          var target = gatheringRoom(g);
          if (target !== room.a) openRoom(byAbbr(target));
          showTalk(true);
        };

        card.appendChild(date); card.appendChild(body); card.appendChild(go);
        box.appendChild(card);
      });
    }).catch(function () { $('upWrap').hidden = true; });
  }

  /* Chat ↔ Live Room. Entering the room seats you as a listener, so the
     speakers know they have an audience; leaving stands you back up. */
  function showTalk(open) {
    talkOpen = open;
    $('vTalk').hidden = !open;
    $('chat').hidden = open;
    $('cmp').hidden = open;
    $('emoji').hidden = true;
    document.querySelector('.voice').hidden = open;
    $('tabChat').setAttribute('aria-selected', String(!open));
    $('tabTalk').setAttribute('aria-selected', String(open));
    if (db.shared && window.Voice && me) {
      if (open) window.Voice.listen(room.a, me);
      else if (!inCall) window.Voice.unlisten();
    }
    if (open) loadUpcoming();
    else { unreadTab = 0; }
    renderVoice(lastVoiceList);
  }
  $('tabChat').onclick = function () { showTalk(false); };
  $('tabTalk').onclick = function () { showTalk(true); };

  /* Preview mode has nobody to call — the strip just proves the mic works. */
  function previewMeter(stream) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !me) return;
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
      renderVoice([{ you: true, name: me.name, bg: me.bg, fg: me.fg, role: 'mic', talking: (sum / data.length) > 8 }]);
      requestAnimationFrame(tick);
    })();
  }

  function joinVoice() {
    micBtn.textContent = 'Asking…';
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micStream = stream;
      inCall = true;
      micBtn.className = 'jn out';
      micBtn.textContent = 'Leave the mic';
      var mb = $('muteBtn');
      mb.hidden = false; mb.textContent = '🔇 Mute'; mb.dataset.muted = '';
      if (db.shared && window.Voice) window.Voice.join(room.a, me, stream);
      else previewMeter(stream);
    });
  }

  function leaveVoice() {
    if (window.Voice && window.Voice.active()) window.Voice.leave(talkOpen);
    if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
    micStream = null;
    inCall = false;
    micBtn.className = 'jn';
    micBtn.textContent = '🎙 Join the mic';
    $('muteBtn').hidden = true;
    if (db.shared && window.Voice && me && talkOpen) window.Voice.listen(room.a, me);
    if (!db.shared) renderVoice(talkOpen && me ? [{ you: true, name: me.name, bg: me.bg, fg: me.fg, role: 'listen' }] : []);
  }

  $('muteBtn').onclick = function () {
    var muted = !this.dataset.muted;
    this.dataset.muted = muted ? '1' : '';
    this.textContent = muted ? '🔊 Unmute' : '🔇 Mute';
    $('talkMute').textContent = this.textContent;
    if (window.Voice) window.Voice.setMuted(muted);
    if (!db.shared && micStream) {
      micStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
    }
  };

  /* A phone silences page audio when the mic stops, the screen locks, or
     the tab goes to the back. Every return to the page is a chance to
     start it playing again — none of them cost anything when it already is. */
  function wakeAudio() { if (window.Voice && window.Voice.resume) window.Voice.resume(); }
  ['click', 'touchend', 'focus'].forEach(function (ev) {
    window.addEventListener(ev, wakeAudio, true);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) wakeAudio();
  });

  micBtn.onclick = function () { showTalk(true); };
  micBtn.textContent = '🎙 Open the Live Room';

  $('topicSet').onclick = function () {
    if (window.Voice && window.Voice.setTopic) window.Voice.setTopic($('topicIn').value.trim());
    toast('Topic set — the room and the live banner carry it now.');
  };
  $('topicIn').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('topicSet').click(); }
  });

  $('handBtn').onclick = function () {
    if (!window.Voice || !window.Voice.present()) return;
    window.Voice.setHand(!window.Voice.handUp());
  };

  /* One emoji per beat: enthusiasm, not spam. */
  var lastEmote = 0;
  [].slice.call(document.querySelectorAll('#reactRow [data-e]')).forEach(function (b) {
    b.onclick = function () {
      if (!window.Voice || !window.Voice.present()) return;
      var now = Date.now();
      if (now - lastEmote < 700) return;
      lastEmote = now;
      window.Voice.emote(b.dataset.e);
    };
  });

  /* An emoji flies up from its sender's circle, wherever that circle is
     drawn — the stage, the listeners, or the strip above the chat. It
     flies in its own layer, pinned to the circle's spot on screen, so the
     stage redrawing underneath (which presence does constantly) can't
     swat it mid-flight. */
  if (window.Voice && window.Voice.onEmote) {
    window.Voice.onEmote(function (fromId, emoji) {
      if (typeof emoji !== 'string' || emoji.length > 8) return;
      var spots = document.querySelectorAll('[data-vid="' + fromId + '"]');
      if (!spots.length) return;
      [].slice.call(spots).forEach(function (spot) {
        var r = spot.getBoundingClientRect();
        if (!r.width) return;
        var f = document.createElement('span');
        f.className = 'fly';
        f.textContent = emoji;
        f.style.left = (r.left + r.width / 2) + 'px';
        f.style.top = (r.top + r.height * 0.3) + 'px';
        document.body.appendChild(f);
        setTimeout(function () { f.remove(); }, 2400);
      });
    });
  }

  $('talkJoin').onclick = function () {
    if (inCall) { leaveVoice(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.textContent = 'Voice not supported here';
      return;
    }
    if (framed && micPermitted() === false) { popOut(); return; }
    var btn = this;
    joinVoice().catch(function (err) {
      var name = (err && err.name) || 'Error';
      leaveVoice();
      if (name === 'NotAllowedError' && framed) { popOut(); return; }
      btn.textContent = name === 'NotAllowedError'
        ? 'Microphone blocked — press again to allow it'
        : 'No microphone found';
    });
  };

  $('talkMute').onclick = function () { $('muteBtn').onclick.call($('muteBtn')); };

  /* the state ↔ national switcher */
  $('rsState').onclick = function () { if (me && room.a === 'US') openRoom(byAbbr(me.state)); };
  $('rsUsa').onclick = function () { if (me && room.a !== 'US') openRoom(USA); };

  /* ── the admin zone ──────────────────────────────────────────── */
  function loadAnnList() {
    var box = $('annList');
    box.textContent = 'Loading…';
    db.noticesAll().then(function (list) {
      box.textContent = '';
      if (!list.length) {
        var e = document.createElement('p'); e.className = 'hint';
        e.textContent = 'No announcements yet.';
        box.appendChild(e);
        return;
      }
      var now = Date.now();
      list.forEach(function (n) {
        var row = document.createElement('div');
        row.className = 'annrow' + (n.disabled ? ' off' : '');
        var hd = document.createElement('div'); hd.className = 'ahd';
        var tt = document.createElement('b'); tt.textContent = n.title;
        hd.appendChild(tt);
        var chip = document.createElement('span');
        var expired = n.until && n.until < now;
        chip.className = 'chipst ' + (n.disabled ? 'off2' : expired ? 'off2' : n.starts && n.starts > now ? 'sched' : 'live');
        chip.textContent = n.disabled ? 'Off' : expired ? 'Expired' : n.starts && n.starts > now ? 'Scheduled' : 'Live';
        hd.appendChild(chip);
        if (n.repeats) {
          var rc = document.createElement('span');
          rc.className = 'chipst sched'; rc.textContent = 'Weekly';
          hd.appendChild(rc);
        }
        var sub = document.createElement('div'); sub.className = 'sub2';
        var bits = ['by ' + n.by, n.all ? 'every room' : n.rooms.length + ' room' + (n.rooms.length === 1 ? '' : 's'),
          'posted ' + new Date(n.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })];
        if (n.starts) bits.push('🗓 ' + new Date(n.starts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
        sub.textContent = bits.join(' · ');
        var acts = document.createElement('div'); acts.className = 'aacts';
        var tog = document.createElement('button'); tog.type = 'button';
        tog.textContent = n.disabled ? 'Turn on' : 'Turn off';
        tog.onclick = function () {
          db.setNoticeDisabled(n.id, !n.disabled).then(loadAnnList)
            .catch(function (err) { toast((err && err.message) || 'Could not change that'); });
        };
        var del = document.createElement('button'); del.type = 'button'; del.className = 'warn';
        del.textContent = 'Delete';
        del.onclick = function () {
          ask('Delete “' + n.title + '” for good?').then(function (ok) {
            if (!ok) return;
            db.deleteNotice(n.id).then(loadAnnList)
              .catch(function (err) { toast((err && err.message) || 'Could not delete'); });
          });
        };
        acts.appendChild(tog); acts.appendChild(del);
        row.appendChild(hd); row.appendChild(sub); row.appendChild(acts);
        box.appendChild(row);
      });
    }).catch(function (err) {
      box.textContent = 'Could not load — ' + ((err && err.message) || 'try again');
    });
  }

  function adminTab(which) {
    var map = { ann: ['atAnn', 'padAnn'], rep: ['atRep', 'padRep'], mem: ['atMem', 'padMem'] };
    Object.keys(map).forEach(function (k) {
      $(map[k][0]).setAttribute('aria-selected', String(k === which));
      $(map[k][1]).hidden = k !== which;
    });
    if (which === 'ann') loadAnnList();
    if (which === 'rep') loadReports();
    if (which === 'mem') loadMembersAdmin('');
  }
  $('atAnn').onclick = function () { adminTab('ann'); };
  $('atRep').onclick = function () { adminTab('rep'); };
  $('atMem').onclick = function () { adminTab('mem'); };

  function loadReports() {
    var pad = $('padRep');
    pad.textContent = 'Loading…';
    db.reports().then(function (list) {
      pad.textContent = '';
      if (!list.length) {
        var e = document.createElement('p'); e.className = 'hint';
        e.textContent = 'Nothing flagged. Quiet is good.';
        pad.appendChild(e);
        return;
      }
      list.forEach(function (r) {
        var card = document.createElement('div'); card.className = 'repcard';
        var hd = document.createElement('div'); hd.className = 'rhd';
        var cnt = document.createElement('span'); cnt.className = 'cnt';
        cnt.textContent = '⚑ ' + r.count;
        var who = document.createElement('b'); who.textContent = r.authorName;
        hd.appendChild(cnt); hd.appendChild(who);
        var wh = document.createElement('span');
        wh.textContent = (r.room ? 'in ' + byAbbr(r.room).n : '') + (r.when ? ' · ' + clock(r.when) : '');
        hd.appendChild(wh);
        var bd = document.createElement('div'); bd.className = 'bd'; bd.textContent = r.body;
        var acts = document.createElement('div'); acts.className = 'acts';
        var del = document.createElement('button'); del.className = 'btn'; del.type = 'button';
        del.textContent = 'Remove message';
        del.onclick = function () {
          ask('Remove this message for everyone?').then(function (ok) {
            if (!ok) return;
            db.removeMessage(r.messageId).then(function () {
              return db.clearReports(r.reportIds);
            }).then(loadReports).catch(function (err) { toast((err && err.message) || 'Could not remove'); });
          });
        };
        var dis = document.createElement('button'); dis.className = 'btn g'; dis.type = 'button';
        dis.textContent = 'Dismiss';
        dis.onclick = function () {
          db.clearReports(r.reportIds).then(loadReports)
            .catch(function (err) { toast((err && err.message) || 'Could not dismiss'); });
        };
        acts.appendChild(del); acts.appendChild(dis);
        card.appendChild(hd); card.appendChild(bd); card.appendChild(acts);
        pad.appendChild(card);
      });
    }).catch(function (err) {
      pad.textContent = 'Could not load reports — ' + ((err && err.message) || 'try again');
    });
  }

  var memTimer = null;
  $('memQ').oninput = function () {
    clearTimeout(memTimer);
    var q = this.value.trim();
    memTimer = setTimeout(function () { loadMembersAdmin(q); }, 400);
  };

  /* "3d ago", "just now" — for the members list. */
  function fmtAgo(iso) {
    if (!iso) return 'not seen yet';
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 3) return 'online now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
    var days = Math.floor(mins / 1440);
    return days === 1 ? 'yesterday' : days + ' days ago';
  }

  function loadMembersAdmin(q) {
    var box = $('memList');
    box.textContent = 'Loading…';
    /* The reports ride along, so a member with flagged messages carries
       a warning right in the list. */
    Promise.all([
      db.membersAll(q),
      db.reports().catch(function () { return []; })
    ]).then(function (both) {
      var list = both[0];
      var flagged = {};   // author id -> {msgs, flags}
      both[1].forEach(function (r) {
        if (!r.authorId) return;
        var f = flagged[r.authorId] || (flagged[r.authorId] = { msgs: 0, flags: 0 });
        f.msgs++; f.flags += r.count;
      });
      box.textContent = '';
      if (!list.length) {
        var e = document.createElement('p'); e.className = 'hint';
        e.textContent = q ? 'No member matches that.' : 'No members yet.';
        box.appendChild(e);
        return;
      }
      list.forEach(function (m2) {
        var row = document.createElement('div'); row.className = 'memrow';
        var av = document.createElement('span'); av.className = 'av sm';
        avatar(av, m2);
        var t = document.createElement('span'); t.className = 't';
        var n = document.createElement('span'); n.className = 'n'; n.textContent = m2.name;
        if (m2.is_host) { var b1 = document.createElement('span'); b1.className = 'tagb adm'; b1.textContent = 'Admin'; n.appendChild(b1); }
        if (m2.banned)  { var b2 = document.createElement('span'); b2.className = 'tagb ban'; b2.textContent = 'Removed'; n.appendChild(b2); }
        var fl = flagged[m2.id];
        if (fl) {
          var wb = document.createElement('span'); wb.className = 'tagb wrn';
          wb.textContent = '⚠ ' + fl.msgs + ' flagged';
          wb.title = fl.flags + (fl.flags === 1 ? ' report' : ' reports') +
            ' on ' + fl.msgs + (fl.msgs === 1 ? ' message' : ' messages') + ' — see the Reports tab';
          n.appendChild(wb);
        }
        var dd = document.createElement('span'); dd.className = 'd';
        dd.textContent = [byAbbr(m2.state).n, m2.city, m2.email].filter(Boolean).join(' · ');
        var mt = document.createElement('span'); mt.className = 'd';
        mt.textContent = (m2.created_at
          ? 'Joined ' + new Date(m2.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '') + ' · last seen ' + fmtAgo(m2.last_seen);
        t.appendChild(n); t.appendChild(dd); t.appendChild(mt);
        var acts = document.createElement('span'); acts.className = 'acts';
        if (me && m2.id !== me.id) {
          var ban = document.createElement('button'); ban.type = 'button';
          ban.className = m2.banned ? '' : 'warn';
          ban.textContent = m2.banned ? 'Restore access' : 'Remove from the app';
          ban.onclick = function () {
            var q2 = m2.banned
              ? 'Give ' + m2.name + ' access again?'
              : 'Remove ' + m2.name + '? They stay signed in but can no longer post anywhere.';
            ask(q2).then(function (ok) {
              if (!ok) return;
              db.setBanned(m2.id, !m2.banned).then(function () { loadMembersAdmin(q || ''); })
                .catch(function (err) { toast((err && err.message) || 'Could not change that'); });
            });
          };
          var adm = document.createElement('button'); adm.type = 'button';
          adm.textContent = m2.is_host ? 'Take admin away' : 'Make admin';
          adm.onclick = function () {
            ask((m2.is_host ? 'Remove admin from ' : 'Make ') + m2.name + (m2.is_host ? '?' : ' an admin?')).then(function (ok) {
              if (!ok) return;
              db.setAdmin(m2.id, !m2.is_host).then(function () { loadMembersAdmin(q || ''); })
                .catch(function (err) { toast((err && err.message) || 'Could not change that'); });
            });
          };
          acts.appendChild(ban); acts.appendChild(adm);
        }
        row.appendChild(av); row.appendChild(t); row.appendChild(acts);
        box.appendChild(row);
      });
    }).catch(function (err) {
      box.textContent = 'Could not load members — ' + ((err && err.message) || 'try again');
    });
  }

  function checkHash() {
    if (location.hash !== '#announce' && location.hash !== '#admin') return;
    if (!(me && me.host)) return;              // members never see this view
    $('pvWho').textContent = me.name;
    var d = new Date(Date.now() + 14 * 86400000);
    $('exp14').textContent = 'Clears itself on ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    tally();
    adminTab('ann');
    show('vAnn');
  }
  window.addEventListener('hashchange', checkHash);

  /* ── boot ────────────────────────────────────────────────────── */
  var wantVoice = (location.search.match(/[?&]voice=([A-Z]{2})/) || [])[1];
  if (wantVoice && wantVoice !== 'US' && !window.STATES.some(function (x) { return x.a === wantVoice; })) wantVoice = null;

  /* Opened from the community to sign in: remember the secret and clean the
     address bar so the Google round trip sees the plain app URL. */
  var linkIn = (ARRIVED.match(/[?&]link=([^&]+)/) || [])[1];
  if (linkIn) {
    try { sessionStorage.setItem('stateRooms.pair', decodeURIComponent(linkIn)); } catch (e) {}
    try { history.replaceState({}, '', location.pathname); } catch (e) {}
  }
  function stashedPair() {
    try { return sessionStorage.getItem('stateRooms.pair') || ''; } catch (e) { return ''; }
  }
  function clearPair() {
    try { sessionStorage.removeItem('stateRooms.pair'); } catch (e) {}
  }

  /* A full screen the sign-in tab can talk through — everything this tab
     does must be visible, because its whole job is to replace a silent
     popup that left people staring at nothing. */
  function tabScreen(title, lead) {
    $('app').textContent = '';
    var pane = document.createElement('div');
    pane.className = 'pane';
    var h = document.createElement('h1');
    h.textContent = title;
    var pl = document.createElement('p');
    pl.className = 'lead';
    pl.textContent = lead;
    pane.appendChild(h); pane.appendChild(pl);
    $('app').appendChild(pane);
    return pane;
  }

  function tabButton(pane, label, kind, fn) {
    var b = document.createElement('button');
    b.className = 'btn' + (kind ? ' ' + kind : '');
    b.type = 'button';
    b.style.marginTop = '18px';
    b.textContent = label;
    b.onclick = fn;
    pane.appendChild(b);
    return b;
  }

  /* Send the session home to the community page, then get out of the way:
     this little window closes itself, and the community behind it is
     already signed in. The sending repeats quietly for a few seconds. */
  function handBack(pair) {
    var pane = tabScreen('You’re signed in. ✓',
      'This window closes by itself — the community behind it is letting you in right now.');
    setTimeout(function () {
      try { window.close(); } catch (e) {}
      /* Some browsers refuse to let a window close itself after the
         Google trip. Then the words carry it. */
      setTimeout(function () {
        tabScreen('You’re signed in. ✓',
          'You can close this window — the community already has you in.');
      }, 400);
    }, 2500);
    return db.tokens().then(function (t) {
      return db.sendHandoff(pair, { tokens: t });
    }).then(clearPair).catch(function (err) {
      tabScreen('Nearly there',
        'You are signed in, but this window could not tell the community page (' +
        ((err && err.message) || 'connection issue') +
        '). Go back to the community and press the Google button once more.');
    });
  }

  var ready = window.DB_READY || Promise.reject(new Error('the data layer failed to load'));
  ready.then(function (store) {
    db = store;
    applyTheme(db.pref('theme', 'dark'));
    updateBanner();
    return db.init().then(function (profile) { return profile; });
  }).then(function (profile) {

    /* This tab was opened from the community (or is returning from Google
       on that errand): its job is signing in, not opening the room. */
    var pair = stashedPair();
    if (pair && db.shared) {
      $('boot').hidden = true;
      if (db.hasSession()) {
        if (/[?&#]code=/.test(ARRIVED)) {
          /* Fresh from Google — the account was chosen seconds ago. */
          return handBack(pair);
        }
        /* A session this tab already had. Never assume it's the right
           person — signing out in the community doesn't reach this tab. */
        var mail = (db.email && db.email()) || 'an earlier account';
        var pane = tabScreen('Use this account?',
          'This browser is already signed in as ' + mail + '.');
        tabButton(pane, 'Yes — continue as ' + mail, 'google', function () { handBack(pair); });
        tabButton(pane, 'No — sign in with a different account', '', function () {
          db.discardSession().then(function () { location.reload(); });
        });
        return;
      }
      /* Not signed in here: fall through to the ordinary sign-in screen.
         The secret stays stashed for after the Google round trip. */
    }

    me = profile;

    if (me && me.banned) {
      $('app').textContent = '';
      var dead = document.createElement('div');
      dead.className = 'pane';
      var h = document.createElement('h1');
      h.textContent = 'Your access has been removed.';
      var pl = document.createElement('p');
      pl.className = 'lead';
      pl.textContent = 'An admin removed you from State Rooms. If you believe this is a mistake, contact the community team.';
      dead.appendChild(h); dead.appendChild(pl);
      $('app').appendChild(dead);
      return;
    }

    /* On the real site, a broken data layer must never quietly become
       "preview mode" — that turns into a button that does nothing. Show
       the sign-in screen with the reason written on it instead. */
    var configured = !!(window.CONFIG && window.CONFIG.SUPABASE_URL);
    var healthy = db.shared || !configured;

    if (me && healthy) {
      $('nm').value = me.name;
      $('cty').value = me.city || '';
      sel.value = me.state;
      cityHint();
      openRoom(byAbbr(wantVoice || me.state));
      if (wantVoice && !framed) {
        showTalk(true);
        joinVoice().catch(function () { leaveVoice(); });
      }
    } else if (db.hasSession() && healthy) {
      showProfileStep();          // signed in, but we don't know them yet
    } else {
      $('signinBox').hidden = false;
      $('profileBox').hidden = true;
      $('buildTag').textContent = BUILD;
      /* Say the most useful true thing about why sign-in might not work,
         rather than leaving a button that does nothing. */
      if (!window.supabase) {
        saySigningIn('✕ The sign-in part of the app did not load — check your internet and reload this page', 'no');
      } else if (!db.shared) {
        saySigningIn('✕ Could not reach the database from this page', 'no');
      } else if (window.__errs && window.__errs.length) {
        saySigningIn('✕ App error: ' + window.__errs[0], 'no');
      }
      reportReturn();
      show('vJoin');
    }
    checkHash();
  }).catch(function (err) {
    console.error('Could not start:', err);
    $('boot').hidden = true;
    $('signinBox').hidden = false;
    $('buildTag').textContent = BUILD;
    show('vJoin');
    saySigningIn('✕ The app could not start: ' + ((err && err.message) || 'unknown error'), 'no');
  });
})();
