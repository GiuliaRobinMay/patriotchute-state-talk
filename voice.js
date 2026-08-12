/* The rough voice test.
 *
 * Browsers talking straight to each other (WebRTC), with Supabase realtime
 * as the introduction service — who is in the call, and the handshake
 * messages that let two browsers find a route. No media server: audio goes
 * peer to peer. That's deliberately modest — it holds up for a handful of
 * people on the mic, which is what a test needs. If voice proves out,
 * a media server (LiveKit) replaces this file and nothing else.
 *
 * Two roles share one channel per room:
 *   watch(room, cb)          — see who is on the mic, without joining
 *   join(room, profile, s)   — take the mic with a microphone stream
 */
(function () {
  'use strict';

  /* Random per-tab identity. Deliberately not the account id: the same
     person may listen in the embed and talk in the pop-out tab at once. */
  var myId = 'v' + Math.random().toString(36).slice(2, 10);

  var chan = null, room = null, subscribed = false, pendingTrack = false;
  var ui = function () {};
  var joined = false, localStream = null, localMeta = null;
  var localCtx = null, localAn = null, localTalking = false;
  var peers = {};              // remoteId -> {pc, audio, ctx, an, talking}
  var rafOn = false;

  var RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function client() { return window.__sbClient || null; }

  /* ── presence → the list the UI draws ─────────────────────────── */
  function emit() {
    var st = chan ? chan.presenceState() : {};
    var list = [];
    Object.keys(st).forEach(function (k) {
      var meta = (st[k] && st[k][0]) || {};
      list.push({
        id: k,
        you: k === myId,
        name: meta.name || 'Someone',
        bg: meta.bg, fg: meta.fg,
        talking: k === myId ? localTalking : !!(peers[k] && peers[k].talking)
      });
    });
    list.sort(function (a, b) { return a.you ? -1 : b.you ? 1 : 0; });
    if (joined) reconcile(Object.keys(st));
    ui(list);
  }

  /* ── wiring: one connection per pair, lower id makes the offer ──── */
  function reconcile(ids) {
    ids.forEach(function (id) {
      if (id === myId || peers[id]) return;
      if (myId < id) makeOffer(id);
      /* otherwise wait: their offer creates our side */
    });
    Object.keys(peers).forEach(function (id) {
      if (ids.indexOf(id) === -1) drop(id);
    });
  }

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
    pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer).then(function () {
        send(id, 'offer', offer);
      });
    }).catch(function (e) { console.warn('voice offer failed:', e && e.message); });
  }

  function onSig(p) {
    if (!joined || !p || p.to !== myId) return;
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
    entry.audio.play().catch(function () {});   // join was a click, so allowed
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
      if (!joined && !Object.keys(peers).length) { rafOn = false; return; }
      var changedFlag = false;
      var lt = level(localAn) > 8;
      if (lt !== localTalking) { localTalking = lt; changedFlag = true; }
      Object.keys(peers).forEach(function (id) {
        var t = level(peers[id].an) > 8;
        if (t !== peers[id].talking) { peers[id].talking = t; changedFlag = true; }
      });
      if (changedFlag) emit();
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
      if (pendingTrack && localMeta) { chan.track(localMeta); pendingTrack = false; }
      emit();
    });
    return true;
  }

  function teardown() {
    Object.keys(peers).forEach(drop);
    if (chan) {
      var c = client();
      try { if (c) c.removeChannel(chan); } catch (e) {}
      chan = null;
    }
    subscribed = false;
  }

  /* ── public ───────────────────────────────────────────────────── */
  window.Voice = {

    /* See the call without being in it. Returns a stop function. */
    watch: function (ab, cb) {
      ui = cb || function () {};
      if (!ensure(ab)) { ui([]); return function () {}; }
      emit();
      return function () {
        if (!joined && room === ab) teardown();
      };
    },

    join: function (ab, profile, stream) {
      localStream = stream;
      localMeta = { name: profile.name, bg: profile.bg, fg: profile.fg };
      joined = true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        localCtx = new AC();
        var src = localCtx.createMediaStreamSource(stream);
        localAn = localCtx.createAnalyser();
        localAn.fftSize = 512;
        src.connect(localAn);
      }
      if (!ensure(ab)) return;
      if (subscribed) chan.track(localMeta);
      else pendingTrack = true;
      startLoop();
    },

    leave: function () {
      joined = false;
      pendingTrack = false;
      localTalking = false;
      try { if (chan) chan.untrack(); } catch (e) {}
      Object.keys(peers).forEach(drop);
      try { if (localCtx) localCtx.close(); } catch (e) {}
      localCtx = null; localAn = null; localStream = null; localMeta = null;
      emit();
    },

    setMuted: function (m) {
      if (!localStream) return;
      localStream.getAudioTracks().forEach(function (t) { t.enabled = !m; });
    },

    active: function () { return joined; }
  };
})();
