import {
  db, ref, set, get, push, remove, onValue, onChildAdded, onDisconnect, updateProfile,
  AVATARS, state, $, xpNeeded, showToast, saveProfile, renderAvatarEl, playSfx
} from "./firebase.js";

let chatUnsub = null;

export function applySettingsUI() {
  document.documentElement.style.setProperty("--primary", state.settings.theme || "#00f5d4");
  $("setSound").checked = state.settings.sound !== false;
  $("setShadows").checked = state.settings.shadows !== false;
}

export function refreshProfileUI() {
  const p = state.userProfile;
  $("topName").textContent = p.name;
  renderAvatarEl($("topAvatarBox"), p);
  renderAvatarEl($("profAvatarPreview"), p);

  $("topLevel").textContent = p.level;
  $("topCoins").textContent = p.coins;
  $("topWins").textContent = p.wins;
  $("topFriendCode").textContent = "#" + (p.friendCode || "------");
  $("myShareCode").textContent = "#" + (p.friendCode || "------");

  const req = xpNeeded(p.level);
  $("topXpBar").style.width = Math.min(100, (p.xp / req) * 100) + "%";
  $("topBoostTag").classList.toggle("hidden", !(p.xpBoostMatches > 0));
  if (p.xpBoostMatches > 0) $("topBoostTag").textContent = `• ⚡ 2x XP (${p.xpBoostMatches})`;

  $("newNameInput").value = p.name || "";
  $("profBirthdate").value = p.birthdate || "";
  $("profBio").value = p.bio || "";
  $("profJoinDate").textContent = p.joinDate || "-";
  $("profKills").textContent = p.kills || 0;
  $("profMatches").textContent = p.matches || 0;

  const upg = p.upgrades || { hp: 0, speed: 0, dmg: 0 };
  $("upgHpLvl").textContent = upg.hp;
  $("upgSpeedLvl").textContent = upg.speed;
  $("upgDmgLvl").textContent = upg.dmg;
  $("btnUpgHp").disabled = upg.hp >= 5;
  $("btnUpgSpeed").disabled = upg.speed >= 5;
  $("btnUpgDmg").disabled = upg.dmg >= 5;

  const box = $("avatarPicker");
  box.innerHTML = "";
  AVATARS.forEach(av => {
    const btn = document.createElement("button");
    btn.className = "btn btn-outline btn-sm";
    btn.style.fontSize = "20px";
    btn.style.borderColor = p.avatar === av && !p.photoData ? "var(--primary)" : "var(--border)";
    btn.textContent = av;
    btn.onclick = async () => {
      p.avatar = av;
      await saveProfile();
      refreshProfileUI();
      showToast("لۆگۆی پڕۆفایل گۆڕدرا!");
    };
    box.appendChild(btn);
  });
}

