/* The data layer.
 *
 * Two implementations behind one interface. Local keeps everything on the
 * visitor's own device and is what runs before the database exists; Shared
 * talks to Supabase and is what makes two people see the same room.
 *
 * app.js never knows which one it has. If Supabase is configured but
 * unreachable, we fall back to Local rather than showing a broken screen —
 * a member with no connection should still see their own history.
 */
(function () {
  'use strict';

  var KEY = 'stateRooms.v1.';

  /* ── device storage, wrapped ──────────────────────────────────────
     An embedded page is exactly where localStorage throws: Safari
     partitions it and private modes disable it. Fall back to memory. */
  var memory = {}, works = true;
  try {
    localStorage.setItem(KEY + 'probe', '1');
    localStorage.removeItem(KEY + 'probe');
  } catch (e) { works = false; }

  function put(k, v) {
    var s = JSON.stringify(v);
    memory[k] = s;
    if (works) { try { localStorage.setItem(KEY + k, s); } catch (e) { works = false; } }
  }
  function get(k, fallback) {
    var raw = null;
    if (works) { try { raw = localStorage.getItem(KEY + k); } catch (e) { works = false; } }
    if (raw === null) raw = memory[k] || null;
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  /* ── preview mode: this device only ──────────────────────────── */
  var Local = {
    shared: false,
    storageWorks: function () { return works; },

    init: function () { return Promise.resolve(get('profile', null)); },

    saveProfile: function (p) { put('profile', p); return Promise.resolve(p); },

    signOut: function () { put('profile', null); return Promise.resolve(); },

    /* Nobody else exists in preview mode, so every message is yours. */
    messages: function (room) {
      return Promise.resolve(get('msgs.' + room, []).map(function (m) {
        m.mine = true; return m;
      }));
    },

    send: function (room, msg) {
      var all = get('msgs.' + room, []);
      all.push(msg);
      if (all.length > 300) all = all.slice(-300);
      put('msgs.' + room, all);
      return Promise.resolve(msg);
    },

    onMessages: function () { return function () {}; },

    members: function (state, me) {
      return Promise.resolve(me ? [{
        name: me.name, city: me.city, bg: me.bg, fg: me.fg,
        photo: me.photo, online: true, you: true
      }] : []);
    },

    nameTaken: function () { return Promise.resolve(false); },

    hasSession: function () { return true; },
    email: function () { return ''; },
    signInWithGoogle: function () { return Promise.reject(new Error('Preview mode — no database configured')); },
    signInAnonymous: function () { return Promise.resolve(null); },
    tokens: function () { return Promise.resolve(null); },
    adoptTokens: function () { return Promise.resolve(); },
    onHandoff: function () { return function () {}; },
    sendHandoff: function () { return Promise.resolve(); },
    signInError: function () { return ''; },

    onPresence: function () { return function () {}; },

    notice: function () {
      var n = get('notice', null);
      if (n && n.until && Date.now() > n.until) { put('notice', null); return Promise.resolve(null); }
      return Promise.resolve(n);
    },
    setNotice: function (n) { put('notice', n); return Promise.resolve(); },
    clearNotice: function () { put('notice', null); return Promise.resolve(); },

    upcoming: function () { return Promise.resolve([]); },
    peekRoom: function () { return function () {}; },
    noticesAll: function () { return Promise.resolve([]); },
    onAnyMessage: function () { return function () {}; },
    peekVoiceMany: function () { return function () {}; },
    setNoticeDisabled: function () { return Promise.resolve(); },
    deleteNotice: function () { return Promise.resolve(); },
    report: function () { return Promise.resolve(); },
    reports: function () { return Promise.resolve([]); },
    removeMessage: function () { return Promise.resolve(); },
    clearReports: function () { return Promise.resolve(); },
    membersAll: function () { return Promise.resolve([]); },
    setBanned: function () { return Promise.resolve(); },
    setAdmin: function () { return Promise.resolve(); },

    dismissed: function (id) { return get('dismissed.' + id, false); },
    dismiss: function (id) { put('dismissed.' + id, true); },
    pref: get,
    setPref: put
  };

  /* ── shared mode: everyone sees the same room ────────────────── */
  function Shared(client) {
    var uid = null, authEmail = '', cache = {}, sessionOnce = null;

    /* Google sends people back with a one-time code in the address bar, and
       supabase-js trades it for a session asynchronously. Asking for the
       session straight away therefore returns nothing, the app concludes
       nobody is signed in, and shows the sign-in screen again — which is
       exactly the loop this avoids. Wait for the library to say it has
       finished with the URL, and only then look. */
    function firstSession() {
      if (sessionOnce) return sessionOnce;
      sessionOnce = new Promise(function (resolve) {
        var settled = false;
        function finish(session) {
          if (settled) return;
          settled = true;
          try { sub.data.subscription.unsubscribe(); } catch (e) {}
          /* Drop ?code=... so a refresh doesn't try to spend it twice. */
          if (/[?&#](code|error)=/.test(location.search + location.hash)) {
            try { history.replaceState({}, '', location.pathname); } catch (e) {}
          }
          resolve(session || null);
        }
        /* When a code is still in the address bar, an empty first event just
           means the exchange hasn't landed yet — keep waiting for SIGNED_IN
           rather than concluding nobody is here and bouncing them back to
           the sign-in screen. */
        var returning = /[?&]code=/.test(location.search);
        var sub = client.auth.onAuthStateChange(function (event, session) {
          if (session) { finish(session); return; }
          if (event === 'INITIAL_SESSION' && !returning) finish(null);
        });
        /* If the event never lands, fall back rather than hanging the app. */
        setTimeout(function () {
          if (settled) return;
          client.auth.getSession().then(function (r) {
            finish(r.data && r.data.session);
          }).catch(function () { finish(null); });
        }, 4000);
      });
      return sessionOnce;
    }

    function row2msg(r, who) {
      return {
        id: r.id,
        name: (who && who.name) || r.name || 'Someone',
        city: (who && who.city) || r.city || '',
        bg: (who && who.bg) || r.bg,
        fg: (who && who.fg) || r.fg,
        photo: (who && who.photo) || r.photo,
        admin: !!(who && who.is_host),
        text: r.body,
        mine: r.author === uid,
        ts: new Date(r.created_at).getTime()
      };
    }

    return {
      shared: true,
      storageWorks: function () { return works; },

      /* Signing in no longer happens by itself. A Google account is the same
         person on every device forever; an anonymous one exists only in the
         browser that made it, which is why it is the fallback and not the
         default. Returns the profile, or null when there is no session or no
         profile yet — the app tells those two apart with hasSession(). */
      init: function () {
        return firstSession().then(function (session) {
          if (!session) { uid = null; return null; }
          uid = session.user.id;
          authEmail = (session.user.email) || '';
          return client.from('profiles').select('*').eq('id', uid).maybeSingle()
            .then(function (p) {
              if (p.error) throw p.error;
              if (!p.data) return null;
              return {
                id: uid, name: p.data.name, city: p.data.city, state: p.data.state,
                bg: p.data.bg, fg: p.data.fg, photo: p.data.photo,
                email: p.data.email, host: p.data.is_host, banned: p.data.banned
              };
            });
        });
      },

      hasSession: function () { return !!uid; },
      email: function () { return authEmail; },

      signInWithGoogle: function (redirectTo) {
        return client.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectTo,
            /* Always show the account chooser, so signing out really means
               being able to come back as someone else. */
            queryParams: { prompt: 'select_account' }
          }
        }).then(function (r) { if (r.error) throw r.error; });
      },

      signInAnonymous: function () {
        return client.auth.signInAnonymously().then(function (r) {
          if (r.error) throw r.error;
          uid = r.data.session.user.id;
          sessionOnce = Promise.resolve(r.data.session);   // replace the cached "nobody"
          return null;
        });
      },

      /* Used to carry a session from the sign-in tab back into the embed. */
      tokens: function () {
        return client.auth.getSession().then(function (r) {
          var s = r.data && r.data.session;
          return s ? { access_token: s.access_token, refresh_token: s.refresh_token } : null;
        });
      },
      adoptTokens: function (t) {
        function take(session) {
          uid = session.user.id;
          authEmail = session.user.email || '';
          sessionOnce = Promise.resolve(session);
        }
        return client.auth.setSession(t).then(function (r) {
          if (r.error) throw r.error;
          take(r.data.session);
        }).catch(function (err) {
          /* The library may have picked the session up on its own in the
             meantime — check before declaring the sign-in failed. */
          return client.auth.getSession().then(function (r) {
            var s = r.data && r.data.session;
            if (!s) throw err;
            take(s);
          });
        });
      },

      /* The sign-in window and the embed cannot rely on talking directly:
         Google's pages sever the window-to-window link mid-trip, and the
         browser gives the two separate storage. The one thing they always
         share is the Realtime server, so the finished session travels home
         over a channel named by a secret only those two windows know. */
      onHandoff: function (id, cb) {
        var ch = client.channel('handoff:' + id);
        ch.on('broadcast', { event: 'session' }, function (m) { cb(m.payload || {}); });
        ch.subscribe();
        return function () { try { client.removeChannel(ch); } catch (e) {} };
      },

      /* Repeat a few times — the embed may still be subscribing. */
      sendHandoff: function (id, payload) {
        return new Promise(function (resolve) {
          var ch = client.channel('handoff:' + id), sent = 0, done = false;
          function stop() {
            if (done) return;
            done = true;
            try { client.removeChannel(ch); } catch (e) {}
            resolve();
          }
          ch.subscribe(function (status) {
            if (status !== 'SUBSCRIBED') return;
            var iv = setInterval(function () {
              try { ch.send({ type: 'broadcast', event: 'session', payload: payload }); } catch (e) {}
              if (++sent >= 8) { clearInterval(iv); stop(); }
            }, 600);
          });
          setTimeout(stop, 8000);   // never leave the window hanging
        });
      },

      /* Google reports refusals in the address bar rather than by throwing. */
      signInError: function () {
        var where = location.search + location.hash;
        var m = where.match(/[?&#]error_description=([^&]*)/)
             || where.match(/[?&#]error=([^&]*)/);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
      },

      saveProfile: function (p) {
        return client.from('profiles').upsert({
          id: uid, name: p.name, city: p.city, state: p.state,
          bg: p.bg, fg: p.fg, photo: p.photo, email: p.email || authEmail,
          updated_at: new Date().toISOString()
        }).select().single().then(function (r) {
          if (r.error) throw r.error;
          p.id = uid;
          p.host = r.data.is_host;
          return p;
        });
      },

      /* The local session dies first and unconditionally — no network call
         gets a chance to hang inside the embed and leave someone stuck
         signed in. The server-side revoke is fired without being awaited. */
      signOut: function () {
        try {
          for (var i = localStorage.length - 1; i >= 0; i--) {
            var k = localStorage.key(i);
            if (k && k.indexOf(KEY + 'auth') === 0) localStorage.removeItem(k);
          }
        } catch (e) {}
        /* 'local' keeps the promise the dialog makes: this device only —
           the same person's phone stays signed in. */
        try { client.auth.signOut({ scope: 'local' }).catch(function () {}); } catch (e) {}
        return Promise.resolve();
      },

      /* Two queries rather than a join. messages.author points at auth.users,
         not at profiles, so the database has no relationship to follow and a
         nested select fails outright — which is what left new arrivals
         staring at an empty room. Fetch the messages, then look up the
         handful of authors we haven't seen before. */
      messages: function (room) {
        return client.from('messages')
          .select('id, body, created_at, author')
          .eq('room', room)
          .order('created_at', { ascending: false })
          .limit(200)
          .then(function (r) {
            if (r.error) throw r.error;
            var rows = r.data.reverse();
            var need = [];
            rows.forEach(function (x) {
              if (!cache[x.author] && need.indexOf(x.author) === -1) need.push(x.author);
            });
            if (!need.length) {
              return rows.map(function (x) { return row2msg(x, cache[x.author]); });
            }
            return client.from('profiles')
              .select('id, name, city, bg, fg, photo, is_host')
              .in('id', need)
              .then(function (p) {
                if (!p.error && p.data) {
                  p.data.forEach(function (pr) { cache[pr.id] = pr; });
                }
                return rows.map(function (x) { return row2msg(x, cache[x.author]); });
              });
          });
      },

      /* Two people called "Dana R." in one room helps nobody. */
      nameTaken: function (state, name) {
        return client.from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('state', state)
          .ilike('name', name)
          .neq('id', uid)
          .then(function (r) {
            if (r.error) throw r.error;
            return (r.count || 0) > 0;
          });
      },

      send: function (room, msg) {
        return client.from('messages')
          .insert({ room: room, author: uid, body: msg.text })
          .select().single()
          .then(function (r) {
            if (r.error) throw r.error;
            return row2msg(r.data, msg);
          });
      },

      /* New rows arrive without the author's name attached, so look it up
         once per person and remember it. */
      onMessages: function (room, cb, gone) {
        var ch = client.channel('room:' + room)
          .on('postgres_changes',
              { event: 'DELETE', schema: 'public', table: 'messages' },
              function (payload) {
                if (gone && payload.old && payload.old.id) gone(payload.old.id);
              })
          .on('postgres_changes',
              { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room=eq.' + room },
              function (payload) {
                var r = payload.new;
                if (r.author === uid) return;          // already on screen
                if (cache[r.author]) { cb(row2msg(r, cache[r.author])); return; }
                client.from('profiles').select('name, city, bg, fg, photo, is_host')
                  .eq('id', r.author).maybeSingle()
                  .then(function (p) {
                    if (p.data) cache[r.author] = p.data;
                    cb(row2msg(r, p.data));
                  });
              })
          .subscribe();
        return function () { client.removeChannel(ch); };
      },

      members: function (state, me) {
        return client.from('profiles')
          .select('id, name, city, bg, fg, photo, is_host')
          .eq('state', state)
          .order('updated_at', { ascending: false })
          .limit(500)
          .then(function (r) {
            if (r.error) throw r.error;
            return r.data.map(function (p) {
              return {
                id: p.id, name: p.name, city: p.city, bg: p.bg, fg: p.fg,
                photo: p.photo, admin: p.is_host,
                you: p.id === uid, online: p.id === uid
              };
            });
          });
      },

      /* Presence is ephemeral by nature — nobody needs it written down. */
      onPresence: function (room, me, cb) {
        var ch = client.channel('presence:' + room, { config: { presence: { key: uid } } });
        ch.on('presence', { event: 'sync' }, function () {
          var st = ch.presenceState();
          cb(Object.keys(st).map(function (k) {
            var m = (st[k] && st[k][0]) || {};
            return { id: k, name: m.name, city: m.city, bg: m.bg, fg: m.fg, admin: !!m.host };
          }));
        }).subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            ch.track({ name: me.name, city: me.city, bg: me.bg, fg: me.fg, host: !!me.host });
          }
        });
        return function () { client.removeChannel(ch); };
      },

      notice: function (room) {
        return client.from('notices')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)
          .then(function (r) {
            if (r.error) throw r.error;
            var now = Date.now();
            var hit = (r.data || []).filter(function (n) {
              if (n.disabled) return false;
              if (n.until && new Date(n.until).getTime() < now) return false;
              return !n.rooms.length || n.rooms.indexOf(room) > -1;
            })[0];
            if (!hit) return null;
            return {
              id: String(hit.id), by: hit.author_name, title: hit.title,
              body: hit.body, until: hit.until ? new Date(hit.until).getTime() : 0,
              starts: hit.starts_at ? new Date(hit.starts_at).getTime() : 0
            };
          });
      },

      setNotice: function (n) {
        var row = {
          title: n.title, body: n.body, rooms: n.all ? [] : n.rooms,
          author: uid, author_name: n.by,
          until: n.until ? new Date(n.until).toISOString() : null
        };
        if (n.starts) row.starts_at = new Date(n.starts).toISOString();
        if (n.repeats) row.repeats = true;
        return client.from('notices').insert(row).then(function (r) {
          /* The gather column arrives by a one-line migration; until it has
             run, pin the notice without the time rather than failing. */
          if (r.error && /starts_at|repeats/.test(r.error.message || '')) {
            delete row.starts_at;
            delete row.repeats;
            console.warn('notices.starts_at missing — run the alter in schema.sql');
            return client.from('notices').insert(row).then(function (r2) {
              if (r2.error) throw r2.error;
            });
          }
          if (r.error) throw r.error;
        });
      },

      clearNotice: function () {
        return client.from('notices').delete().neq('id', -1)
          .then(function (r) { if (r.error) throw r.error; });
      },

      /* A quiet look at a room you are not in — fires on each new message
         and whenever the number of people on its mic changes. The message
         listener uses its own topic (postgres_changes doesn't care), but
         presence is tied to the real topic name, so the voice peek joins
         'voice:<ab>' without ever tracking itself into it. */
      peekRoom: function (ab, hooks) {
        var chans = [];
        if (hooks.onMsg) {
          var mch = client.channel('peek-room:' + ab)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room=eq.' + ab },
                function () { hooks.onMsg(); })
            .subscribe();
          chans.push(mch);
        }
        if (hooks.onVoice) {
          var vch = client.channel('voice:' + ab, {
            config: { presence: { key: 'peek-' + Math.random().toString(36).slice(2, 8) } }
          });
          vch.on('presence', { event: 'sync' }, function () {
            var st = vch.presenceState(), mics = 0;
            Object.keys(st).forEach(function (k) {
              var m = (st[k] && st[k][0]) || {};
              if ((m.role || 'mic') === 'mic') mics++;
            });
            hooks.onVoice(mics);
          }).subscribe();
          chans.push(vch);
        }
        return function () {
          chans.forEach(function (c) { try { client.removeChannel(c); } catch (e) {} });
        };
      },

      /* Upcoming gather moments, next occurrence first. A weekly repeat is
         rolled forward client-side to its next future occurrence. */
      upcoming: function (roomAb) {
        return client.from('notices').select('*')
          .not('starts_at', 'is', null)
          .order('starts_at', { ascending: true })
          .limit(30)
          .then(function (r) {
            if (r.error) throw r.error;
            var now = Date.now(), out = [];
            (r.data || []).forEach(function (n) {
              if (n.disabled) return;
              var t = new Date(n.starts_at).getTime();
              if (n.repeats) { while (t + 3 * 3600000 < now) t += 7 * 86400000; }
              if (t + 3 * 3600000 < now) return;
              if (n.rooms.length && n.rooms.indexOf('US') === -1 && n.rooms.indexOf(roomAb) === -1) return;
              out.push({
                id: String(n.id), title: n.title, body: n.body, by: n.author_name,
                rooms: n.rooms, starts: t, repeats: !!n.repeats,
                live: now >= t && now < t + 3 * 3600000
              });
            });
            out.sort(function (a, b) { return a.starts - b.starts; });
            return out.slice(0, 6);
          });
      },

      /* Admin awareness across every room. One channel carries every
         message insert; voice needs a presence join per room, so this is
         host-only and skips the room the host is already in. */
      onAnyMessage: function (cb) {
        var ch = client.channel('pulse-msgs')
          .on('postgres_changes',
              { event: 'INSERT', schema: 'public', table: 'messages' },
              function (payload) { cb(payload.new.room, payload.new.author); })
          .subscribe();
        return function () { try { client.removeChannel(ch); } catch (e) {} };
      },

      peekVoiceMany: function (abs, cb) {
        var chans = abs.map(function (ab) {
          var vch = client.channel('voice:' + ab, {
            config: { presence: { key: 'pulse-' + Math.random().toString(36).slice(2, 8) } }
          });
          vch.on('presence', { event: 'sync' }, function () {
            var st = vch.presenceState(), mics = 0;
            Object.keys(st).forEach(function (k) {
              var m = (st[k] && st[k][0]) || {};
              if ((m.role || 'mic') === 'mic') mics++;
            });
            cb(ab, mics);
          }).subscribe();
          return vch;
        });
        return function () {
          chans.forEach(function (c) { try { client.removeChannel(c); } catch (e) {} });
        };
      },

      noticesAll: function () {
        return client.from('notices').select('*')
          .order('created_at', { ascending: false })
          .limit(50)
          .then(function (r) {
            if (r.error) throw r.error;
            return (r.data || []).map(function (n) {
              return {
                id: n.id, title: n.title, body: n.body, by: n.author_name,
                all: !n.rooms.length, rooms: n.rooms,
                until: n.until ? new Date(n.until).getTime() : 0,
                starts: n.starts_at ? new Date(n.starts_at).getTime() : 0,
                repeats: !!n.repeats, disabled: !!n.disabled,
                created: new Date(n.created_at).getTime()
              };
            });
          });
      },

      setNoticeDisabled: function (id, off) {
        return client.from('notices').update({ disabled: off }).eq('id', id)
          .then(function (r) { if (r.error) throw r.error; });
      },

      deleteNotice: function (id) {
        return client.from('notices').delete().eq('id', id)
          .then(function (r) { if (r.error) throw r.error; });
      },

      report: function (messageId) {
        return client.from('reports').insert({ message_id: messageId, reporter: uid })
          .then(function (r) {
            /* 23505 = they already flagged it, which is the same outcome */
            if (r.error && r.error.code !== '23505') throw r.error;
          });
      },

      reports: function () {
        return client.from('reports')
          .select('id, message_id, created_at')
          .order('created_at', { ascending: false })
          .limit(100)
          .then(function (r) {
            if (r.error) throw r.error;
            var rows = r.data || [];
            if (!rows.length) return [];
            var ids = [];
            rows.forEach(function (x) { if (ids.indexOf(x.message_id) === -1) ids.push(x.message_id); });
            return client.from('messages')
              .select('id, room, body, created_at, author')
              .in('id', ids)
              .then(function (m) {
                var msgs = {};
                (m.data || []).forEach(function (x) { msgs[x.id] = x; });
                var need = [];
                (m.data || []).forEach(function (x) { if (need.indexOf(x.author) === -1) need.push(x.author); });
                var lookup = need.length
                  ? client.from('profiles').select('id, name, state').in('id', need)
                  : Promise.resolve({ data: [] });
                return lookup.then(function (pp) {
                  var names = {};
                  (pp.data || []).forEach(function (x) { names[x.id] = x; });
                  var grouped = {};
                  rows.forEach(function (rep) {
                    var g = grouped[rep.message_id] ||
                      (grouped[rep.message_id] = { count: 0, reportIds: [] });
                    g.count++;
                    g.reportIds.push(rep.id);
                  });
                  return Object.keys(grouped).map(function (k) {
                    var g = grouped[k], msg = msgs[k], who = msg && names[msg.author];
                    return {
                      messageId: Number(k), count: g.count, reportIds: g.reportIds,
                      body: msg ? msg.body : '(message already removed)',
                      room: msg ? msg.room : '',
                      authorName: who ? who.name : 'unknown',
                      authorState: who ? who.state : '',
                      authorId: msg ? msg.author : null,
                      when: msg ? new Date(msg.created_at).getTime() : 0
                    };
                  }).sort(function (a, b) { return b.count - a.count; });
                });
              });
          });
      },

      removeMessage: function (id) {
        return client.from('messages').delete().eq('id', id)
          .then(function (r) { if (r.error) throw r.error; });
      },

      clearReports: function (reportIds) {
        return client.from('reports').delete().in('id', reportIds)
          .then(function (r) { if (r.error) throw r.error; });
      },

      membersAll: function (q) {
        var sel = client.from('profiles')
          .select('id, name, city, state, email, is_host, banned, bg, fg, photo')
          .order('created_at', { ascending: false })
          .limit(200);
        if (q) sel = sel.ilike('name', '%' + q + '%');
        return sel.then(function (r) { if (r.error) throw r.error; return r.data || []; });
      },

      setBanned: function (id, b) {
        return client.rpc('admin_set_banned', { target: id, value: b })
          .then(function (r) { if (r.error) throw r.error; });
      },
      setAdmin: function (id, b) {
        return client.rpc('admin_set_admin', { target: id, value: b })
          .then(function (r) { if (r.error) throw r.error; });
      },

      dismissed: function (id) { return get('dismissed.' + id, false); },
      dismiss: function (id) { put('dismissed.' + id, true); },
      pref: get,
      setPref: put
    };
  }

  /* ── pick one ─────────────────────────────────────────────────── */
  var cfg = window.CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  window.DB = Local;
  window.DB_READY = new Promise(function (resolve) {
    if (!configured || !window.supabase) { resolve(Local); return; }
    try {
      var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,   // required for the Google return trip
          flowType: 'pkce',
          storageKey: KEY + 'auth'
        }
      });
      window.__sbClient = client;   // voice.js signals over the same connection
      var shared = Shared(client);
      /* Prove the connection works before handing it to the app. This no
         longer creates an account as a side effect — it just reads whatever
         session this browser already has. */
      shared.init().then(function () {
        window.DB = shared;
        resolve(shared);
      }).catch(function (err) {
        console.warn('Shared mode unavailable, staying on this device:', err && err.message);
        resolve(Local);
      });
    } catch (e) {
      console.warn('Could not reach the database:', e && e.message);
      resolve(Local);
    }
  });
})();
