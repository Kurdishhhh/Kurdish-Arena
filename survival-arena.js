import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
import { db, ref, set, update, push, remove, onValue, onChildAdded, COLORS, state, $, xpNeeded, saveProfile, playSfx } from "../firebase.js";
import { refreshProfileUI } from "../profile-friends.js";

const WORLD_SIZE = 1800, SCALE = 0.05;
const to3D = (x, y) => ({ x: (x - 900) * SCALE, z: (y - 900) * SCALE });
const OBSTACLES = [
  {x:450,y:450,w:120,h:120},{x:1230,y:450,w:120,h:120},{x:450,y:1230,w:120,h:120},{x:1230,y:1230,w:120,h:120},
  {x:840,y:580,w:120,h:60},{x:840,y:1160,w:120,h:60},{x:580,y:840,w:60,h:120},{x:1160,y:840,w:60,h:120},{x:860,y:860,w:80,h:80}
];

let threeCtx = null, game = null, animFrame = null, gameListeners = [];
const mmCtx = $("minimapCanvas").getContext("2d");
const keys = {}, mouse = { ndcX: 0, ndcY: 0, down: false };
const touchMove = { active: false, id: null, vx: 0, vy: 0 }, touchAim = { active: false, id: null, vx: 0, vy: 0 };

window.addEventListener("keydown", e => { keys[e.key.toLowerCase()] = true; if (e.code === "Space" && game) triggerDash(); });
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);
window.addEventListener("mousemove", e => { mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1; mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1; });
$("threeContainer").addEventListener("mousedown", () => mouse.down = true);
window.addEventListener("mouseup", () => mouse.down = false);

function setupJoystick(baseId, knobId, obj) {
  const base = $(baseId), knob = $(knobId), maxR = 40;
  const upd = (t) => {
    const r = base.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width/2), dy = t.clientY - (r.top + r.height/2);
    const d = Math.hypot(dx, dy);
    if (d > maxR) { dx = (dx/d)*maxR; dy = (dy/d)*maxR; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    obj.vx = dx/maxR; obj.vy = dy/maxR;
  };
  base.addEventListener("touchstart", e => { e.preventDefault(); if (obj.id===null) { obj.id=e.changedTouches[0].identifier; obj.active=true; upd(e.changedTouches[0]); } }, {passive:false});
  base.addEventListener("touchmove", e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier===obj.id) upd(t); }, {passive:false});
  const end = e => { for (const t of e.changedTouches) if (t.identifier===obj.id) { obj.id=null; obj.active=false; obj.vx=0; obj.vy=0; knob.style.transform="translate(-50%,-50%)"; } };
  base.addEventListener("touchend", end); base.addEventListener("touchcancel", end);
}
setupJoystick("moveJoyBase", "moveJoyKnob", touchMove);
setupJoystick("aimJoyBase", "aimJoyKnob", touchAim);
$("dashBtn").addEventListener("touchstart", e => { e.preventDefault(); if (game) triggerDash(); }, {passive:false});

function triggerDash() {
  if (!game?.me?.alive) return;
  const now = Date.now();
  if (now < game.me.dashCdUntil) return;
  game.me.dashCdUntil = now + 2600; game.me.dashUntil = now + 190;
  if (threeCtx) threeCtx.shake = 0.25;
}

