// ===== تكوين Firebase =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getDatabase, ref, set, push, update, remove, get, onValue, serverTimestamp, runTransaction, child
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCTcosTbOvgZTo8y4KuUcLtc6vCUXkG17o",
  authDomain: "bull-46ddf.firebaseapp.com",
  databaseURL: "https://bull-46ddf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bull-46ddf",
  storageBucket: "bull-46ddf.firebasestorage.app",
  messagingSenderId: "24129031258",
  appId: "1:24129031258:web:001c21f4284dc96bc09c63",
  measurementId: "G-KXS3HWH7PX"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const IMGBB_API_KEY = "552ab56b92a08f22f57b49363a60a9fd";

// ===== الأدوات العامة =====
function getRoomCode() { return localStorage.getItem("roomCode"); }
function setRoomCode(code) { localStorage.setItem("roomCode", code); }
function clearRoomCode() { localStorage.removeItem("roomCode"); }

// ===== دالة مسح الغرف التي في الانتظار ومر عليها ساعة كاملة (سواء فيها لاعبين أم لا) =====
async function deleteAllStaleRooms() {
  const roomsRef = ref(db, 'rooms');
  const snapshot = await get(roomsRef);
  if (!snapshot.exists()) return;
  
  const rooms = snapshot.val();
  const now = Date.now();
  const oneHour = 60 * 60 * 1000; // ساعة واحدة بالمللي ثانية
  let count = 0;

  for (const [code, data] of Object.entries(rooms)) {
    const createdAt = data.createdAt || 0;
    const started = data.started === true;

    // الشرط الصارم: إذا لم تبدأ اللعبة (started === false) ومرت أكثر من ساعة على إنشائها
    if (!started && (now - createdAt > oneHour)) {
      await remove(ref(db, `rooms/${code}`));
      count++;
      console.log(`🗑️ تم غلق وحذف الغرفة المعلقة (مرت ساعة ولم تبدأ): ${code}`);
    }
  }
  if (count > 0) console.log(`✅ تم غلق وحذف ${count} غرفة معلقة منتهية الصلاحية`);
  return count;
}

// ===== إنشاء غرفة جديدة (بـ 4 أرقام) =====
async function createNewRoom(isPublic = true) {
  const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  setRoomCode(roomCode);
  await set(ref(db, `rooms/${roomCode}`), { 
    started: false, 
    createdAt: Date.now(),
    isPublic: isPublic,
    discordLink: '',
    hasNarrator: true
  });
  return roomCode;
}

// ===== إدارة الغرفة =====
async function createOrGetRoom() {
  await deleteAllStaleRooms();

  let roomCode = getRoomCode();
  if (roomCode) {
    const snap = await get(ref(db, `rooms/${roomCode}`));
    if (snap.exists()) {
      const data = snap.val();
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      
      // التحقق من مرور ساعة ولم تبدأ
      if (!data.started && data.createdAt && (now - data.createdAt > oneHour)) {
        await deleteRoom(roomCode);
        roomCode = await createNewRoom(true);
      }
      if (data.isPublic === undefined) {
        await update(ref(db, `rooms/${roomCode}`), { isPublic: true });
      }
      if (data.hasNarrator === undefined) {
        await update(ref(db, `rooms/${roomCode}`), { hasNarrator: true });
      }
      return roomCode;
    } else {
      clearRoomCode();
    }
  }
  
  return await createNewRoom(true);
}

// ===== حذف الغرفة مع إشعار للاعبين =====
async function deleteRoom(roomCode) {
  const players = await getPlayers(roomCode);
  for (const pid of Object.keys(players)) {
    await update(ref(db, `rooms/${roomCode}/players/${pid}`), {
      kicked: true,
      kickReason: 'خروج الراوي'
    });
  }
  await remove(ref(db, `rooms/${roomCode}`));
  clearRoomCode();
}

async function checkRoomExpiry(roomCode) {
  await deleteAllStaleRooms();

  if (!roomCode) {
    return await createNewRoom(true);
  }

  const snap = await get(ref(db, `rooms/${roomCode}`));
  if (!snap.exists()) {
    return await createNewRoom(true);
  }
  
  const data = snap.val();
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  if (!data.started && data.createdAt && (now - data.createdAt > oneHour)) {
    await deleteRoom(roomCode);
    return await createNewRoom(true);
  }
  
  return roomCode;
}

