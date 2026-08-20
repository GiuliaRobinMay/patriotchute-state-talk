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
  var rafOn = false;

  var RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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
        role: role,
        talking: role === 'mic' &&
          (k === myId ? localTalking : !!(peers[k] && peers[k].talking))
      });
    });
    list.sort(function (a, b) {
      if (a.role !== b.role) return a.role === 'mic' ? -1 : 1;
      return a.you ? -1 : b.you ? 1 : 0;
    });

    /* A role change means the pair's wiring is wrong now — rebuild it. */
    Object.keys(peers).forEach(function (id) {
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
    peers[id] = { pc: pc, talking: false };
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
      var pc = entry ? entry.pc : makePc(p.from);
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

  /* ── hearing them, and seeing that they speak ─────────────────── */
  function attach(id, stream) {
    var entry = peers[id];
    if (!entry) return;
    if (!entry.audio) {
      entry.audio = new Audio();
      entry.audio.autoplay = true;
    }
    entry.audio.srcObject = stream;
    entry.audio.play().catch(function () {});   // entering was a click, so allowed
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !entry.ctx) {
      entry.ctx = new AC();
      var src = entry.ctx.createMediaStreamSource(stream);
      entry.an = entry.ctx.createAnalyser();
      entry.an.fftSize = 512;
      src.connect(entry.an);
    }
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
    try { if (entry.audio) { entry.audio.pause(); entry.audio.srcObject = null; } } catch (e) {}
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
  function ensure(ab) {
    var c = client();
    if (!c) return false;
    if (chan && room === ab) return true;
    teardown();
    room = ab;
    subscribed = false;
    chan = c.channel('voice:' + ab, {
      config: { presence: { key: myId }, broadcast: { self: false } }
    });
    chan.on('presence', { event: 'sync' }, emit);
    chan.on('broadcast', { event: 'sig' }, function (m) { onSig(m.payload); });
    chan.subscribe(function (status) {
      if (status !== 'SUBSCRIBED') return;
      subscribed = true;
      if (pendingTrack) { chan.track(localMeta); pendingTrack = false; }
      emit();
    });
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
      try { if (window.DB && window.DB.micPulse) window.DB.micPulse(ab, myId); } catch (e) {}
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
      localMeta = { name: who.name, bg: who.bg, fg: who.fg, host: !!who.host, uid: who.id || '', role: 'listen' };
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
      localStream = stream;
      localMeta = { name: who.name, bg: who.bg, fg: who.fg, host: !!who.host, uid: who.id || '', role: 'mic' };
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

    leave: function () {
      if (myRole !== 'mic') return;
      myRole = null;
      dropAll();
      stopLocalAudio();
      localMeta = null;
      stopMicPulse(room);
      try { if (chan) chan.untrack(); } catch (e) {}
      emit();
    },

    setMuted: function (m) {
      if (!localStream) return;
      localStream.getAudioTracks().forEach(function (t) { t.enabled = !m; });
    },

    active: function () { return myRole === 'mic'; },
    present: function () { return !!myRole; }
  };
})();