function initThree() {
  $("threeContainer").innerHTML = ""; $("labelsLayer").innerHTML = "";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050811);
  scene.fog = new THREE.FogExp2(0x050811, 0.011);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 220);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = state.settings.shadows !== false;
  $("threeContainer").appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xa5b4fc, 0x090d16, 0.95));
  const dl = new THREE.DirectionalLight(0xffffff, 1.1);
  dl.position.set(25, 45, 20); dl.castShadow = renderer.shadowMap.enabled;
  dl.shadow.mapSize.set(1024, 1024);
  dl.shadow.camera.left = -52; dl.shadow.camera.right = 52; dl.shadow.camera.top = 52; dl.shadow.camera.bottom = -52;
  scene.add(dl);

  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const cx = c.getContext("2d"); cx.fillStyle = "#0e1526"; cx.fillRect(0,0,256,256);
  cx.strokeStyle = "rgba(67,97,238,0.28)"; cx.lineWidth = 3; cx.strokeRect(0,0,256,256);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(22,22);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90,90), new THREE.MeshStandardMaterial({map:tex, roughness:0.75}));
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);

  const wMat = new THREE.MeshStandardMaterial({color:0x16213e, emissive:0x4361ee, emissiveIntensity:0.45});
  [[90,2,1.2,0,1,-45.5],[90,2,1.2,0,1,45.5],[1.2,2,90,-45.5,1,0],[1.2,2,90,45.5,1,0]].forEach(([w,h,d,x,y,z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wMat); m.position.set(x,y,z); scene.add(m);
  });

  const oMat = new THREE.MeshStandardMaterial({color:0x1e293b, roughness:0.45, metalness:0.65});
  const tMat = new THREE.MeshBasicMaterial({color:0x00f5d4});
  OBSTACLES.forEach(o => {
    const w = o.w*SCALE, d = o.h*SCALE, h = 2.6, pos = to3D(o.x+o.w/2, o.y+o.h/2);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), oMat);
    box.position.set(pos.x, h/2, pos.z); box.castShadow = true; box.receiveShadow = true; scene.add(box);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w+0.08,0.14,d+0.08), tMat);
    trim.position.set(pos.x, h-0.1, pos.z); scene.add(trim);
  });

  const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1,1,14,56,1,true), new THREE.MeshBasicMaterial({color:0xff2a55, transparent:true, opacity:0.25, side:THREE.DoubleSide, depthWrite:false}));
  zoneWall.position.y = 7; scene.add(zoneWall);
  const zoneRing = new THREE.Mesh(new THREE.RingGeometry(0.985,1.015,64), new THREE.MeshBasicMaterial({color:0xff4d6d, side:THREE.DoubleSide}));
  zoneRing.rotation.x = -Math.PI/2; zoneRing.position.y = 0.05; scene.add(zoneRing);

  threeCtx = { scene, camera, renderer, zoneWall, zoneRing, playerMeshes:{}, bulletMeshes:{}, pickupMeshes:{}, labels:{}, raycaster:new THREE.Raycaster(), aimPlane:new THREE.Plane(new THREE.Vector3(0,1,0),-0.9), shake:0 };
}

window.addEventListener("resize", () => {
  if (!threeCtx) return;
  threeCtx.camera.aspect = window.innerWidth / window.innerHeight;
  threeCtx.camera.updateProjectionMatrix();
  threeCtx.renderer.setSize(window.innerWidth, window.innerHeight);
});

function createPlayer3D(p, isMe) {
  const g = new THREE.Group(), col = new THREE.Color(p.color || "#00f5d4");
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9,1.15,28), new THREE.MeshBasicMaterial({color: isMe?0x00f5d4:col, side:THREE.DoubleSide}));
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.04; g.add(ring);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.72,1.15,14), new THREE.MeshStandardMaterial({color:col, roughness:0.35, metalness:0.5}));
  body.position.y = 0.62; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45,14,14), new THREE.MeshStandardMaterial({color:0x0f172a, roughness:0.25, metalness:0.8}));
  head.position.y = 1.48; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32,0.18,0.56), new THREE.MeshBasicMaterial({color: isMe?0x00f5d4:0xffffff}));
  visor.position.set(0.32, 1.5, 0); g.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.95,0.22,0.22), new THREE.MeshStandardMaterial({color:0x334155, metalness:0.85}));
  gun.position.set(0.68, 0.92, 0.25); g.add(gun);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.3,16,16), new THREE.MeshBasicMaterial({color:0x38bdf8, transparent:true, opacity:0.25, wireframe:true}));
  shield.position.y = 1; shield.visible = false; g.add(shield);
  g.userData.shield = shield; threeCtx.scene.add(g);

  const lbl = document.createElement("div"); lbl.className = "p3d-label";
  lbl.innerHTML = `<div class="p3d-name">${p.avatar||"🥷"} ${p.name}</div><div class="p3d-bar"><div class="p3d-bar-fill" style="width:100%"></div></div>`;
  $("labelsLayer").appendChild(lbl); threeCtx.labels[p.uid] = lbl;
  return g;
}

