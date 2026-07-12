async function distributeRoles(roomCode, wolvesCount, villagersCount, selectedRoles) {
  const playersObj = await getPlayers(roomCode);
  const players = Object.keys(playersObj).map(key => ({ id: key, ...playersObj[key] }));

  if (players.length === 0) throw new Error("لا يوجد لاعبين");

  // 1. جمع الأدوار المختارة من الصور فقط (تجاهل القيم الفارغة في الخانات)
  const roles = [];
  
  // إضافة الأدوار من الصور المختارة أولاً
  selectedRoles.forEach(r => {
    roles.push({ name: r.name, imageUrl: r.imageUrl || "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png" });
  });

  // 2. إذا كان عدد الأدوار المختارة أقل من عدد اللاعبين، نكمل النقص من خانات الذئاب والقرويين
  const remaining = players.length - roles.length;
  if (remaining > 0) {
    // توزيع المتبقي بناءً على النسبة المحددة في الخانات
    for (let i = 0; i < wolvesCount && roles.length < players.length; i++) {
        roles.push({ name: "ذئب", imageUrl: "https://i.postimg.cc/MpdMDrSv/FB-IMG-1751654961583.jpg" });
    }
    for (let i = 0; i < villagersCount && roles.length < players.length; i++) {
        roles.push({ name: "قروي", imageUrl: "https://i.postimg.cc/wBjJYYVX/Carte-Simple-Villaegois.png" });
    }
  }

  // 3. التحقق النهائي
  if (players.length !== roles.length) {
    throw new Error(`عدد الأدوار الكلي (${roles.length}) لا يساوي عدد اللاعبين (${players.length}).`);
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
}
