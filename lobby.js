import {
  auth, db, googleProvider, ref, set, get, push, remove, onValue, onDisconnect,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, updateProfile,
  COLORS, state, $, showToast, playSfx
} from "./firebase.js";
import { applySettingsUI, refreshProfileUI, initFriendsAndChat } from "./profile-friends.js";
import { startAiArena, startOnlineArena } from "./games/survival-arena.js";

let authMode = "login";
let roomListeners = [];

// Animated Ripple & Soft Sound on every button click
document.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".btn, .nav-item, .tab-btn");
  if (!btn || btn.disabled) return;
  playSfx("click");
  const r = document.createElement("span");
  r.className = "ripple-effect";
  const rect = btn.getBoundingClientRect();
  r.style.left = (e.clientX - rect.left) + "px";
  r.style.top = (e.clientY - rect.top) + "px";
  btn.appendChild(r);
  setTimeout(() => r.remove(), 550);
});

applySettingsUI();

function genCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// AUTH
window.handleGoogleLogin = async () => {
  if (!location.protocol.startsWith("http")) {
    return showToast("چوونەژوورەوە بە گووگڵ تەنها لەسەر لینکە ئۆنڵاینەکە کاردەکات!");
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, googleProvider);
    } else showToast("هەڵەی گووگڵ: " + err.message);
  }
};
getRedirectResult(auth).catch(() => {});

window.switchAuthTab = (mode) => {
  authMode = mode;
  $("tabLoginBtn").classList.toggle("active", mode === "login");
  $("tabRegBtn").classList.toggle("active", mode === "register");
  $("regNameGroup").classList.toggle("hidden", mode === "login");
  $("authSubmitBtn").textContent = mode === "login" ? "چوونەژوورەوە" : "دروستکردنی هەژمار";
};

window.handleAuth = async () => {
  const email = $("authEmail").value.trim();
  const pass = $("authPass").value.trim();
  const name = $("authName").value.trim();
  if (!email || pass.length < 6) return showToast("ئیمەیڵ بنووسە و وشەی نهێنی لانیکەم ٦ پیت بێت");
  try {
    if (authMode === "register") {
      if (name.length < 2) return showToast("ناوێکی گونجاو بنووسە");
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      const fCode = "KA" + genCode(4);
      const init = {
        name, level: 1, xp: 0, coins: 250, wins: 0, kills: 0, matches: 0,
        avatar: "🥷", photoData: "", birthdate: "", bio: "",
        joinDate: new Date().toISOString().slice(0,10), friendCode: fCode,
        xpBoostMatches: 0, upgrades: { hp: 0, speed: 0, dmg: 0 }
      };
      await set(ref(db, `users/${cred.user.uid}`), init);
      await set(ref(db, `friendCodes/${fCode}`), { uid: cred.user.uid, name });
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (err) {
    showToast("هەڵە: " + err.message);
  }
};

window.logoutUser = async () => {
  if (state.currentRoomId) await window.leaveWaitingRoom();
  await signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.currentUser = user;
    try {
      const snap = await get(ref(db, `users/${user.uid}`));
      if (snap.exists()) {
        state.userProfile = { ...state.userProfile, ...snap.val() };
        if (!state.userProfile.friendCode) {
          state.userProfile.friendCode = "KA" + genCode(4);
          await set(ref(db, `friendCodes/${state.userProfile.friendCode}`), { uid: user.uid, name: state.userProfile.name });
          await set(ref(db, `users/${user.uid}/friendCode`), state.userProfile.friendCode);
        }
      } else {
        const fCode = "KA" + genCode(4);
        state.userProfile = {
          ...state.userProfile, name: (user.displayName || "یاریزان").slice(0, 16),
          joinDate: new Date().toISOString().slice(0,10), friendCode: fCode
        };
        await set(ref(db, `users/${user.uid}`), state.userProfile);
        await set(ref(db, `friendCodes/${fCode}`), { uid: user.uid, name: state.userProfile.name });
      }
      initFriendsAndChat();
      listenPublicRooms();
    } catch { showToast("دڵنیابە Realtime Database چالاککراوە"); }

    $("authScreen").classList.add("hidden");
    $("lobbyScreen").classList.remove("hidden");
    refreshProfileUI();
  } else {
    state.currentUser = null;
    $("lobbyScreen").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
  }
});

// NAVIGATION & GAME HUB
window.switchNav = (tab, btn) => {
  ["hub", "friends", "leaderboard", "profile", "settings"].forEach(t => $("tab-" + t).classList.add("hidden"));
  $("tab-" + tab).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  if (btn) btn.classList.add("active");
  if (tab === "leaderboard") window.loadLeaderboard();
};

window.openSurvivalSection = () => {
  $("hubGamesView").classList.add("hidden");
  $("survivalLobbyView").classList.remove("hidden");
};

