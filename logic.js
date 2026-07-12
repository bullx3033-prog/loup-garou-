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

// ===== إدارة الغرفة (مع المسح التلقائي) =====
async function createOrGetRoom() {
  await deleteAllStaleRooms();

  let roomCode = getRoomCode();
  if (roomCode) {
    const snap = await get(ref(db, `rooms/${roomCode}`));
    if (snap.exists()) return roomCode;
    clearRoomCode();
  }
  roomCode = Math.floor(100 + Math.random() * 900).toString();
  setRoomCode(roomCode);
  await set(ref(db, `rooms/${roomCode}`), { 
    started: false, 
    createdAt: serverTimestamp() 
  });
  return roomCode;
}

async function deleteRoom(roomCode) { 
  await remove(ref(db, `rooms/${roomCode}`)); 
  clearRoomCode(); 
}

async function checkRoomExpiry(roomCode) {
  await deleteAllStaleRooms();

  const snap = await get(ref(db, `rooms/${roomCode}`));
  if (!snap.exists()) return false;
  const data = snap.val();
  if (data.createdAt) {
    const now = Date.now();
    if (now - data.createdAt > 24 * 60 * 60 * 1000) { 
      await deleteRoom(roomCode); 
      return false; 
    }
  }
  return true;
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
function killPlayer(roomCode, playerId) { update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isDead: true }); }
function infectPlayer(roomCode, playerId) { update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isInfected: true }); }

async function addPlayer(roomCode, name) {
  const newRef = push(ref(db, `rooms/${roomCode}/players`));
  await set(newRef, { name, role: null, roleImage: "", isDead: false, isInfected: false });
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

// ===== توزيع الأدوار (مع التحقق الصارم من التطابق) =====
async function distributeRoles(roomCode, wolvesCount, villagersCount, selectedRoles) {
  // 1. جلب اللاعبين
  const playersObj = await getPlayers(roomCode);
  const players = Object.keys(playersObj).map(key => ({ id: key, ...playersObj[key] }));
  if (players.length === 0) throw new Error("لا يوجد لاعبين");

  // 2. حساب عدد الأدوار المطلوبة
  const totalRoles = wolvesCount + villagersCount + selectedRoles.length;
  
  // 3. التحقق الصارم من التطابق
  if (players.length !== totalRoles) {
    throw new Error(`عدد الأدوار (${totalRoles}) لا يساوي عدد اللاعبين (${players.length})`);
  }

  // 4. جلب جميع الأدوار من Firebase
  const rolesSnap = await get(ref(db, 'global_roles'));
  const allRoles = Object.values(rolesSnap.val() || {});
  const wolfRole = allRoles.find(r => r.name?.ar === "ذئب" || r.name === "ذئب");
  const villagerRole = allRoles.find(r => r.name?.ar === "قروي" || r.name === "قروي");

  // 5. بناء قائمة الأدوار (بدون حلقات while)
  const roles = [];
  
  // إضافة الذئاب
  for (let i = 0; i < wolvesCount; i++) {
    roles.push({ 
      name: wolfRole?.name || "ذئب", 
      imageUrl: wolfRole?.imageUrl || "https://i.postimg.cc/MpdMDrSv/FB-IMG-1751654961583.jpg" 
    });
  }
  
  // إضافة القرويين
  for (let i = 0; i < villagersCount; i++) {
    roles.push({ 
      name: villagerRole?.name || "قروي", 
      imageUrl: villagerRole?.imageUrl || "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png" 
    });
  }
  
  // إضافة الأدوار الإضافية المختارة
  selectedRoles.forEach(r => {
    const found = allRoles.find(role => role.name?.ar === r.name || role.name === r.name);
    roles.push({ 
      name: r.name, 
      imageUrl: found?.imageUrl || r.imageUrl || "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png" 
    });
  });

  // 6. التحقق النهائي (للتأكد من أن العدد متطابق)
  if (players.length !== roles.length) {
    throw new Error(`عدد الأدوار الكلي (${roles.length}) لا يساوي عدد اللاعبين (${players.length})`);
  }

  // 7. خلط الأدوار واللاعبين بشكل منفصل
  const shuffledRoles = shuffleArray([...roles]);
  const shuffledPlayers = shuffleArray([...players]);

  // 8. توزيع الأدوار على اللاعبين
  for (let i = 0; i < shuffledPlayers.length; i++) {
    await update(ref(db, `rooms/${roomCode}/players/${shuffledPlayers[i].id}`), {
      role: shuffledRoles[i].name,
      roleImage: shuffledRoles[i].imageUrl
    });
  }
  
  // 9. تحديث حالة الغرفة
  await update(ref(db, `rooms/${roomCode}`), { started: true });
  return shuffledPlayers;
}

// ===== إدارة الأدوار (global_roles) =====
function listenToRoles(callback) { onValue(ref(db, "global_roles"), (s) => callback(s.val())); }

async function addRole(nameObj, imageUrl, description) { 
  const newRef = push(ref(db, "global_roles")); 
  await set(newRef, { name: nameObj, imageUrl, description }); 
  return newRef.key; 
}

async function updateRole(roleId, nameObj, imageUrl, description) { 
  await update(ref(db, `global_roles/${roleId}`), { name: nameObj, imageUrl, description }); 
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
  getCredentials, setCredentials, seedDefaultCredentials, getPlayer
};