export function initFriendsAndChat() {
  const uid = state.currentUser.uid;
  const statusRef = ref(db, `status/${uid}`);
  set(statusRef, { online: true, lastSeen: Date.now() });
  onDisconnect(statusRef).set({ online: false, lastSeen: Date.now() });

  // Listen Friend Requests
  onValue(ref(db, `friendRequests/${uid}`), (snap) => {
    const box = $("friendRequestsBox");
    const badge = $("reqBadge");
    if (!snap.exists()) {
      box.innerHTML = "";
      badge.classList.add("hidden");
      return;
    }
    const reqs = Object.values(snap.val());
    badge.textContent = reqs.length;
    badge.classList.remove("hidden");
    box.innerHTML = `<div style="font-size:12px; color:var(--gold); margin-bottom:6px;">داواکاری هاوڕێیەتی:</div>` +
      reqs.map(r => `
        <div class="room-item">
          <div style="font-weight:700;">${r.fromAvatar || "🥷"} ${r.fromName}</div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm" onclick="respondFriendReq('${r.fromUid}', true)">قبوڵ</button>
            <button class="btn btn-danger btn-sm" onclick="respondFriendReq('${r.fromUid}', false)">ڕەت</button>
          </div>
        </div>
      `).join("");
  });

  // Listen Friends List
  onValue(ref(db, `friends/${uid}`), async (snap) => {
    const box = $("friendsListBox");
    if (!snap.exists()) {
      box.innerHTML = `<p style="color:var(--muted); font-size:13px;">هێشتا هاوڕێت نییە، کۆدەکەی بنووسە بۆ زیادکردن!</p>`;
      return;
    }
    const fUids = Object.keys(snap.val());
    const items = [];
    for (const fUid of fUids) {
      const [uSnap, stSnap] = await Promise.all([get(ref(db, `users/${fUid}`)), get(ref(db, `status/${fUid}`))]);
      if (!uSnap.exists()) continue;
      const fu = uSnap.val();
      const online = stSnap.val()?.online;
      items.push(`
        <div class="room-item">
          <div style="display:flex; align-items:center; gap:9px;">
            <span style="font-size:20px;">${fu.avatar || "🥷"}</span>
            <div>
              <div style="font-weight:700;">${fu.name}</div>
              <div style="font-size:11px; color:${online ? "#4ade80" : "var(--muted)"};">${online ? "🟢 سەرهێڵە" : "⚫ ئۆفلاین"}</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="openChatWith('${fUid}', '${fu.name.replace(/'/g,"")}')">💬 چات</button>
        </div>
      `);
    }
    box.innerHTML = items.join("");
  });

  loadChatStream();
}

