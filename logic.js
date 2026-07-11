// ===== تكوين Firebase =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  push,
  update,
  remove,
  get,
  onValue,
  serverTimestamp,
  runTransaction,
  child
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

// ===== مفتاح ImgBB =====
const IMGBB_API_KEY = "552ab56b92a08f22f57b49363a60a9fd";

// ===== الأدوات العامة =====
function getRoomCode() {
  return localStorage.getItem("roomCode");
}

function setRoomCode(code) {
  localStorage.setItem("roomCode", code);
}

function clearRoomCode() {
  localStorage.removeItem("roomCode");
}

// ===== مسح الغرف المعلقة (التي مضى عليها أكثر من 12 ساعة) =====
async function deleteAllStaleRooms() {
  const roomsRef = ref(db, 'rooms');
  const snapshot = await get(roomsRef);
  if (!snapshot.exists()) return;
  const rooms = snapshot.val();
  const now = Date.now();
  const twelveHours = 12 * 60 * 60 * 1000;

  for (const [code, data] of Object.entries(rooms)) {
    const createdAt = data.createdAt || 0;
    // حذف إذا مضى أكثر من 12 ساعة منذ الإنشاء، أو إذا انتهت صلاحيتها
    if (now - createdAt > twelveHours || (data.expiresAt && now > data.expiresAt)) {
      await remove(ref(db, `rooms/${code}`));
      console.log(`🗑️ حذفت الغرفة المعلقة: ${code}`);
    }
  }
}

// ===== إدارة الغرفة (صلاحية 12 ساعة) =====
async function createOrGetRoom() {
  // مسح الغرف المنتهية أولاً
  await deleteAllStaleRooms();

  let roomCode = getRoomCode();
  if (roomCode) {
    const snap = await get(ref(db, `rooms/${roomCode}`));
    if (snap.exists()) return roomCode;
    clearRoomCode();
  }
  roomCode = Math.floor(100 + Math.random() * 900).toString();
  setRoomCode(roomCode);
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000; // 12 ساعة
  await set(ref(db, `rooms/${roomCode}`), {
    started: false,
    createdAt: serverTimestamp(),
    expiresAt: expiresAt
  });
  return roomCode;
}

async function deleteRoom(roomCode) {
  await remove(ref(db, `rooms/${roomCode}`));
  clearRoomCode();
}

async function checkRoomExpiry(roomCode) {
  // مسح الغرف المنتهية أولاً
  await deleteAllStaleRooms();

  const snap = await get(ref(db, `rooms/${roomCode}`));
  if (!snap.exists()) return false;
  const data = snap.val();
  if (data.expiresAt && Date.now() > data.expiresAt) {
    await deleteRoom(roomCode);
    return false;
  }
  return true;
}

// ===== جلب اللاعبين =====
function listenToPlayers(roomCode, callback) {
  const playersRef = ref(db, `rooms/${roomCode}/players`);
  onValue(playersRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || {});
  }, (error) => {
    console.error("خطأ في الاستماع للاعبين:", error);
    callback({});
  });
}

async function getPlayers(roomCode) {
  try {
    const snap = await get(ref(db, `rooms/${roomCode}/players`));
    return snap.val() || {};
  } catch (error) {
    console.error("خطأ في جلب اللاعبين:", error);
    return {};
  }
}

// ===== دوال القتل والتحويل =====
function killPlayer(roomCode, playerId) {
  update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isDead: true });
}

function infectPlayer(roomCode, playerId) {
  update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isInfected: true });
}

// ===== إضافة لاعب =====
async function addPlayer(roomCode, name) {
  const newRef = push(ref(db, `rooms/${roomCode}/players`));
  const playerId = newRef.key;
  await set(newRef, {
    name: name,
    role: null,
    roleImage: "",
    isDead: false,
    isInfected: false
  });
  return playerId;
}

