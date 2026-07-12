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

const IMGBB_API_KEY = "552ab56b92a08f22f57b49363a60a9fd";

// ===== أدوات عامة =====
function getRoomCode() {
  return localStorage.getItem("roomCode");
}
function setRoomCode(code) {
  localStorage.setItem("roomCode", code);
}
function clearRoomCode() {
  localStorage.removeItem("roomCode");
}

// ===== تهيئة الأدوار الأساسية (مع وصف متعدد اللغات) =====
async function seedBaseRoles() {
  const rolesRef = ref(db, 'global_roles');
  const snap = await get(rolesRef);
  if (snap.exists()) {
    // تحديث الأدوار القديمة إذا كانت مخزنة كنصوص
    const roles = snap.val();
    let needUpdate = false;
    for (const key in roles) {
      const role = roles[key];
      // تحويل الاسم إلى كائن إذا كان نصاً
      if (role.name && typeof role.name === 'string') {
        const oldName = role.name;
        roles[key].name = { ar: oldName, fr: oldName, en: oldName };
        needUpdate = true;
      }
      // تحويل الوصف إلى كائن إذا كان نصاً
      if (role.description && typeof role.description === 'string') {
        const oldDesc = role.description;
        roles[key].description = { ar: oldDesc, fr: oldDesc, en: oldDesc };
        needUpdate = true;
      }
    }
    if (needUpdate) {
      await set(rolesRef, roles);
      console.log('✅ تم تحديث الأدوار القديمة إلى صيغة الكائنات');
    }
    return;
  }

  // إنشاء الأدوار الأساسية
  const baseRoles = [
    {
      name: { ar: "ذئب", fr: "Loup", en: "Wolf" },
      imageUrl: "https://i.postimg.cc/MpdMDrSv/FB-IMG-1751654961583.jpg",
      description: {
        ar: "يحاول المستأنبون قتل جميع القرويين دون أن يتم كشفهم. يجتمع كل ليلة مع المستأنبين الآخرين لاتخاذ قرار بشأن ضحيتهم. يفوز إذا تم القضاء على القرية بأكملها.",
        fr: "Les loups-garous tentent de tuer tous les villageois sans être démasqués. Chaque nuit, ils se réunissent pour choisir leur victime. Ils gagnent s'ils éliminent tout le village.",
        en: "The werewolves try to kill all the villagers without being exposed. Every night they meet to choose their victim. They win if they eliminate the entire village."
      }
    },
    {
      name: { ar: "قروي", fr: "Villageois", en: "Villager" },
      imageUrl: "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png",
      description: {
        ar: "عادي، ليس لديه قدرات خاصة، مهمته التعاون مع القرويين الآخرين لاكتشاف المستأنبين والقضاء عليهم قبل أن يفنوا القرية.",
        fr: "Ordinaire, sans pouvoirs spéciaux. Sa mission est de coopérer avec les autres villageois pour démasquer les loups-garous et les éliminer avant qu'ils ne détruisent le village.",
        en: "Ordinary, no special powers. His mission is to cooperate with other villagers to uncover the werewolves and eliminate them before they destroy the village."
      }
    }
  ];

  for (const role of baseRoles) {
    await push(rolesRef, role);
  }
  console.log('✅ تم إنشاء الأدوار الأساسية في Firebase');
}

await seedBaseRoles();

// ===== إدارة الغرف =====
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
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
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

async function deleteAllStaleRooms() {
  const roomsRef = ref(db, 'rooms');
  const snapshot = await get(roomsRef);
  if (!snapshot.exists()) return;
  const rooms = snapshot.val();
  const now = Date.now();
  const twelveHours = 12 * 60 * 60 * 1000;
  for (const [code, data] of Object.entries(rooms)) {
    const createdAt = data.createdAt || 0;
    if (now - createdAt > twelveHours || (data.expiresAt && now > data.expiresAt)) {
      await remove(ref(db, `rooms/${code}`));
    }
  }
}

// ===== اللاعبين =====
function listenToPlayers(roomCode, callback) {
  const playersRef = ref(db, `rooms/${roomCode}/players`);
  onValue(playersRef, (snapshot) => {
    callback(snapshot.val() || {});
  }, () => callback({}));
}

async function getPlayers(roomCode) {
  try {
    const snap = await get(ref(db, `rooms/${roomCode}/players`));
    return snap.val() || {};
  } catch {
    return {};
  }
}

