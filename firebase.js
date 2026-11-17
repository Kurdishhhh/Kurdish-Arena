import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-analytics.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, push, remove, onValue, onChildAdded, onDisconnect
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDL_f3T5XRIxv6wi_mcmYKmYH8R2vdca3Q",
  authDomain: "kurdish-arena.firebaseapp.com",
  databaseURL: "https://kurdish-arena-default-rtdb.firebaseio.com",
  projectId: "kurdish-arena",
  storageBucket: "kurdish-arena.firebasestorage.app",
  messagingSenderId: "1052204401943",
  appId: "1:1052204401943:web:17683388963c431e80e352",
  measurementId: "G-H3E5TQ2WQK"
};

export const app = initializeApp(firebaseConfig);
try { if (location.protocol.startsWith("http")) getAnalytics(app); } catch {}
export const auth = getAuth(app);
export const db = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();

export {
  ref, set, get, update, push, remove, onValue, onChildAdded, onDisconnect,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, updateProfile
};

export const AVATARS = ["🥷", "🤖", "🦁", "🐺", "🦊", "🐉", "👾", "⚡"];
export const COLORS = ["#00f5d4", "#ff4d6d", "#ffd166", "#4cc9f0", "#f72585", "#aacc00", "#fb8500", "#c77dff", "#80ed99", "#ff9f1c"];

export const state = {
  currentUser: null,
  userProfile: {
    name: "یاریزان", level: 1, xp: 0, coins: 250, wins: 0, kills: 0, matches: 0,
    avatar: "🥷", photoData: "", birthdate: "", bio: "", joinDate: new Date().toISOString().slice(0,10),
    friendCode: "", xpBoostMatches: 0, upgrades: { hp: 0, speed: 0, dmg: 0 }
  },
  settings: JSON.parse(localStorage.getItem("ka_settings") || '{"sound":true,"shadows":true,"theme":"#00f5d4"}'),
  currentRoomId: null,
  isRoomHost: false,
  activeChatUid: null,
  chatMode: "global"
};

export const $ = (id) => document.getElementById(id);
export const xpNeeded = (lvl) => lvl * 120;

export function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
}

let audioCtx = null;
export function playSfx(type = "click") {
  if (!state.settings.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (type === "click") {
      osc.frequency.setValueAtTime(520, now); osc.frequency.exponentialRampToValueAtTime(280, now + 0.05);
      gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now); osc.stop(now + 0.05);
    } else if (type === "shoot") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(340, now); osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
      gain.gain.setValueAtTime(0.07, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now); osc.stop(now + 0.08);
    } else if (type === "win") {
      osc.frequency.setValueAtTime(440, now); osc.frequency.setValueAtTime(660, now + 0.12);
      gain.gain.setValueAtTime(0.09, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now); osc.stop(now + 0.35);
    }
  } catch {}
}

export async function saveProfile() {
  if (!state.currentUser) return;
  await update(ref(db, `users/${state.currentUser.uid}`), state.userProfile);
}

export function renderAvatarEl(el, profile) {
  if (profile?.photoData) {
    el.innerHTML = `<img src="${profile.photoData}" alt="avatar" />`;
  } else {
    el.textContent = profile?.avatar || "🥷";
  }
}