// ===== جلب اللاعبين =====
function listenToPlayers(roomCode, callback) {
  onValue(ref(db, `rooms/${roomCode}/players`), (s) => callback(s.val() || {}), (e) => console.error(e));
}

async function getPlayers(roomCode) {
  try { 
    const snap = await get(ref(db, `rooms/${roomCode}/players`)); 
    return snap.val() || {}; 
  } 
  catch (e) { 
    console.error(e); 
    return {}; 
  }
}

// ===== الاستماع اللحظي للغرف المفتوحة العامة =====
function listenToOpenRooms(callback) {
  const roomsRef = ref(db, 'rooms');
  return onValue(roomsRef, (snap) => {
    const rooms = snap.val() || {};
    const openRooms = [];

    for (const [code, data] of Object.entries(rooms)) {
      const isPublic = data.isPublic !== undefined ? data.isPublic : true;
      let hasNarrator = data.hasNarrator === true;

      if (!hasNarrator) {
        const players = data.players || {};
        if (Object.keys(players).length > 0) hasNarrator = true;
      }

      // تظهر فقط إذا كانت عامة ولم تبدأ بعد ويوجد راوي
      if (isPublic === true && data.started === false && hasNarrator === true) {
        const playersCount = data.players ? Object.keys(data.players).length : 0;
        openRooms.push({ code, players: playersCount });
      }
    }

    openRooms.sort((a, b) => b.players - a.players);
    callback(openRooms);
  }, (e) => console.error("خطأ في الاستماع للغرف المفتوحة:", e));
}

// ===== دوال القتل والتحويل =====

// 1. دالة القتل: تضيف اللاعب إلى قائمة الموتى المعلقين
async function killPlayer(roomCode, playerId) {
  const player = await getPlayer(roomCode, playerId);
  if (!player) return;
  
  const pendingRef = ref(db, `rooms/${roomCode}/pendingDeaths`);
  await push(pendingRef, {
    playerId: playerId,
    playerName: player.name,
    role: player.role,
    roleImage: player.roleImage || 'https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png',
    timestamp: Date.now()
  });
  
  await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isDead: true });
}

// 2. دالة الاستذئاب
function infectPlayer(roomCode, playerId) { 
  update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isInfected: true }); 
}

// 3. دالة التحويل إلى ذئب
async function convertToWolf(roomCode, playerId) {
  await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { 
    isWolf: true,
    isInfected: false
  });
  
  const player = await getPlayer(roomCode, playerId);
  const playerName = player?.name || 'لاعب مجهول';
  
  const wolfChatRef = ref(db, `rooms/${roomCode}/wolvesChat`);
  await push(wolfChatRef, {
    playerId: playerId,
    playerName: playerName,
    message: `🐺 ${playerName} انضم إلى الذئاب!`,
    timestamp: Date.now(),
    systemMessage: true
  });
  
  const messagesRef = ref(db, `rooms/${roomCode}/messages`);
  await push(messagesRef, {
    playerId: playerId,
    playerName: 'النظام',
    message: `🐺 ${playerName} أصبح ذئباً!`,
    timestamp: Date.now(),
    fromNarrator: true,
    systemMessage: true
  });
  
  return true;
}

// 4. دالة إرسال الموتى المعلقين دفعة واحدة
async function flushPendingDeaths(roomCode) {
  const pendingRef = ref(db, `rooms/${roomCode}/pendingDeaths`);
  const snap = await get(pendingRef);
  const deaths = snap.val();
  if (!deaths) return;

  for (const [key, data] of Object.entries(deaths)) {
    const notifRef = ref(db, `rooms/${roomCode}/deathNotifications`);
    await push(notifRef, {
      playerId: data.playerId,
      playerName: data.playerName,
      role: data.role,
      roleImage: data.roleImage,
      timestamp: data.timestamp || Date.now(),
      cause: 'night_kill'
    });
  }
  
  await remove(pendingRef);
}

// ===== دالة إضافة لاعب =====
async function addPlayer(roomCode, name) {
  const newRef = push(ref(db, `rooms/${roomCode}/players`));
  await set(newRef, { 
    name, 
    role: null, 
    roleImage: "", 
    isDead: false, 
    isInfected: false,
    isWolf: false,
    kicked: false
  });
  return newRef.key;
}