function killPlayer(roomCode, playerId) {
  update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isDead: true });
}

function infectPlayer(roomCode, playerId) {
  update(ref(db, `rooms/${roomCode}/players/${playerId}`), { isInfected: true });
}

async function addPlayer(roomCode, name) {
  const newRef = push(ref(db, `rooms/${roomCode}/players`));
  const playerId = newRef.key;
  await set(newRef, {
    name,
    role: null,
    roleImage: "",
    isDead: false,
    isInfected: false
  });
  return playerId;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ===== توزيع الأدوار (جميعها من Firebase) =====
async function distributeRoles(roomCode, wolvesCount, villagersCount, selectedRoles) {
  const playersObj = await getPlayers(roomCode);
  const players = Object.keys(playersObj).map(key => ({ id: key, ...playersObj[key] }));
  if (players.length === 0) throw new Error("لا يوجد لاعبين");

  const rolesSnap = await get(ref(db, 'global_roles'));
  const allRoles = Object.values(rolesSnap.val() || {});
  
  const wolf = allRoles.find(r => r.name?.ar === "ذئب");
  const villager = allRoles.find(r => r.name?.ar === "قروي");
  if (!wolf) throw new Error("دور 'ذئب' غير موجود");
  if (!villager) throw new Error("دور 'قروي' غير موجود");

  const roles = [];
  for (let i = 0; i < wolvesCount; i++) {
    roles.push({ name: wolf.name, imageUrl: wolf.imageUrl, description: wolf.description || '' });
  }
  for (let i = 0; i < villagersCount; i++) {
    roles.push({ name: villager.name, imageUrl: villager.imageUrl, description: villager.description || '' });
  }
  
  selectedRoles.forEach(sel => {
    const found = allRoles.find(r => r.name?.ar === sel.name || r.name?.en === sel.name || r.name?.fr === sel.name);
    if (found) roles.push({ name: found.name, imageUrl: found.imageUrl, description: found.description || '' });
  });

  if (players.length !== roles.length) {
    throw new Error(`عدد الأدوار (${roles.length}) لا يساوي عدد اللاعبين (${players.length})`);
  }

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

// ===== إدارة الأدوار (مع دعم الوصف متعدد اللغات) =====
function listenToRoles(callback) {
  onValue(ref(db, "global_roles"), (snap) => callback(snap.val()));
}

// دوال الإضافة والتحديث تدعم الآن وصفاً متعدد اللغات
async function addRole(nameObj, imageUrl, descriptionObj) {
  const newRef = push(ref(db, "global_roles"));
  await set(newRef, { name: nameObj, imageUrl, description: descriptionObj });
  return newRef.key;
}

async function updateRole(roleId, nameObj, imageUrl, descriptionObj) {
  await update(ref(db, `global_roles/${roleId}`), { name: nameObj, imageUrl, description: descriptionObj });
}

async function deleteRole(roleId) {
  await remove(ref(db, `global_roles/${roleId}`));
}

async function uploadImageToImgBB(file) {
  const reader = new FileReader();
  const base64 = await new Promise(resolve => {
    reader.onload = e => resolve(e.target.result.split(",")[1]);
    reader.readAsDataURL(file);
  });
  const formData = new FormData();
  formData.append("key", IMGBB_API_KEY);
  formData.append("image", base64);
  const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: formData });
  const json = await res.json();
  if (!json.success) throw new Error("فشل رفع الصورة");
  return json.data.url;
}

// ===== نظام الاقتراحات =====
async function sendSuggestion(playerName, message, roomId) {
  await push(ref(db, "suggestions"), {
    playerName: playerName || "لاعب مجهول",
    message,
    roomId: roomId || "غير معروف",
    timestamp: serverTimestamp()
  });
}

function listenToSuggestions(callback) {
  onValue(ref(db, "suggestions"), (snap) => callback(snap.val()));
}

async function deleteSuggestion(suggestionId) {
  await remove(ref(db, `suggestions/${suggestionId}`));
}

async function deleteAllSuggestions() {
  await remove(ref(db, "suggestions"));
}

// ===== إحصائيات =====
async function incrementDownloadCount() {
  await runTransaction(ref(db, "stats/downloadCount"), (current) => {
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
  if (!creds) await setCredentials("admin", "admin123");
}

async function getPlayer(roomCode, playerId) {
  const snap = await get(child(ref(db), `rooms/${roomCode}/players/${playerId}`));
  return snap.val();
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