function resolveWalls(ent, r = 20) {
  ent.x = Math.max(r, Math.min(WORLD_SIZE-r, ent.x)); ent.y = Math.max(r, Math.min(WORLD_SIZE-r, ent.y));
  OBSTACLES.forEach(o => {
    const cx = Math.max(o.x, Math.min(ent.x, o.x+o.w)), cy = Math.max(o.y, Math.min(ent.y, o.y+o.h));
    if (Math.hypot(ent.x-cx, ent.y-cy) < r) {
      const ox = (o.w/2+r) - Math.abs(ent.x-(o.x+o.w/2)), oy = (o.h/2+r) - Math.abs(ent.y-(o.y+o.h/2));
      if (ox < oy) ent.x += ent.x > o.x+o.w/2 ? ox : -ox; else ent.y += ent.y > o.y+o.h/2 ? oy : -oy;
    }
  });
}

function spawnParticles(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = Math.random()*Math.PI*2, sp = 50 + Math.random()*140;
    const pt = {x, y, zh:0.9, vz:3+Math.random()*4, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:0.45};
    if (threeCtx) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.2,0.2), new THREE.MeshBasicMaterial({color}));
      const p3 = to3D(x,y); m.position.set(p3.x, 0.9, p3.z); threeCtx.scene.add(m); pt.mesh = m;
    }
    game.particles.push(pt);
  }
}

function spawnPickups() {
  const types = ["hp","shield","rapid","speed"];
  return Array.from({length:14}, (_,i) => ({id:"pk_"+i+"_"+Math.random().toString(36).slice(2,5), x:220+Math.random()*(WORLD_SIZE-440), y:220+Math.random()*(WORLD_SIZE-440), type:types[i%4]}));
}

export function startAiArena(botCount, diff, isQuickGuest) {
  $("gameScreen").classList.remove("hidden"); $("killFeed").innerHTML = ""; $("spectatorBanner").classList.add("hidden");
  initThree();
  const upg = state.userProfile.upgrades || {hp:0,speed:0,dmg:0}, myMaxHp = 100 + upg.hp*10, total = botCount+1;
  const players = { me_local: { uid:"me_local", name:state.userProfile.name||"تۆ", avatar:state.userProfile.avatar||"🥷", color:"#00f5d4", x:1420, y:900, hp:myMaxHp, maxHp:myMaxHp, shield:0, alive:true, kills:0, angle:0, speedMult:1+upg.speed*0.05, dmgMult:1+upg.dmg*0.06, dashCdUntil:0, dashUntil:0, rapidUntil:0, speedUntil:0, isBot:false } };
  const dm = diff==="easy"?0.65:diff==="hard"?1.15:0.9;
  for (let i=1; i<=botCount; i++) {
    const a = (i/total)*Math.PI*2;
    players["ai_"+i] = { uid:"ai_"+i, name:`بۆتی_${i}`, avatar:"🤖", color:COLORS[i%COLORS.length], x:900+Math.cos(a)*560, y:900+Math.sin(a)*560, hp:100, maxHp:100, shield:0, alive:true, kills:0, angle:0, speedMult:dm, dmgMult:dm, fireRate:diff==="hard"?360:520, lastShot:0, isBot:true, aiDirX:0, aiDirY:0, aiChangeAt:0 };
  }
  game = { mode:"ai", isQuickGuest, myUid:"me_local", me:players.me_local, players, bullets:[], pickups:spawnPickups(), particles:[], zone:{x:900,y:900,radius:980}, lastTime:performance.now(), lastShot:0, ended:false };
  loopGame();
}