// ===== دالة مساعدة للخلط =====
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ===== توزيع الأدوار (مع الخلط العشوائي) =====
async function distributeRoles(roomCode, wolvesCount, villagersCount, selectedRoles) {
  const playersObj = await getPlayers(roomCode);
  const players = Object.keys(playersObj).map(key => ({ id: key, ...playersObj[key] }));

  if (players.length === 0) throw new Error("لا يوجد لاعبين");

  const totalRoles = wolvesCount + villagersCount + selectedRoles.length;
  if (players.length !== totalRoles) {
    throw new Error(`عدد الأدوار (${totalRoles}) لا يساوي عدد اللاعبين (${players.length})`);
  }

  const roles = [];
  for (let i = 0; i < wolvesCount; i++) {
    roles.push({ name: "ذئب", imageUrl: "https://i.postimg.cc/MpdMDrSv/FB-IMG-1751654961583.jpg" });
  }
  for (let i = 0; i < villagersCount; i++) {
    roles.push({ name: "قروي", imageUrl: "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png" });
  }
  selectedRoles.forEach(r => roles.push({ name: r.name, imageUrl: r.imageUrl || "" }));

  const shuffledRoles = shuffleArray(roles);
  const shuffledPlayers = shuffleArray(players);

  for (let i = 0; i < shuffledPlayers.length; i++) {
    await update(ref(db, `rooms/${roomCode}/players/${shuffledPlayers[i].id}`), {
      role: shuffledRoles[i].name,
      roleImage: shuffledRoles[i].imageUrl
    });
  }
  await update(ref(db, `rooms/${roomCode}`), { started: true });
  return shuffledPlayers;
}

// ===== إدارة الأدوار (global_roles) =====
function listenToRoles(callback) {
  const rolesRef = ref(db, "global_roles");
  onValue(rolesRef, (snapshot) => {
    const data = snapshot.val();
    callback(data);
  });
}

async function addRole(name, imageUrl) {
  const rolesRef = ref(db, "global_roles");
  const newRef = push(rolesRef);
  await set(newRef, { name, imageUrl });
  return newRef.key;
}

async function updateRole(roleId, name, imageUrl) {
  await update(ref(db, `global_roles/${roleId}`), { name, imageUrl });
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
  const response = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: formData });
  const json = await response.json();
  if (!json.success) throw new Error("فشل رفع الصورة");
  return json.data.url;
}

// ===== نظام الاقتراحات =====
async function sendSuggestion(playerName, message, roomId) {
  const suggestionsRef = ref(db, "suggestions");
  await push(suggestionsRef, {
    playerName: playerName || "لاعب مجهول",
    message: message,
    roomId: roomId || "غير معروف",
    timestamp: serverTimestamp()
  });
}

function listenToSuggestions(callback) {
  const suggestionsRef = ref(db, "suggestions");
  onValue(suggestionsRef, (snapshot) => {
    const data = snapshot.val();
    callback(data);
  });
}

async function deleteSuggestion(suggestionId) {
  await remove(ref(db, `suggestions/${suggestionId}`));
}

async function deleteAllSuggestions() {
  await remove(ref(db, "suggestions"));
}

// ===== عداد التحميلات =====
async function incrementDownloadCount() {
  const countRef = ref(db, "stats/downloadCount");
  await runTransaction(countRef, (current) => {
    if (current === null) return { count: 1 };
    return { count: current.count + 1 };
  });
}

async function getDownloadCount() {
  const snap = await get(ref(db, "stats/downloadCount"));
  return snap.val()?.count || 0;
}

// ===== بيانات الاعتماد =====
async function getCredentials() {
  const snap = await get(ref(db, "admin_credentials"));
  return snap.val();
}

async function setCredentials(username, password) {
  await set(ref(db, "admin_credentials"), { username, password });
}

async function seedDefaultCredentials() {
  const creds = await getCredentials();
  if (!creds) {
    await setCredentials("admin", "admin123");
  }
}

async function getPlayer(roomCode, playerId) {
  const snap = await get(child(ref(db), `rooms/${roomCode}/players/${playerId}`));
  return snap.val();
}

// ===== تصدير كل شيء =====
export {
  db,
  ref,
  update,
  remove,
  get,
  set,
  push,
  onValue,
  serverTimestamp,
  runTransaction,
  child,
  getRoomCode,
  setRoomCode,
  clearRoomCode,
  createOrGetRoom,
  deleteRoom,
  checkRoomExpiry,
  deleteAllStaleRooms,
  listenToPlayers,
  getPlayers,
  killPlayer,
  infectPlayer,
  addPlayer,
  distributeRoles,
  listenToRoles,
  addRole,
  updateRole,
  deleteRole,
  uploadImageToImgBB,
  sendSuggestion,
  listenToSuggestions,
  deleteSuggestion,
  deleteAllSuggestions,
  incrementDownloadCount,
  getDownloadCount,
  getCredentials,
  setCredentials,
  seedDefaultCredentials,
  getPlayer
};