window.backToGameHub = () => {
  $("survivalLobbyView").classList.add("hidden");
  $("hubGamesView").classList.remove("hidden");
};

window.loadLeaderboard = async () => {
  const box = $("leaderboardList");
  box.innerHTML = `<p style="color:var(--muted);">بارکردن...</p>`;
  const snap = await get(ref(db, "users"));
  if (!snap.exists()) { box.innerHTML = "هیچ یاریزانێک نییە"; return; }
  const list = Object.values(snap.val()).sort((a, b) => (b.wins - a.wins) || (b.kills - a.kills)).slice(0, 20);
  box.innerHTML = list.map((u, idx) => `
    <div class="lb-row">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-weight:900; color:${idx===0?'var(--gold)':idx===1?'#cbd5e1':idx===2?'#fb923c':'var(--muted)'};">#${idx+1}</span>
        <span style="font-size:20px;">${u.avatar || "🥷"}</span>
        <div>
          <div style="font-weight:700;">${u.name}</div>
          <div style="font-size:11px; color:var(--muted);">ئاستی ${u.level} • ${u.kills || 0} کوشتن</div>
        </div>
      </div>
      <div style="font-weight:800; color:var(--primary);">🏆 ${u.wins || 0}</div>
    </div>
  `).join("");
};

// ROOMS
function listenPublicRooms() {
  onValue(ref(db, "rooms"), (snap) => {
    const box = $("publicRoomsList");
    if (!snap.exists()) { box.innerHTML = `<p style="color:var(--muted); font-size:13px;">هیچ ڕوومێکی کراوە نییە.</p>`; return; }
    const html = [];
    const now = Date.now();
    Object.entries(snap.val()).forEach(([id, r]) => {
      const pCount = r.players ? Object.keys(r.players).length : 0;
      if (!r.isPrivate && r.status === "waiting" && pCount > 0 && (now - (r.createdAt || now) < 3600000)) {
        html.push(`
          <div class="room-item">
            <div><div style="font-weight:700;">${r.name}</div><div style="font-size:12px; color:var(--muted);">یاریزان: ${pCount}/${r.maxPlayers} • کۆد: ${r.code}</div></div>
            <button class="btn btn-sm" onclick="joinRoom('${id}')">چوونەژوورەوە</button>
          </div>
        `);
      }
    });
    box.innerHTML = html.length ? html.join("") : `<p style="color:var(--muted); font-size:13px;">هیچ ڕوومێکی گشتی چاوەڕوان نییە.</p>`;
  });
}

window.createRoom = async () => {
  const name = $("newRoomName").value.trim() || `ڕوومی ${state.userProfile.name}`;
  const maxPlayers = parseInt($("newRoomMax").value);
  const isPrivate = $("newRoomPrivacy").value === "private";
  const roomRef = push(ref(db, "rooms"));
  await set(roomRef, { name, code: genCode(6), maxPlayers, isPrivate, hostUid: state.currentUser.uid, status: "waiting", createdAt: Date.now() });
  await window.joinRoom(roomRef.key);
};

window.joinRoomByCode = async () => {
  const code = $("joinCodeInput").value.trim().toUpperCase();
  if (code.length < 4) return showToast("کۆدێکی دروست بنووسە");
  const snap = await get(ref(db, "rooms"));
  if (!snap.exists()) return showToast("ڕووم نەدۆزرایەوە");
  let foundId = null;
  Object.entries(snap.val()).forEach(([id, r]) => { if (r.code === code && r.status === "waiting") foundId = id; });
  if (!foundId) return showToast("ڕوومەکە نەدۆزرایەوە یان یاری دەستی پێکردووە");
  await window.joinRoom(foundId);
};

window.joinRoom = async (roomId) => {
  const rSnap = await get(ref(db, `rooms/${roomId}`));
  if (!rSnap.exists()) return showToast("ڕووم بوونی نییە");
  const rData = rSnap.val();
  const players = rData.players || {};
  const count = Object.keys(players).length;
  if (count >= rData.maxPlayers && !players[state.currentUser.uid]) return showToast("ڕوومەکە پڕ بووە!");
  if (rData.status !== "waiting") return showToast("یاری لەم ڕوومەدا دەستی پێکردووە!");

  state.currentRoomId = roomId;
  state.isRoomHost = rData.hostUid === state.currentUser.uid;
  const p = state.userProfile;
  const pRef = ref(db, `rooms/${roomId}/players/${state.currentUser.uid}`);
  await set(pRef, {
    uid: state.currentUser.uid, name: p.name, avatar: p.avatar || "🥷", color: COLORS[count % COLORS.length],
    hp: 100 + (p.upgrades?.hp || 0) * 10, maxHp: 100 + (p.upgrades?.hp || 0) * 10,
    shield: 0, alive: true, kills: 0, x: 900, y: 900, angle: 0,
    speedMult: 1 + (p.upgrades?.speed || 0) * 0.05, dmgMult: 1 + (p.upgrades?.dmg || 0) * 0.06, isBot: false
  });
  onDisconnect(pRef).remove();

  $("lobbyScreen").classList.add("hidden");
  $("waitingRoomScreen").classList.remove("hidden");
  listenWaitingRoom(roomId);
};