export function startOnlineArena(roomId, roomData) {
  $("gameScreen").classList.remove("hidden"); $("killFeed").innerHTML = ""; $("spectatorBanner").classList.add("hidden");
  initThree();
  const players = {};
  Object.entries(roomData.players || {}).forEach(([uid, p]) => { players[uid] = {...p, tx:p.x, ty:p.y, dashCdUntil:0, dashUntil:0, rapidUntil:0, speedUntil:0, lastShot:0}; });
  game = { mode:"online", roomId, isHost:roomData.hostUid===state.currentUser.uid, myUid:state.currentUser.uid, me:players[state.currentUser.uid], players, bullets:[], pickups:spawnPickups(), particles:[], zone:roomData.zone||{x:900,y:900,radius:950}, lastTime:performance.now(), lastShot:0, lastSync:0, ended:false };

  gameListeners.push(onValue(ref(db, `rooms/${roomId}/players`), snap => {
    if (!game || !snap.exists()) return;
    const data = snap.val();
    Object.keys(game.players).forEach(uid => { if (!data[uid] && uid !== game.myUid) game.players[uid].alive = false; });
    Object.entries(data).forEach(([uid, p]) => {
      if (uid === game.myUid || (game.isHost && p.isBot)) return;
      if (!game.players[uid]) game.players[uid] = {...p, tx:p.x, ty:p.y};
      else Object.assign(game.players[uid], {tx:p.x, ty:p.y, angle:p.angle, hp:p.hp, shield:p.shield||0, alive:p.alive, kills:p.kills||0});
    });
  }));
  gameListeners.push(onChildAdded(ref(db, `rooms/${roomId}/shots`), snap => {
    const s = snap.val();
    if (game && s && s.owner !== game.myUid && Date.now()-s.ts < 2000) game.bullets.push({...s});
  }));
  gameListeners.push(onValue(ref(db, `rooms/${roomId}`), snap => {
    const r = snap.val();
    if (!game || !r) return;
    if (r.zone && !game.isHost) game.zone = r.zone;
    if (r.status === "finished" && !game.ended) finishMatch(r.winner);
  }));
  gameListeners.push(onChildAdded(ref(db, `rooms/${roomId}/killFeed`), snap => {
    const k = snap.val();
    if (k) {
      const div = document.createElement("div"); div.className = "kill-msg"; div.textContent = k.text;
      $("killFeed").prepend(div); setTimeout(() => div.remove(), 4500);
      if (k.killerUid === game?.myUid) { game.me.kills++; update(ref(db, `rooms/${roomId}/players/${game.myUid}`), {kills: game.me.kills}); }
    }
  }));
  loopGame();
}

function shootBullet(sh, ang) {
  if (sh.uid === game.myUid) playSfx("shoot");
  const b = {
    id:"b_"+Math.random().toString(36).slice(2,9), owner:sh.uid, x:sh.x+Math.cos(ang)*26, y:sh.y+Math.sin(ang)*26,
    vx:Math.cos(ang)*680, vy:Math.sin(ang)*680, dmg:Math.round(20*(sh.dmgMult||1)*(Date.now()<(sh.rapidUntil||0)?1.25:1)),
    color:sh.color||"#00f5d4", ts:Date.now(), life:1.4
  };
  game.bullets.push(b);
  if (game.mode === "online" && (sh.uid === game.myUid || (game.isHost && sh.isBot))) {
    const sr = push(ref(db, `rooms/${game.roomId}/shots`)); set(sr, b); setTimeout(() => remove(sr), 1500);
  }
}

function applyDamage(target, dmg, attackerUid) {
  if (!target.alive) return;
  if (target.shield > 0) { const abs = Math.min(target.shield, dmg); target.shield -= abs; dmg -= abs; }
  target.hp -= dmg; spawnParticles(target.x, target.y, "#ff4d6d", 5);
  if (target.uid === game.myUid && threeCtx) threeCtx.shake = 0.2;
  if (target.hp <= 0) {
    target.hp = 0; target.alive = false; spawnParticles(target.x, target.y, target.color||"#ff4d6d", 16);
    const msg = `${game.players[attackerUid]?.name || "بازنەی مەترسی"} 🔫 ${target.name}`;
    if (game.mode === "ai") {
      const div = document.createElement("div"); div.className = "kill-msg"; div.textContent = msg;
      $("killFeed").prepend(div); setTimeout(() => div.remove(), 4500);
      if (game.players[attackerUid]) game.players[attackerUid].kills++;
    } else push(ref(db, `rooms/${game.roomId}/killFeed`), {text:msg, killerUid:attackerUid, ts:Date.now()});
  }
}

