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

// ===== دالة مسح الغرف المنتهية (24 ساعة) =====
async function deleteAllStaleRooms() {
  const roomsRef = ref(db, 'rooms');
  const snapshot = await get(roomsRef);
  if (!snapshot.exists()) return;
  
  const rooms = snapshot.val();
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  let count = 0;

  for (const [code, data] of Object.entries(rooms)) {
    const createdAt = data.createdAt || 0;
    if (now - createdAt > twentyFourHours) {
      await remove(ref(db, `rooms/${code}`));
      count++;
      console.log(`🗑️ تم حذف الغرفة المعلقة: ${code}`);
    }
  }
  if (count > 0) console.log(`✅ تم حذف ${count} غرفة منتهية الصلاحية`);
  return count;
}

// ===== إنشاء غرفة جديدة =====
async function createNewRoom() {
  const roomCode = Math.floor(100 + Math.random() * 900).toString();
  setRoomCode(roomCode);
  await set(ref(db, `rooms/${roomCode}`), { 
    started: false, 
    createdAt: serverTimestamp() 
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
      if (data.createdAt && (now - data.createdAt > 24 * 60 * 60 * 1000)) {
        await deleteRoom(roomCode);
        roomCode = await createNewRoom();
      }
      return roomCode;
    } else {
      clearRoomCode();
    }
  }
  
  return await createNewRoom();
}

async function deleteRoom(roomCode) { 
  await remove(ref(db, `rooms/${roomCode}`)); 
  clearRoomCode(); 
}

async function checkRoomExpiry(roomCode) {
  await deleteAllStaleRooms();

  if (!roomCode) {
    return await createNewRoom();
  }

  const snap = await get(ref(db, `rooms/${roomCode}`));
  if (!snap.exists()) {
    return await createNewRoom();
  }
  
  const data = snap.val();
  const now = Date.now();
  if (data.createdAt && (now - data.createdAt > 24 * 60 * 60 * 1000)) {
    await deleteRoom(roomCode);
    return await createNewRoom();
  }
  
  return roomCode;
}

// ===== جلب اللاعبين =====
function listenToPlayers(roomCode, callback) {
  onValue(ref(db, `rooms/${roomCode}/players`), (s) => callback(s.val() || {}), (e) => console.error(e));
}

async function getPlayers(roomCode) {
  try { const snap = await get(ref(db, `rooms/${roomCode}/players`)); return snap.val() || {}; } 
  catch (e) { console.error(e); return {}; }
}

// ===== دوال القتل والتحويل =====
function killPlayer(roomCode, playerId) { 
  update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isDead: true }); 
}

function infectPlayer(roomCode, playerId) { 
  update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isInfected: true }); 
}

// ===== دالة تحويل إلى ذئب (جديدة) =====
async function convertToWolf(roomCode, playerId) {
  // 1. تحديث حالة اللاعب إلى ذئب
  await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { 
    isWolf: true,
    isInfected: false // نزيل حالة المستذئب إذا كانت موجودة
  });
  
  // 2. إضافة اللاعب إلى دردشة الذئاب
  const wolfChatRef = ref(db, `rooms/${roomCode}/wolvesChat`);
  await push(wolfChatRef, {
    playerId: playerId,
    playerName: (await getPlayer(roomCode, playerId))?.name || 'ذئب',
    message: `🐺 ${(await getPlayer(roomCode, playerId))?.name || 'لاعب'} انضم إلى الذئاب!`,
    timestamp: Date.now(),
    systemMessage: true
  });
  
  // 3. إشعار في رسائل اللاعبين
  const messagesRef = ref(db, `rooms/${roomCode}/messages`);
  await push(messagesRef, {
    playerId: playerId,
    playerName: 'النظام',
    message: `🐺 ${(await getPlayer(roomCode, playerId))?.name || 'لاعب'} أصبح ذئباً!`,
    timestamp: Date.now(),
    fromNarrator: true,
    systemMessage: true
  });
  
  return true;
}

// ===== دالة إضافة لاعب =====
async function addPlayer(roomCode, name) {
  const newRef = push(ref(db, `rooms/${roomCode}/players`));
  await set(newRef, { name, role: null, roleImage: "", isDead: false, isInfected: false, isWolf: false });
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

// ===== توزيع الأدوار =====
async function distributeRoles(roomCode, wolvesCount, villagersCount, selectedRoles) {
  const playersObj = await getPlayers(roomCode);
  const players = Object.keys(playersObj).map(key => ({ id: key, ...playersObj[key] }));
  if (players.length === 0) throw new Error("لا يوجد لاعبين");

  const totalRoles = wolvesCount + villagersCount + selectedRoles.length;
  if (players.length !== totalRoles) {
    throw new Error(`عدد الأدوار (${totalRoles}) لا يساوي عدد اللاعبين (${players.length})`);
  }

  const rolesSnap = await get(ref(db, 'global_roles'));
  const allRoles = Object.values(rolesSnap.val() || {});
  const wolfRole = allRoles.find(r => r.name?.ar === "ذئب" || r.name === "ذئب");
  const villagerRole = allRoles.find(r => r.name?.ar === "قروي" || r.name === "قروي");

  const roles = [];
  for (let i = 0; i < wolvesCount; i++) {
    roles.push({ 
      name: wolfRole?.name || "ذئب", 
      imageUrl: wolfRole?.imageUrl || "https://i.postimg.cc/MpdMDrSv/FB-IMG-1751654961583.jpg",
      isWolf: true
    });
  }
  for (let i = 0; i < villagersCount; i++) {
    roles.push({ 
      name: villagerRole?.name || "قروي", 
      imageUrl: villagerRole?.imageUrl || "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png",
      isWolf: false
    });
  }
  selectedRoles.forEach(r => {
    const found = allRoles.find(role => role.name?.ar === r.name || role.name === r.name);
    roles.push({ 
      name: r.name, 
      imageUrl: found?.imageUrl || r.imageUrl || "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png",
      isWolf: found?.isWolf || false,
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
  await set(newRef, { name: nameObj, imageUrl, description, isWolf: isWolf || false, isConvertible: isConvertible || false }); 
  return newRef.key; 
}
async function updateRole(roleId, nameObj, imageUrl, description, isWolf, isConvertible) { 
  await update(ref(db, `global_roles/${roleId}`), { name: nameObj, imageUrl, description, isWolf: isWolf || false, isConvertible: isConvertible || false }); 
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

// ===== غرفة الذئاب (الدردشة الخاصة) =====
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
  
  // التحقق من isWolf مباشرة
  if (player.isWolf === true) return true;
  
  // التحقق من الدور
  if (!player.role) return false;
  
  const rolesSnap = await get(ref(db, 'global_roles'));
  const allRoles = rolesSnap.val() || {};
  
  for (const key in allRoles) {
    const role = allRoles[key];
    const roleName = typeof role.name === 'object' ? role.name.ar : role.name;
    const playerRoleName = typeof player.role === 'object' ? player.role.ar : player.role;
    if (roleName === playerRoleName) {
      return role.isWolf === true;
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
  listenToPlayers, getPlayers, killPlayer, infectPlayer, addPlayer,
  distributeRoles,
  listenToRoles, addRole, updateRole, deleteRole, uploadImageToImgBB,
  sendSuggestion, listenToSuggestions, deleteSuggestion, deleteAllSuggestions,
  incrementDownloadCount, getDownloadCount,
  getCredentials, setCredentials, seedDefaultCredentials, getPlayer,
  sendWolfMessage,
  listenToWolfMessages,
  clearWolfMessages,
  isPlayerWolf,
  convertToWolf // تصدير الدالة الجديدة
};