function loadChatStream() {
  if (chatUnsub) chatUnsub();
  const box = $("chatMessagesBox");
  box.innerHTML = "";
  let path = "globalChat";
  if (state.chatMode === "private" && state.activeChatUid) {
    const pair = [state.currentUser.uid, state.activeChatUid].sort().join("_");
    path = `chats/${pair}`;
  } else if (state.chatMode === "private") {
    box.innerHTML = `<p style="color:var(--muted); font-size:13px; text-align:center; margin-top:40px;">کلیک لە دوگمەی 💬 چات بکە لە تەنیشت یەکێک لە هاوڕێکانت</p>`;
    return;
  }

  chatUnsub = onChildAdded(ref(db, path), (snap) => {
    const m = snap.val();
    if (!m) return;
    const div = document.createElement("div");
    div.className = "chat-msg" + (m.uid === state.currentUser.uid ? " mine" : "");
    div.innerHTML = `<div style="font-size:11px; color:var(--primary); font-weight:700;">${m.name}</div><div>${m.text}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  });
}

// Photo upload compressed to Base64
window.handlePhotoUpload = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement("canvas");
      c.width = 160; c.height = 160;
      const cx = c.getContext("2d");
      const min = Math.min(img.width, img.height);
      cx.drawImage(img, (img.width - min)/2, (img.height - min)/2, min, min, 0, 0, 160, 160);
      state.userProfile.photoData = c.toDataURL("image/jpeg", 0.72);
      await saveProfile();
      refreshProfileUI();
      showToast("وێنەی پڕۆفایلەکەت دانرا!");
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
};

window.clearCustomPhoto = async () => {
  state.userProfile.photoData = "";
  await saveProfile();
  refreshProfileUI();
  showToast("وێنەکە لابرا");
};

window.saveAccountDetails = async () => {
  const name = $("newNameInput").value.trim();
  if (name.length < 2) return showToast("ناو دەبێت لانیکەم ٢ پیت بێت");
  state.userProfile.name = name;
  state.userProfile.birthdate = $("profBirthdate").value;
  state.userProfile.bio = $("profBio").value.trim();
  if (state.currentUser) {
    await updateProfile(state.currentUser, { displayName: name });
    await saveProfile();
  }
  refreshProfileUI();
  showToast("زانیارییەکانی پڕۆفایل پاشەکەوت کران!");
};

window.buyXpBoost = async () => {
  if (state.userProfile.coins < 100) return showToast("پارەی پێویستت نییە (100 🪙)");
  state.userProfile.coins -= 100;
  state.userProfile.xpBoostMatches = (state.userProfile.xpBoostMatches || 0) + 3;
  await saveProfile();
  refreshProfileUI();
  showToast("بۆستی 2x XP بۆ ٣ یاری چالاککرا!");
};

window.buyUpgrade = async (type) => {
  const costs = { hp: 120, speed: 120, dmg: 150 };
  const upg = state.userProfile.upgrades || { hp: 0, speed: 0, dmg: 0 };
  if (upg[type] >= 5) return showToast("گەیشتوویتەتە کۆتا ئاست!");
  if (state.userProfile.coins < costs[type]) return showToast("پارەی پێویستت نییە!");
  state.userProfile.coins -= costs[type];
  upg[type]++;
  state.userProfile.upgrades = upg;
  await saveProfile();
  refreshProfileUI();
  showToast("ئەکاونتەکەت بەرزکرایەوە!");
};

window.sendFriendRequest = async () => {
  const code = $("addFriendCodeInput").value.trim().toUpperCase().replace("#", "");
  if (code.length < 4) return showToast("کۆدی هاوڕێ بنووسە");
  if (code === state.userProfile.friendCode) return showToast("ناتوانیت خۆت زیاد بکەیت!");
  const snap = await get(ref(db, `friendCodes/${code}`));
  if (!snap.exists()) return showToast("هیچ یاریزانێک بەم کۆدە نەدۆزرایەوە");
  const targetUid = snap.val().uid;
  await set(ref(db, `friendRequests/${targetUid}/${state.currentUser.uid}`), {
    fromUid: state.currentUser.uid,
    fromName: state.userProfile.name,
    fromAvatar: state.userProfile.avatar || "🥷",
    ts: Date.now()
  });
  $("addFriendCodeInput").value = "";
  showToast("داواکاری هاوڕێیەتی نێردرا!");
};

window.respondFriendReq = async (fromUid, accept) => {
  const myUid = state.currentUser.uid;
  if (accept) {
    await set(ref(db, `friends/${myUid}/${fromUid}`), true);
    await set(ref(db, `friends/${fromUid}/${myUid}`), true);
    showToast("ئێستا بوون بە هاوڕێ!");
  }
  await remove(ref(db, `friendRequests/${myUid}/${fromUid}`));
};

window.switchChatMode = (mode) => {
  state.chatMode = mode;
  $("chatTabGlobal").classList.toggle("active", mode === "global");
  $("chatTabPrivate").classList.toggle("active", mode === "private");
  if (mode === "global") $("chatHeaderInfo").textContent = "چاتی گشتی هۆڵی Kurdish Arena";
  loadChatStream();
};

window.openChatWith = (uid, name) => {
  state.activeChatUid = uid;
  $("chatHeaderInfo").textContent = `چاتی تایبەت لەگەڵ: ${name}`;
  window.switchChatMode("private");
};

window.sendActiveChat = async () => {
  const txt = $("chatInput").value.trim();
  if (!txt) return;
  let path = "globalChat";
  if (state.chatMode === "private") {
    if (!state.activeChatUid) return showToast("سەرەتا هاوڕێیەک هەڵبژێرە");
    path = `chats/${[state.currentUser.uid, state.activeChatUid].sort().join("_")}`;
  }
  $("chatInput").value = "";
  playSfx("click");
  await push(ref(db, path), { uid: state.currentUser.uid, name: state.userProfile.name, text: txt, ts: Date.now() });
};

window.updateSetting = (key, val) => {
  state.settings[key] = val;
  localStorage.setItem("ka_settings", JSON.stringify(state.settings));
  showToast("ڕێکخستن پاشەکەوت کرا");
};

window.setThemeColor = (hex) => {
  state.settings.theme = hex;
  localStorage.setItem("ka_settings", JSON.stringify(state.settings));
  applySettingsUI();
  playSfx("click");
};