function loopGame() {
  if (!game) return;
  const now = performance.now(), dt = Math.min(0.05, (now - game.lastTime)/1000);
  game.lastTime = now;
  updateGame(dt, Date.now());
  render3D(now * 0.001);
  if (!game.ended) animFrame = requestAnimationFrame(loopGame);
}

function updateGame(dt, now) {
  const me = game.me;
  if (me?.alive) {
    let mx=0, my=0;
    if (keys["w"]||keys["arrowup"]) my-=1; if (keys["s"]||keys["arrowdown"]) my+=1;
    if (keys["a"]||keys["arrowleft"]) mx-=1; if (keys["d"]||keys["arrowright"]) mx+=1;
    if (touchMove.active) { mx = touchMove.vx; my = touchMove.vy; }
    const mag = Math.hypot(mx, my);
    if (mag > 0.1) {
      mx /= Math.max(1, mag); my /= Math.max(1, mag);
      let sp = 235 * (me.speedMult||1) * (now<me.speedUntil?1.38:1) * (now<me.dashUntil?2.6:1);
      me.x += mx*sp*dt; me.y += my*sp*dt; resolveWalls(me);
    }

    let shoot = false;
    if (touchAim.active && Math.hypot(touchAim.vx, touchAim.vy) > 0.2) { me.angle = Math.atan2(touchAim.vy, touchAim.vx); shoot = true; }
    else if (mouse.down && threeCtx) {
      threeCtx.raycaster.setFromCamera({x:mouse.ndcX, y:mouse.ndcY}, threeCtx.camera);
      const hit = new THREE.Vector3();
      if (threeCtx.raycaster.ray.intersectPlane(threeCtx.aimPlane, hit)) { const m3 = to3D(me.x, me.y); me.angle = Math.atan2(hit.z-m3.z, hit.x-m3.x); }
      shoot = true;
    } else if (mag > 0.1) me.angle = Math.atan2(my, mx);

    if (shoot && now - game.lastShot > (now<me.rapidUntil?170:300)) { game.lastShot = now; shootBullet(me, me.angle); }

    if (Math.hypot(me.x-game.zone.x, me.y-game.zone.y) > game.zone.radius) {
      $("hudZoneMsg").textContent = "⚠️ لە دەرەوەی بازنەی!"; applyDamage(me, 11*dt, "zone");
    } else $("hudZoneMsg").textContent = "";

    for (let i=game.pickups.length-1; i>=0; i--) {
      const pk = game.pickups[i];
      if (Math.hypot(me.x-pk.x, me.y-pk.y) < 34) {
        if (pk.type==="hp") me.hp = Math.min(me.maxHp, me.hp+35);
        if (pk.type==="shield") me.shield = Math.min(60, (me.shield||0)+30);
        if (pk.type==="rapid") me.rapidUntil = now+7000;
        if (pk.type==="speed") me.speedUntil = now+7000;
        spawnParticles(pk.x, pk.y, "#ffd166", 10);
        if (threeCtx?.pickupMeshes[pk.id]) { threeCtx.scene.remove(threeCtx.pickupMeshes[pk.id]); delete threeCtx.pickupMeshes[pk.id]; }
        game.pickups.splice(i, 1);
        const types = ["hp","shield","rapid","speed"];
        game.pickups.push({id:"pk_"+Date.now(), x:240+Math.random()*(WORLD_SIZE-480), y:240+Math.random()*(WORLD_SIZE-480), type:types[Math.floor(Math.random()*4)]});
      }
    }
  } else if (me && !me.alive) $("spectatorBanner").classList.remove("hidden");

  if (game.mode === "ai" || game.isHost) {
    if (game.zone.radius > 160) game.zone.radius -= 11*dt;
    Object.values(game.players).forEach(b => {
      if (!b.isBot || !b.alive) return;
      const dist = Math.hypot(b.x-game.zone.x, b.y-game.zone.y);
      let mx=0, my=0;
      if (dist > game.zone.radius-70) { const a=Math.atan2(game.zone.y-b.y, game.zone.x-b.x); mx=Math.cos(a); my=Math.sin(a); }
      else {
        if (now > (b.aiChangeAt||0)) { const a=Math.random()*Math.PI*2; b.aiDirX=Math.cos(a); b.aiDirY=Math.sin(a); b.aiChangeAt=now+1000+Math.random()*1000; }
        mx = b.aiDirX; my = b.aiDirY;
      }
      b.x += mx*195*(b.speedMult||1)*dt; b.y += my*195*(b.speedMult||1)*dt; resolveWalls(b);
      let near = null, minD = 540;
      Object.values(game.players).forEach(o => { if (o.uid!==b.uid && o.alive) { const d=Math.hypot(o.x-b.x, o.y-b.y); if (d<minD) {minD=d; near=o;} } });
      if (near) { b.angle=Math.atan2(near.y-b.y, near.x-b.x); if (now-(b.lastShot||0)>(b.fireRate||500)) { b.lastShot=now; shootBullet(b, b.angle+(Math.random()-0.5)*0.16); } }
      else b.angle = Math.atan2(my, mx);
      if (dist > game.zone.radius) applyDamage(b, 11*dt, "zone");
    });
  }

  if (game.mode === "online") {
    Object.values(game.players).forEach(p => { if (p.uid!==game.myUid && !(game.isHost&&p.isBot) && p.tx!==undefined) { p.x+=(p.tx-p.x)*0.25; p.y+=(p.ty-p.y)*0.25; } });
    if (now - game.lastSync > 70) {
      game.lastSync = now;
      update(ref(db, `rooms/${game.roomId}/players/${game.myUid}`), { x:Math.round(me.x), y:Math.round(me.y), angle:+me.angle.toFixed(2), hp:Math.round(me.hp), shield:Math.round(me.shield||0), alive:me.alive });
      if (game.isHost) {
        const hu = {"zone/radius": Math.round(game.zone.radius)};
        Object.values(game.players).forEach(p => { if (p.isBot) { hu[`players/${p.uid}/x`]=Math.round(p.x); hu[`players/${p.uid}/y`]=Math.round(p.y); hu[`players/${p.uid}/angle`]=+p.angle.toFixed(2); hu[`players/${p.uid}/hp`]=Math.round(p.hp); hu[`players/${p.uid}/alive`]=p.alive; } });
        update(ref(db, `rooms/${game.roomId}`), hu);
      }
    }
  }

  for (let i=game.bullets.length-1; i>=0; i--) {
    const b = game.bullets[i]; b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
    let hw = b.x<0 || b.x>WORLD_SIZE || b.y<0 || b.y>WORLD_SIZE;
    if (!hw) for (const o of OBSTACLES) if (b.x>o.x && b.x<o.x+o.w && b.y>o.y && b.y<o.y+o.h) { hw=true; break; }
    let hit = false;
    if (!hw && b.life > 0) Object.values(game.players).forEach(p => {
      if (!hit && p.alive && p.uid!==b.owner && Math.hypot(p.x-b.x, p.y-b.y)<23) {
        hit = true;
        if (game.mode==="ai" || p.uid===game.myUid || (game.isHost&&p.isBot)) applyDamage(p, b.dmg, b.owner);
      }
    });
    if (hw || hit || b.life<=0) {
      spawnParticles(b.x, b.y, b.color, 4);
      if (threeCtx?.bulletMeshes[b.id]) { threeCtx.scene.remove(threeCtx.bulletMeshes[b.id]); delete threeCtx.bulletMeshes[b.id]; }
      game.bullets.splice(i, 1);
    }
  }

  for (let i=game.particles.length-1; i>=0; i--) {
    const pt = game.particles[i]; pt.x+=pt.vx*dt; pt.y+=pt.vy*dt; pt.zh+=pt.vz*dt; pt.vz-=14*dt; pt.life-=dt;
    if (pt.mesh) { const p3=to3D(pt.x,pt.y); pt.mesh.position.set(p3.x, Math.max(0.1,pt.zh), p3.z); pt.mesh.scale.setScalar(Math.max(0.01,pt.life*2)); }
    if (pt.life<=0) { if (pt.mesh&&threeCtx) threeCtx.scene.remove(pt.mesh); game.particles.splice(i,1); }
  }

  const alive = Object.values(game.players).filter(p => p.alive);
  $("hudAlive").textContent = alive.length; $("hudKills").textContent = me?.kills||0;
  $("hudHpText").textContent = Math.ceil(me?.hp||0); $("hudShieldText").textContent = Math.ceil(me?.shield||0);
  $("hudHpBar").style.width = Math.max(0,((me?.hp||0)/(me?.maxHp||100))*100)+"%";
  $("hudShieldBar").style.width = Math.min(100,((me?.shield||0)/60)*100)+"%";
  $("hudBuffs").textContent = [now<(me?.rapidUntil||0)?"⚡ خێرا تەقە":"", now<(me?.speedUntil||0)?"👟 خێرایی":""].filter(Boolean).join(" • ");

  if (!game.ended && alive.length <= 1) {
    const win = alive[0] || {uid:"none", name:"کەس نەمایەوە"};
    if (game.mode==="ai") finishMatch(win);
    else if (game.isHost) { game.ended=true; update(ref(db, `rooms/${game.roomId}`), {status:"finished", winner:{uid:win.uid, name:win.name}}); }
  }
}