// ===== دالة خلط عشوائية =====
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ===== توزيع الأدوار (معدل للبحث المرن عن صور الأدوار المحدثة من الأدمن) =====
async function distributeRoles(roomCode, wolvesCount, villagersCount, selectedRoles) {
  const playersObj = await getPlayers(roomCode);
  const players = Object.keys(playersObj).map(key => ({ id: key, ...playersObj[key] }));
  if (players.length === 0) throw new Error("لا يوجد لاعبين");

  const totalRoles = wolvesCount + villagersCount + selectedRoles.length;
  if (players.length !== totalRoles) {
    throw new Error(`عدد الأدوار (${totalRoles}) لا يساوي عدد اللاعبين (${players.length})`);
  }

  // جلب جميع الأدوار من Firebase
  const rolesSnap = await get(ref(db, 'global_roles'));
  const allRoles = Object.values(rolesSnap.val() || {});
  
  // دالة مساعدة لمطابقة اسم الدور بشكل مرن
  const matchRoleName = (roleObj, targetName) => {
    if (!roleObj || !roleObj.name) return false;
    const nameVal = typeof roleObj.name === 'object' ? (roleObj.name.ar || roleObj.name.fr || '') : roleObj.name;
    return nameVal.trim().includes(targetName);
  };

  // البحث عن دور الذئب والقروي المرفوعين في الأدمن
  const wolfRole = allRoles.find(r => r.isWol === true || matchRoleName(r, "ذئب"));
  const villagerRole = allRoles.find(r => matchRoleName(r, "قروي"));

  const roles = [];
  
  // إضافة الذئاب
  for (let i = 0; i < wolvesCount; i++) {
    roles.push({ 
      name: wolfRole ? (typeof wolfRole.name === 'object' ? wolfRole.name.ar : wolfRole.name) : "ذئب", 
      imageUrl: wolfRole?.imageUrl || "https://i.postimg.cc/MpdMDrSv/FB-IMG-1751654961583.jpg",
      isWolf: true
    });
  }

  // إضافة القرويين (مع الصورة المسجلة في الأدمن)
  for (let i = 0; i < villagersCount; i++) {
    roles.push({ 
      name: villagerRole ? (typeof villagerRole.name === 'object' ? villagerRole.name.ar : villagerRole.name) : "قروي", 
      imageUrl: villagerRole?.imageUrl || "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png",
      isWolf: false
    });
  }

  // إضافة بقية الأدوار الخاصة المختارة
  selectedRoles.forEach(r => {
    const found = allRoles.find(role => {
      const name = typeof role.name === 'object' ? role.name.ar : role.name;
      const rName = typeof r.name === 'object' ? r.name.ar : r.name;
      return name === rName;
    });
    roles.push({ 
      name: typeof r.name === 'object' ? r.name.ar : r.name, 
      imageUrl: found?.imageUrl || r.imageUrl || "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png",
      isWolf: found?.isWol || false,
      isConvertible: found?.isConvertible || false
    });
  });

  if (players.length !== roles.length) {
    throw new Error(`عدد الأدوار الكلي (${roles.length}) لا يساوي عدد اللاعبين (${players.length})`);
  }

  const shuffledRoles = shuffleArray([...roles]);
  const shuffledPlayers = shuffleArray([...players]);

  for (let i = 0; i < shuffledPlayers.length; i++) {
    await update(ref(db, `rooms/${roomCode}/players/${shuffledPlayers[i].id}`), {
      role: shuffledRoles[i].name,
      roleImage: shuffledRoles[i].imageUrl,
      isWolf: shuffledRoles[i].isWolf || false
    });
  }
  
  await update(ref(db, `rooms/${roomCode}`), { started: true });
  return shuffledPlayers;
}

// ===== إدارة الأدوار =====
function listenToRoles(callback) { onValue(ref(db, "global_roles"), (s) => callback(s.val())); }

async function addRole(nameObj, imageUrl, description, isWolf, isConvertible) { 
  const newRef = push(ref(db, "global_roles")); 
  await set(newRef, { 
    name: nameObj, 
    imageUrl, 
    description, 
    isWol: isWolf || false,
    isConvertible: isConvertible || false 
  }); 
  return newRef.key; 
}

async function updateRole(roleId, nameObj, imageUrl, description, isWolf, isConvertible) { 
  await update(ref(db, `global_roles/${roleId}`), { 
    name: nameObj, 
    imageUrl, 
    description, 
    isWol: isWolf || false,
    isConvertible: isConvertible || false 
  }); 
}

async function deleteRole(roleId) { 
  await remove(ref(db, `global_roles/${roleId}`)); 
}