function clearRoomListeners() { roomListeners.forEach(u => u()); roomListeners = []; }

function listenWaitingRoom(roomId) {
  clearRoomListeners();
  roomListeners.push(onValue(ref(db, `rooms/${roomId}`), (snap) => {
    if (!snap.exists()) { showToast("ڕوومەکە داخرا"); window.leaveWaitingRoom(true); return; }
    const r = snap.val();
    state.isRoomHost = r.hostUid === state.currentUser.uid;
    $("waitRoomTitle").textContent = r.name;
    $("waitRoomCode").textContent = r.code;
    $("waitMaxPlayers").textContent = r.maxPlayers;

    const players = r.players ? Object.values(r.players) : [];
    $("waitPlayerCount").textContent = players.length;
    $("waitPlayersList").innerHTML = players.map(p => `
      <div class="player-slot">
        <div style="font-size:26px;">${p.avatar || "🥷"}</div>
        <div style="font-weight:700; margin-top:4px;">${p.name}</div>
        <div style="font-size:11px; color:${p.uid===r.hostUid?'var(--gold)':'var(--muted)'};">${p.uid===r.hostUid ? "👑 سەرۆکی ڕووم" : p.isBot ? "🤖 بۆت" : "یاریزان"}</div>
      </div>
    `).join("");

    $("hostControls").classList.toggle("hidden", !state.isRoomHost);
    $("guestWaitMsg").classList.toggle("hidden", state.isRoomHost);

    if (r.status === "playing") {
      clearRoomListeners();
      $("waitingRoomScreen").classList.add("hidden");
      startOnlineArena(roomId, r);
    }
  }));
}

window.copyRoomCode = () => {
  navigator.clipboard?.writeText($("waitRoomCode").textContent);
  showToast("کۆدی ڕووم کۆپی کرا!");
};

window.leaveWaitingRoom = async (skipDb = false) => {
  clearRoomListeners();
  if (!skipDb && state.currentRoomId && state.currentUser) {
    await remove(ref(db, `rooms/${state.currentRoomId}/players/${state.currentUser.uid}`));
    if (state.isRoomHost) await remove(ref(db, `rooms/${state.currentRoomId}`));
  }
  state.currentRoomId = null;
  $("waitingRoomScreen").classList.add("hidden");
  $("lobbyScreen").classList.remove("hidden");
};

window.hostStartMatch = async () => {
  const rSnap = await get(ref(db, `rooms/${state.currentRoomId}`));
  const r = rSnap.val();
  const players = r.players || {};
  const count = Object.keys(players).length;
  const fillAi = $("fillAiCheckbox").checked;
  if (count < 3 && !fillAi) return showToast("پێویستت بە لانیکەم ٣ یاریزانە");

  const updates = {};
  const allIds = Object.keys(players);
  const total = Math.max(3, Math.min(r.maxPlayers, fillAi ? Math.max(count, 4) : count));

  allIds.forEach((uid, i) => {
    const ang = (i / total) * Math.PI * 2;
    updates[`players/${uid}/x`] = Math.round(900 + Math.cos(ang) * 580);
    updates[`players/${uid}/y`] = Math.round(900 + Math.sin(ang) * 580);
    updates[`players/${uid}/alive`] = true; updates[`players/${uid}/kills`] = 0;
    updates[`players/${uid}/hp`] = players[uid].maxHp || 100;
  });

  if (fillAi && count < total) {
    for (let i = count; i < total; i++) {
      const bid = "bot_" + i, ang = (i / total) * Math.PI * 2;
      updates[`players/${bid}`] = {
        uid: bid, name: `AI_Bot_${i}`, avatar: "🤖", color: COLORS[i % COLORS.length],
        hp: 100, maxHp: 100, shield: 0, alive: true, kills: 0,
        x: Math.round(900 + Math.cos(ang) * 580), y: Math.round(900 + Math.sin(ang) * 580),
        angle: 0, isBot: true, dmgMult: 0.9, speedMult: 0.95
      };
    }
  }
  updates["zone"] = { x: 900, y: 900, radius: 950 };
  updates["status"] = "playing";
  await (await import("./firebase.js")).update(ref(db, `rooms/${state.currentRoomId}`), updates);
};

window.startOfflineQuick = () => {
  $("authScreen").classList.add("hidden");
  startAiArena(5, "medium", true);
};

window.startAiTraining = () => {
  $("lobbyScreen").classList.add("hidden");
  startAiArena(parseInt($("aiCount").value), $("aiDifficulty").value, false);
};