function render3D(tSec) {
  if (!threeCtx || !game) return;
  const { scene, camera, renderer, zoneWall, zoneRing } = threeCtx;
  const z3 = to3D(game.zone.x, game.zone.y), r3 = Math.max(0.5, game.zone.radius*SCALE);
  zoneWall.position.set(z3.x, 7, z3.z); zoneWall.scale.set(r3, 1, r3);
  zoneRing.position.set(z3.x, 0.05, z3.z); zoneRing.scale.set(r3, r3, 1);

  const pkColors = {hp:0xff4d6d, shield:0x38bdf8, rapid:0xffd166, speed:0x4ade80};
  game.pickups.forEach(pk => {
    if (!threeCtx.pickupMeshes[pk.id]) {
      const col = pkColors[pk.type]||0xffffff;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.48), new THREE.MeshStandardMaterial({color:col, emissive:col, emissiveIntensity:0.65}));
      const p3 = to3D(pk.x, pk.y); m.position.set(p3.x, 0.8, p3.z); scene.add(m); threeCtx.pickupMeshes[pk.id] = m;
    }
    threeCtx.pickupMeshes[pk.id].rotation.y = tSec*2.2;
    threeCtx.pickupMeshes[pk.id].position.y = 0.75 + Math.sin(tSec*3.5)*0.2;
  });

  game.bullets.forEach(b => {
    if (!threeCtx.bulletMeshes[b.id]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.9,8), new THREE.MeshBasicMaterial({color:b.color||"#00f5d4"}));
      m.rotation.z = Math.PI/2; const g = new THREE.Group(); g.add(m); scene.add(g); threeCtx.bulletMeshes[b.id] = g;
    }
    const bm = threeCtx.bulletMeshes[b.id], b3 = to3D(b.x, b.y);
    bm.position.set(b3.x, 0.95, b3.z); bm.rotation.y = -Math.atan2(b.vy, b.vx);
  });

  let camT = game.me?.alive ? game.me : Object.values(game.players).find(p => p.alive);
  if (camT) {
    const c3 = to3D(camT.x, camT.y);
    let sx=0, sz=0;
    if (threeCtx.shake>0) { sx=(Math.random()-0.5)*threeCtx.shake*2; sz=(Math.random()-0.5)*threeCtx.shake*2; threeCtx.shake=Math.max(0, threeCtx.shake-0.02); }
    camera.position.lerp(new THREE.Vector3(c3.x+sx, 22, c3.z+18+sz), 0.14);
    camera.lookAt(c3.x, 0.8, c3.z);
  }

  const W = window.innerWidth, H = window.innerHeight;
  Object.values(game.players).forEach(p => {
    if (!threeCtx.playerMeshes[p.uid]) threeCtx.playerMeshes[p.uid] = createPlayer3D(p, p.uid===game.myUid);
    const pm = threeCtx.playerMeshes[p.uid], lbl = threeCtx.labels[p.uid];
    if (!p.alive) { pm.visible = false; if (lbl) lbl.style.display="none"; return; }
    pm.visible = true; const p3 = to3D(p.x, p.y);
    pm.position.set(p3.x, 0, p3.z); pm.rotation.y = -(p.angle||0);
    pm.userData.shield.visible = (p.shield||0) > 0;
    if (lbl) {
      const proj = new THREE.Vector3(p3.x, 2.55, p3.z).project(camera);
      if (proj.z < 1) {
        lbl.style.display = "block";
        lbl.style.transform = `translate(${(proj.x*0.5+0.5)*W}px, ${(-proj.y*0.5+0.5)*H}px) translate(-50%, -100%)`;
        lbl.querySelector(".p3d-bar-fill").style.width = Math.max(0, (p.hp/(p.maxHp||100))*100)+"%";
      } else lbl.style.display = "none";
    }
  });

  renderer.render(scene, camera);

  mmCtx.clearRect(0,0,96,96); const s = 96/WORLD_SIZE;
  mmCtx.beginPath(); mmCtx.arc(game.zone.x*s, game.zone.y*s, game.zone.radius*s, 0, Math.PI*2);
  mmCtx.strokeStyle="#ff4d6d"; mmCtx.lineWidth=1.5; mmCtx.stroke();
  Object.values(game.players).forEach(p => { if (p.alive) { mmCtx.fillStyle = p.uid===game.myUid?"#00f5d4":"#ff4d6d"; mmCtx.fillRect(p.x*s-2, p.y*s-2, 4, 4); } });
}

