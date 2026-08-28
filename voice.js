/* The voice layer.
 *
 * Browsers talking straight to each other (WebRTC), with Supabase realtime
 * as the introduction service. No media server: audio goes peer to peer,
 * which holds up for a handful of speakers — if voice proves out, LiveKit
 * replaces this file and nothing else changes.
 *
 * Three ways to be in a room's voice channel:
 *   watch(room, cb)     — see the call from the chat view, not in it at all
 *   listen(room, who)   — sit in the talk room and hear the speakers
 *   join(room, who, s)  — take the mic with a microphone stream
 *
 * Connections exist only where audio can flow: every speaker pairs with
 * everyone present; two listeners have nothing to exchange. When someone's
 * role changes, both sides tear the pair down and rebuild it — blunt, but
 * always correct, and this is a test rig.
 */
(function () {
  'use strict';

  /* Random per-tab identity, deliberately not the account id: the same
     person may listen in the embed and talk in the pop-out tab at once. */
  var myId = 'v' + Math.random().toString(36).slice(2, 10);

  var chan = null, room = null, subscribed = false, pendingTrack = false;
  var ui = function () {};
  var myRole = null;                    // null | 'listen' | 'mic'
  var localMeta = null, localStream = null;
  var localCtx = null, localAn = null, localTalking = false;
  var peers = {};                       // remoteId -> {pc, audio, ctx, an, talking}
  var roles = {};                       // last seen role per presence key
  var seatBy = {};                      // presence key -> the seat drawn for it
  var rafOn = false;

  var RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var emoteCb = function () {};

  function client() { return window.__sbClient || null; }

  /* ── presence → the list the UI draws ─────────────────────────── */
  function emit() {
    var st = chan ? chan.presenceState() : {};
    var list = [], newRoles = {};
    Object.keys(st).forEach(function (k) {
      var meta = (st[k] && st[k][0]) || {};
      var role = meta.role || 'mic';
      newRoles[k] = role;
      list.push({
        id: k,
        you: k === myId,
        name: meta.name || 'Someone',
        bg: meta.bg, fg: meta.fg,
        uid: meta.uid || '',
        admin: !!meta.host,
        muted: !!meta.muted,
        hand: !!meta.hand,
        rank: meta.rank || 0,
        claim: meta.claim || 0,
        topic: meta.topic || '',
        since: meta.since || 0,
        role: role,
        talking: role === 'mic' &&
          (k === myId ? localTalking : !!(peers[k] && peers[k].talking))
      });
    });
    /* One person, one seat.
       A phone talker is in the room twice at once — listening in the
       community's embed and talking in the pop-out tab — because each tab
       joins under its own key. The room must show them once, on the mic,
       and never as a speaker plus a silent stranger wearing their name.
       Tabs of one account collapse into the loudest of them, and if any of
       them is this tab, the surviving seat is "you". */
    var seen = {}, kept = [];
    seatBy = {};
    list.forEach(function (p) {
      if (!p.uid) { kept.push(p); seatBy[p.id] = p.id; return; }   // preview has no account
      var prev = seen[p.uid];
      if (!prev) { seen[p.uid] = p; kept.push(p); seatBy[p.id] = p.id; return; }
      var keep = (p.role === 'mic' && prev.role !== 'mic') ? p : prev;
      var drop = keep === p ? prev : p;
      keep.you = keep.you || drop.you;
      keep.admin = keep.admin || drop.admin;
      if (keep === p) { seen[p.uid] = p; kept[kept.indexOf(prev)] = p; }
      /* Anything already pointing at the seat we just gave up follows it. */
      Object.keys(seatBy).forEach(function (k) {
        if (seatBy[k] === drop.id) seatBy[k] = keep.id;
      });
      seatBy[drop.id] = keep.id;
      seatBy[keep.id] = keep.id;
    });
    list = kept;

    list.sort(function (a, b) {
      if (a.role !== b.role) return a.role === 'mic' ? -1 : 1;
      if (a.role === 'listen' && a.hand !== b.hand) return a.hand ? -1 : 1;
      if (a.since !== b.since) return a.since - b.since;
      return a.id < b.id ? -1 : 1;
    });
    /* Who runs the room: the owner outranks admins outranks members.
       Within a rank, the one holding the room's claim (its opener, or
       whoever the opener handed it to), then the longest on the mic.
       The chip moves; the seats never do. */
    var mod = null;
    list.forEach(function (p) {
      if (p.role !== 'mic') return;
      if (!mod) { mod = p; return; }
      if (p.rank !== mod.rank) { if (p.rank > mod.rank) mod = p; return; }
      if (!!p.claim !== !!mod.claim) { if (p.claim) mod = p; return; }
      if (p.claim && mod.claim && p.claim !== mod.claim) { if (p.claim < mod.claim) mod = p; return; }
      if (p.since < mod.since) mod = p;
    });
    if (mod) mod.moderator = true;

    /* A role change means the pair's wiring is wrong now — rebuild it.
       Except for a pair still being built: presence syncs arrive in the
       middle of a handshake, and dropping there is how a good connection
       destroys itself moments after coming up. */
    Object.keys(peers).forEach(function (id) {
      if (Date.now() - (peers[id].born || 0) < 2000) return;
      if (roles[id] && newRoles[id] && roles[id] !== newRoles[id]) drop(id);
    });
    roles = newRoles;

    if (myRole) reconcile(newRoles);
    ui(list);
  }

  function reconcile(rolesMap) {
    Object.keys(rolesMap).forEach(function (id) {
      if (id === myId || peers[id]) return;
      if (myRole !== 'mic' && rolesMap[id] !== 'mic') return;   // nothing to carry
      if (myId < id) makeOffer(id);
      /* otherwise their offer creates our side */
    });
    Object.keys(peers).forEach(function (id) {
      if (!(id in rolesMap)) { drop(id); return; }
      if (myRole !== 'mic' && rolesMap[id] !== 'mic') drop(id);
    });
  }

  /* ── the wiring: lower id makes the offer ─────────────────────── */
  function makePc(id) {
    var pc = new RTCPeerConnection(RTC_CONFIG);
    if (localStream) {
      localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
    }
    pc.onicecandidate = function (e) { if (e.candidate) send(id, 'ice', e.candidate); };
    pc.ontrack = function (e) { attach(id, e.streams[0]); };
    /* Phones roam between wifi and cellular mid-sentence. When a pair
       gives up, drop it and let the next presence sync rebuild it. */
    pc.oniceconnectionstatechange = function () {
      var st = pc.iceConnectionState;
      if (st !== 'failed' && st !== 'disconnected') return;
      setTimeout(function () {
        var e2 = peers[id];
        if (!e2 || e2.pc !== pc) return;
        var now = pc.iceConnectionState;
        if (now !== 'failed' && now !== 'disconnected') return;
        drop(id);
        emit();
      }, 4000);
    };
    peers[id] = { pc: pc, talking: false, born: Date.now() };
    startLoop();
    return pc;
  }

  function makeOffer(id) {
    var pc = makePc(id);
    /* A listener sends no audio, but must still ask to receive it. */
    if (!localStream) pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer).then(function () {
        send(id, 'offer', offer);
      });
    }).catch(function (e) { console.warn('voice offer failed:', e && e.message); });
  }

  function onSig(p) {
    if (!myRole || !p || p.to !== myId) return;
    var entry = peers[p.from];
    if (p.kind === 'offer') {
      /* An offer for a pair we already hold means the other side rebuilt
         theirs — feeding a live connection a fresh offer half-applies and
         leaves audio flowing one way only. Start clean instead. */
      if (entry) { drop(p.from); entry = null; }
      var pc = makePc(p.from);
      pc.setRemoteDescription(new RTCSessionDescription(p.data)).then(function () {
        return pc.createAnswer();
      }).then(function (answer) {
        return pc.setLocalDescription(answer).then(function () {
          send(p.from, 'answer', answer);
        });
      }).catch(function (e) { console.warn('voice answer failed:', e && e.message); });
    } else if (p.kind === 'answer' && entry) {
      entry.pc.setRemoteDescription(new RTCSessionDescription(p.data))
        .catch(function (e) { console.warn('voice accept failed:', e && e.message); });
    } else if (p.kind === 'ice' && entry) {
      entry.pc.addIceCandidate(new RTCIceCandidate(p.data)).catch(function () {});
    }
  }

  function send(to, kind, data) {
    if (!chan) return;
    chan.send({ type: 'broadcast', event: 'sig',
      payload: { to: to, from: myId, kind: kind, data: data } });
  }

  /* ── hearing them, and seeing that they speak ───────────────────
     Hearing must never depend on the microphone. A detached `new Audio()`
     rides whatever audio session the page happens to have, which on a
     phone is the one the microphone opened — so muting or leaving the mic
     took people's hearing away with it. Real elements, in the page, that
     keep playing on their own. */
  var sink = null;
  function audioSink() {
    if (sink && sink.parentNode) return sink;
    sink = document.createElement('div');
    sink.setAttribute('aria-hidden', 'true');
    sink.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden';
    document.body.appendChild(sink);
    return sink;
  }

  function attach(id, stream) {
    var entry = peers[id];
    if (!entry) return;
    if (!entry.audio) {
      var a = document.createElement('audio');
      a.autoplay = true;
      a.setAttribute('playsinline', '');    // iOS refuses to play without it
      a.playsInline = true;
      a.controls = false;
      a.volume = 1;
      audioSink().appendChild(a);
      entry.audio = a;
    }
    entry.audio.srcObject = stream;
    play(entry.audio);
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !entry.ctx) {
      entry.ctx = new AC();
      var src = entry.ctx.createMediaStreamSource(stream);
      entry.an = entry.ctx.createAnalyser();
      entry.an.fftSize = 512;
      src.connect(entry.an);
    }
  }

  function play(el) {
    if (!el) return;
    var p = el.play();
    if (p && p.catch) p.catch(function () {});   // retried by resume()
  }

  /* Called whenever the audio ground may have shifted under us: the
     microphone stopping, the tab coming back, or any tap on the page. */
  function resume() {
    Object.keys(peers).forEach(function (id) {
      var e = peers[id];
      if (e.audio && e.audio.paused) play(e.audio);
      if (e.ctx && e.ctx.state === 'suspended') {
        try { e.ctx.resume(); } catch (x) {}
      }
    });
  }

  function level(an) {
    if (!an) return 0;
    var data = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(data);
    var sum = 0;
    for (var i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length;
  }

  function startLoop() {
    if (rafOn) return;
    rafOn = true;
    (function tick() {
      if (!myRole && !Object.keys(peers).length) { rafOn = false; return; }
      var flipped = false;
      var lt = level(localAn) > 8;
      if (lt !== localTalking) { localTalking = lt; flipped = true; }
      Object.keys(peers).forEach(function (id) {
        var t = level(peers[id].an) > 8;
        if (t !== peers[id].talking) { peers[id].talking = t; flipped = true; }
      });
      if (flipped) emit();
      requestAnimationFrame(tick);
    })();
  }

  function drop(id) {
    var entry = peers[id];
    if (!entry) return;
    try { entry.pc.close(); } catch (e) {}
    try {
      if (entry.audio) {
        entry.audio.pause();
        entry.audio.srcObject = null;
        if (entry.audio.parentNode) entry.audio.parentNode.removeChild(entry.audio);
      }
    } catch (e) {}
    try { if (entry.ctx) entry.ctx.close(); } catch (e) {}
    delete peers[id];
  }

  function dropAll() { Object.keys(peers).forEach(drop); }

  function announce() {
    if (!chan || !localMeta) return;
    if (subscribed) chan.track(localMeta);
    else pendingTrack = true;
  }

  /* ── the channel ──────────────────────────────────────────────── */
  var gen = 0;
  function ensure(ab) {
    var c = client();
    if (!c) return false;
    if (chan && room === ab) return true;
    teardown();
    room = ab;
    subscribed = false;
    var my = ++gen;
    var full = 'realtime:voice:' + ab;
    /* The client hands every caller of a name the SAME channel object —
       including one still saying goodbye after a room switch. Joining that
       half-dead instance made presence one-directional: she saw me, I
       never saw her. Wait until the name is truly free, then start clean. */
    (function whenFree(tries) {
      if (my !== gen) return;                     // switched again meanwhile
      var stale = (c.getChannels ? c.getChannels() : []).find(function (x) {
        return x.topic === full;
      });
      if (stale && tries < 40) {
        try { c.removeChannel(stale).catch(function () {}); } catch (e) {}
        setTimeout(function () { whenFree(tries + 1); }, 50);
        return;
      }
      chan = c.channel('voice:' + ab, {
        config: { presence: { key: myId }, broadcast: { self: false } }
      });
      chan.on('presence', { event: 'sync' }, emit);
      chan.on('broadcast', { event: 'sig' }, function (m) { onSig(m.payload); });
      chan.on('broadcast', { event: 'emote' }, function (m) {
        var p = m.payload || {};
        if (p.from && p.emoji) emoteCb(p.from, p.emoji);
      });
      chan.on('broadcast', { event: 'modpass' }, function (m) {
        var p = m.payload || {};
        if (p.to !== myId || myRole !== 'mic' || !localMeta) return;
        localMeta.claim = p.claim || Date.now();
        localMeta.topic = p.topic || '';
        announce();
      });
      chan.subscribe(function (status) {
        if (status !== 'SUBSCRIBED' || my !== gen) return;
        subscribed = true;
        if (pendingTrack) { chan.track(localMeta); pendingTrack = false; }
        emit();
      });
    })(0);
    return true;
  }

  function teardown() {
    dropAll();
    roles = {};
    if (chan) {
      var c = client();
      try { if (c) c.removeChannel(chan); } catch (e) {}
      chan = null;
    }
    subscribed = false;
  }

  function stopLocalAudio() {
    try { if (localCtx) localCtx.close(); } catch (e) {}
    localCtx = null; localAn = null; localStream = null; localTalking = false;
  }

  /* While on the mic, tell the whole app's shared pulse channel — that is
     how badges and the host rail see activity without joining this room. */
  var pulseIv = null;
  function startMicPulse(ab) {
    stopMicPulse(null);
    function beat() {
      try {
        if (window.DB && window.DB.micPulse) {
          window.DB.micPulse(ab, myId, false, {
            name: (localMeta && localMeta.name) || '',
            topic: (localMeta && localMeta.claim && localMeta.topic) || ''
          });
        }
      } catch (e) {}
    }
    beat();
    pulseIv = setInterval(beat, 4000);
  }
  function stopMicPulse(ab) {
    if (pulseIv) { clearInterval(pulseIv); pulseIv = null; }
    if (ab) {
      try { if (window.DB && window.DB.micPulse) window.DB.micPulse(ab, myId, true); } catch (e) {}
    }
  }

  /* ── public ───────────────────────────────────────────────────── */
  window.Voice = {

    watch: function (ab, cb) {
      ui = cb || function () {};
      if (!ensure(ab)) { ui([]); return function () {}; }
      emit();
      return function () {
        if (!myRole && room === ab) teardown();
      };
    },

    listen: function (ab, who) {
      if (myRole === 'mic') return;      // already louder than a listener
      localMeta = { name: who.name, bg: who.bg, fg: who.fg, host: !!who.host, rank: who.owner ? 2 : who.host ? 1 : 0, uid: who.id || '', role: 'listen', since: Date.now(), hand: false, claim: 0, topic: '' };
      myRole = 'listen';
      if (!ensure(ab)) return;
      announce();
      emit();
    },

    unlisten: function () {
      if (myRole !== 'listen') return;
      myRole = null;
      dropAll();
      try { if (chan) chan.untrack(); } catch (e) {}
      emit();
    },

    join: function (ab, who, stream) {
      /* Nobody else on the mic means this person is opening the room. */
      var prevClaim = 0, prevTopic = '';
      try {
        var st0 = chan ? chan.presenceState() : {};
        var micsNow = Object.keys(st0).filter(function (k) {
          if (k === myId) return false;
          var m0 = (st0[k] && st0[k][0]) || {};
          return (m0.role || 'mic') === 'mic';
        }).length;
        if (micsNow === 0) prevClaim = Date.now();
      } catch (e) {}
      if (localMeta && localMeta.claim) { prevClaim = localMeta.claim; prevTopic = localMeta.topic || ''; }
      localStream = stream;
      localMeta = { name: who.name, bg: who.bg, fg: who.fg, host: !!who.host, rank: who.owner ? 2 : who.host ? 1 : 0, uid: who.id || '', role: 'mic', since: Date.now(), hand: false, claim: prevClaim, topic: prevTopic };
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        localCtx = new AC();
        var src = localCtx.createMediaStreamSource(stream);
        localAn = localCtx.createAnalyser();
        localAn.fftSize = 512;
        src.connect(localAn);
      }
      /* Our old pairs were made without a microphone — rebuild them with one. */
      dropAll();
      myRole = 'mic';
      if (!ensure(ab)) return;
      announce();
      startMicPulse(ab);
      startLoop();
    },

    /* Stepping off the mic is not leaving the room: the pairs that carry
       other people's voices stay exactly as they are, and only our own
       sending stops. Stopping the microphone ends the phone's recording
       session, which is the moment playback needs a nudge to carry on
       under the new one. */
    leave: function (stayListening) {
      if (myRole !== 'mic') return;
      stopMicPulse(room);
      if (stayListening === false) {
        myRole = null;
        dropAll();
        stopLocalAudio();
        localMeta = null;
        try { if (chan) chan.untrack(); } catch (e) {}
        emit();
        return;
      }
      myRole = 'listen';
      if (localMeta) { localMeta.claim = 0; localMeta.topic = ''; }
      /* Our pairs were built around a microphone; without one they must be
         rebuilt — but only the ones that were only ever carrying us. */
      Object.keys(peers).forEach(function (id) {
        if (roles[id] !== 'mic') drop(id);      // listener-to-listener: nothing left to carry
      });
      stopLocalAudio();
      if (localMeta) { localMeta.role = 'listen'; localMeta.muted = false; }
      announce();
      emit();
      setTimeout(resume, 250);
      setTimeout(resume, 1200);
    },

    setMuted: function (m) {
      if (!localStream) return;
      localStream.getAudioTracks().forEach(function (t) { t.enabled = !m; });
      /* Muting silences what we send. It never touches what we hear —
         and the room gets to see who is quiet on purpose. */
      if (localMeta) { localMeta.muted = !!m; announce(); }
      resume();
    },

    hasClaim: function () { return !!(localMeta && localMeta.claim); },
    topic: function () { return (localMeta && localMeta.topic) || ''; },
    setTopic: function (t) {
      if (!localMeta || !localMeta.claim) return;
      localMeta.topic = String(t || '').slice(0, 80);
      announce();
      emit();
    },
    passModerator: function (toId) {
      if (!chan || !localMeta || myRole !== 'mic') return;
      var claim = localMeta.claim || Date.now();
      var topic = localMeta.topic || '';
      try {
        chan.send({ type: 'broadcast', event: 'modpass',
          payload: { to: toId, claim: claim, topic: topic } });
      } catch (e) {}
      localMeta.claim = 0;
      localMeta.topic = '';
      announce();
      emit();
    },

    /* A raised hand rides on presence, so everyone sees it at once. */
    setHand: function (up) {
      if (!localMeta) return;
      localMeta.hand = !!up;
      announce();
      emit();
    },
    handUp: function () { return !!(localMeta && localMeta.hand); },

    /* A flying emoji: broadcast to the room, and shown at home too,
       since the room's own send is not echoed back. */
    emote: function (emoji) {
      if (!chan || !myRole) return;
      try {
        chan.send({ type: 'broadcast', event: 'emote',
          payload: { from: myId, emoji: emoji } });
      } catch (e) {}
      emoteCb(myId, emoji);
    },
    onEmote: function (cb) { emoteCb = cb || function () {}; },

    myKey: function () { return myId; },
    /* Which circle stands for a given tab — the tab's own, unless it was
       folded into another tab of the same account. */
    seatFor: function (id) { return seatBy[id] || id; },
    active: function () { return myRole === 'mic'; },
    present: function () { return !!myRole; },
    resume: resume
  };
})();