async function uploadImageToImgBB(file) {
  const reader = new FileReader();
  const base64 = await new Promise((resolve) => { 
    reader.onload = (e) => resolve(e.target.result.split(",")[1]); 
    reader.readAsDataURL(file); 
  });
  const formData = new FormData(); 
  formData.append("key", IMGBB_API_KEY); 
  formData.append("image", base64);
  const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: formData });
  const json = await res.json();
  if (!json.success) throw new Error("فشل الرفع");
  return json.data.url;
}

// ===== غرفة الذئاب =====
async function sendWolfMessage(roomCode, playerId, playerName, message) {
  const wolvesRef = ref(db, `rooms/${roomCode}/wolvesChat`);
  await push(wolvesRef, {
    playerId: playerId,
    playerName: playerName,
    message: message,
    timestamp: Date.now()
  });
}

function listenToWolfMessages(roomCode, callback) {
  const wolvesRef = ref(db, `rooms/${roomCode}/wolvesChat`);
  onValue(wolvesRef, (snapshot) => {
    const data = snapshot.val();
    callback(data);
  });
}

async function clearWolfMessages(roomCode) {
  await remove(ref(db, `rooms/${roomCode}/wolvesChat`));
}

async function isPlayerWolf(roomCode, playerId) {
  const player = await getPlayer(roomCode, playerId);
  if (!player) return false;
  
  // 🛑 الشرط المحدث: الاعتماد على isWolf الحقيقي أو إذا كان دوره يحمل صفة isWol الأساسية في الأدوار
  if (player.isWolf === true) return true;
  
  if (!player.role) return false;
  
  const rolesSnap = await get(ref(db, 'global_roles'));
  const allRoles = rolesSnap.val() || {};
  
  for (const key in allRoles) {
    const role = allRoles[key];
    const roleName = typeof role.name === 'object' ? role.name.ar : role.name;
    const playerRoleName = typeof player.role === 'object' ? player.role.ar : player.role;
    if (roleName === playerRoleName) {
      return role.isWol === true;
    }
  }
  return false;
}

// ===== نظام الاقتراحات =====
async function sendSuggestion(playerName, message, roomId) { 
  await push(ref(db, "suggestions"), { 
    playerName: playerName || "لاعب مجهول", 
    message: message, 
    roomId: roomId || "غير معروف", 
    timestamp: serverTimestamp() 
  }); 
}
function listenToSuggestions(callback) { 
  onValue(ref(db, "suggestions"), (s) => callback(s.val())); 
}
async function deleteSuggestion(suggestionId) { 
  await remove(ref(db, `suggestions/${suggestionId}`)); 
}
async function deleteAllSuggestions() { 
  await remove(ref(db, "suggestions")); 
}

// ===== إحصائيات التحميل =====
async function incrementDownloadCount() { 
  await runTransaction(ref(db, "stats/downloadCount"), (curr) => curr ? { count: curr.count + 1 } : { count: 1 }); 
}
async function getDownloadCount() { 
  const s = await get(ref(db, "stats/downloadCount")); 
  return s.val()?.count || 0; 
}

// ===== بيانات الاعتماد =====
async function getCredentials() { 
  const s = await get(ref(db, "admin_credentials")); 
  return s.val(); 
}
async function setCredentials(username, password) { 
  await set(ref(db, "admin_credentials"), { username, password }); 
}
async function seedDefaultCredentials() { 
  const creds = await getCredentials(); 
  if (!creds) await setCredentials("admin", "admin123"); 
}
async function getPlayer(roomCode, playerId) { 
  const s = await get(child(ref(db), `rooms/${roomCode}/players/${playerId}`)); 
  return s.val(); 
}

// ===== تصدير كل شيء =====
export { 
  db, ref, update, remove, get, set, push, onValue, serverTimestamp, runTransaction, child,
  getRoomCode, setRoomCode, clearRoomCode,
  createOrGetRoom, deleteRoom, checkRoomExpiry, deleteAllStaleRooms,
  listenToPlayers, getPlayers, listenToOpenRooms,
  killPlayer, infectPlayer, addPlayer,
  distributeRoles,
  listenToRoles, addRole, updateRole, deleteRole, uploadImageToImgBB,
  sendSuggestion, listenToSuggestions, deleteSuggestion, deleteAllSuggestions,
  incrementDownloadCount, getDownloadCount,
  getCredentials, setCredentials, seedDefaultCredentials, getPlayer,
  sendWolfMessage, listenToWolfMessages, clearWolfMessages, isPlayerWolf, convertToWolf,
  createNewRoom,
  flushPendingDeaths
};