async function finishMatch(winner) {
  if (!game || game.ended) return;
  game.ended = true; cancelAnimationFrame(animFrame);
  const won = winner?.uid === game.myUid, kills = game.me?.kills || 0;
  if (won) playSfx("win");
  const mult = state.userProfile.xpBoostMatches > 0 ? 2 : 1;
  const earnedXp = ((won?80:25) + kills*20) * mult, earnedCoins = (won?70:20) + kills*15;

  $("endTitle").textContent = won ? "🏆 پیرۆزە! تۆ براوە بوویت!" : "⚔️ یاری کۆتایی هات";
  $("endWinnerText").textContent = `براوەی گۆڕەپان: ${winner?.name || "-"}`;
  $("endKills").textContent = kills; $("endXp").textContent = `+${earnedXp}`; $("endCoins").textContent = `+${earnedCoins}`;
  $("matchEndModal").classList.remove("hidden");

  if (!game.isQuickGuest) {
    const p = state.userProfile;
    p.xp += earnedXp; p.coins += earnedCoins; p.kills += kills; p.matches += 1;
    if (won) p.wins += 1; if (p.xpBoostMatches > 0) p.xpBoostMatches--;
    while (p.xp >= xpNeeded(p.level)) { p.xp -= xpNeeded(p.level); p.level++; }
    await saveProfile();
  }
}

window.closeMatchEnd = () => { $("matchEndModal").classList.add("hidden"); window.exitArena(); };
window.exitArena = async () => {
  cancelAnimationFrame(animFrame); gameListeners.forEach(u => u()); gameListeners = [];
  const wasQuick = game?.isQuickGuest;
  if (game?.mode==="online" && state.currentRoomId) {
    await remove(ref(db, `rooms/${state.currentRoomId}/players/${state.currentUser.uid}`));
    if (game.isHost) await remove(ref(db, `rooms/${state.currentRoomId}`));
  }
  if (threeCtx?.renderer) threeCtx.renderer.dispose();
  threeCtx = null; game = null; state.currentRoomId = null;
  $("gameScreen").classList.add("hidden");
  if (wasQuick) $("authScreen").classList.remove("hidden");
  else { $("lobbyScreen").classList.remove("hidden"); refreshProfileUI(); }
};