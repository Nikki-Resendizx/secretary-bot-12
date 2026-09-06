import 'dotenv/config';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, collection, getDocs, getDoc, deleteDoc } from "firebase/firestore";
import express from 'express';

const firebaseConfig = {
  apiKey: "AIzaSyD9fKpBkjz16SVYXudikBSpGzNYx8rqaOQ",
  authDomain: "secretary-bot-12.firebaseapp.com",
  projectId: "secretary-bot-12",
  storageBucket: "secretary-bot-12.firebasestorage.app",
  messagingSenderId: "327812270237",
  appId: "1:327812270237:web:9eab914541c1f0ac0b6c74"
};
const appFb = getApps().length === 0? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(appFb);
const bot = new Telegraf(process.env.BOT_TOKEN);

const ADMIN_IDS = [Number(process.env.ADMIN_ID),...(process.env.ADMIN_IDS? process.env.ADMIN_IDS.split(',').map(n=>Number(n.trim())) : [])];
const isAdmin = (id) => ADMIN_IDS.includes(id);
const LOG_GROUP_ID = -1003947557816;
const CANAL_ID = -1004406033994;

// === FUNCIONES TEMAS ===
async function getOrCreateTopic(userId, userName){
  const ref = doc(db, "topics", String(userId));
  const snap = await getDoc(ref);
  if(snap.exists()) return snap.data().topicId;
  try{
    const topic = await bot.telegram.createForumTopic(LOG_GROUP_ID, `${userName}`.substring(0,80));
    await setDoc(ref, { userId: String(userId), userName, topicId: topic.message_thread_id, creado: new Date().toISOString() });
    return topic.message_thread_id;
  }catch(e){ return null; }
}

// === MÓDULO MENÚS ===
async function mostrarMenu(ctx, menuId){
  const ref = doc(db, "menus", menuId.toLowerCase());
  const snap = await getDoc(ref);
  if(!snap.exists()){
    // si no existe y es principal, muestra el default
    if(menuId==='principal'){
      return ctx.reply('👋 Menú Principal\n\nUsa /crear_menu para crear tu primer menú',
        Markup.inlineKeyboard([[Markup.button.callback('🛍️ Tienda','menu_tienda')]]));
    }
    return ctx.reply('❌ Menú no encontrado');
  }
  const data = snap.data();
  let botones = [];
  if(data.botones && data.botones.length>0){
    // 2 botones por fila
    for(let i=0;i<data.botones.length;i+=2){
      let fila = [];
      fila.push(Markup.button.callback(data.botones[i].texto, `nav_${data.botones[i].valor}`));
      if(data.botones[i+1]) fila.push(Markup.button.callback(data.botones[i+1].texto, `nav_${data.botones[i+1].valor}`));
      botones.push(fila);
    }
  }
  // Botón volver si no es principal
  if(menuId!=='principal' && data.parent!=='principal'){
    botones.push([Markup.button.callback('⬅️ Volver','nav_principal')]);
  }
  try{
    // Intenta copiar del canal si tiene mensaje premium
    if(data.canalMsgId){
      await bot.telegram.copyMessage(ctx.chat.id, CANAL_ID, data.canalMsgId, {reply_markup: {inline_keyboard: botones}});
    }else{
      await ctx.reply(data.texto, Markup.inlineKeyboard(botones));
    }
  }catch(e){ await ctx.reply(data.texto, Markup.inlineKeyboard(botones)); }
}

// SCENES
const crearMenuScene = new Scenes.WizardScene('crear_menu',
  async (ctx) => {
    ctx.wizard.state.menuId = ctx.message.text.split(' ')[1]?.toLowerCase();
    if(!ctx.wizard.state.menuId) return ctx.reply('Uso: /crear_menu nombre\nEj: /crear_menu tienda'), ctx.scene.leave();
    await ctx.reply(`📝 Escribe el texto para el menú "${ctx.wizard.state.menuId}":\n\nPuedes usar emojis premium, los copiaré del canal después.\n/cancelar para salir`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    const texto = ctx.message.text;
    const menuId = ctx.wizard.state.menuId;
    await setDoc(doc(db,"menus", menuId), { id: menuId, texto, botones:[], parent: menuId==='principal'? null : 'principal', creado: new Date().toISOString() });
    await ctx.reply(`✅ Menú "${menuId}" creado!\n\nAhora agrega botones con:\n/agregar_boton ${menuId} | Texto | submenu | id_destino\n\nEjemplo:\n/agregar_boton ${menuId} | 👗 Ropa | submenu | ropa`);
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([crearMenuScene]);
bot.use(session()); bot.use(stage.middleware());

// COMANDOS MENÚ
bot.command('crear_menu', (ctx) => { if(!isAdmin(ctx.from.id)) return; ctx.scene.enter('crear_menu'); });
bot.command('ver_menus', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const snap = await getDocs(collection(db,"menus"));
  let t='📂 Tus menús:\n\n'; snap.forEach(d=>{ const b=d.data().botones?.length||0; t+=`• ${d.id} (${b} botones) - ${d.data().texto.substring(0,30)}...\n`; });
  ctx.reply(t||'Vacío, usa /crear_menu principal');
});
bot.command('borrar_menu', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const id = ctx.message.text.split(' ')[1]?.toLowerCase();
  if(!id) return ctx.reply('Uso: /borrar_menu tienda');
  await deleteDoc(doc(db,"menus", id)); ctx.reply(`🗑️ Menú ${id} borrado`);
});
bot.command('agregar_boton', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  // formato: /agregar_boton tienda | Ropa | submenu | ropa
  const args = ctx.message.text.replace('/agregar_boton','').split('|').map(s=>s.trim());
  if(args.length<4) return ctx.reply('Uso:\n/agregar_boton menu_origen | Texto boton | submenu | menu_destino\n\nEj:\n/agregar_boton principal | 🛍️ Tienda | submenu | tienda\n/agregar_boton tienda | ⬅️ Volver | submenu | principal');
  const [origen, textoBtn, tipo, destino] = args;
  const ref = doc(db,"menus", origen.toLowerCase());
  const snap = await getDoc(ref);
  if(!snap.exists()) return ctx.reply(`❌ Menú origen "${origen}" no existe`);
  const data = snap.data();
  const botones = data.botones||[];
  botones.push({ texto: textoBtn, tipo, valor: destino.toLowerCase() });
  await setDoc(ref, {...data, botones}, {merge:true});
  ctx.reply(`✅ Botón agregado a "${origen}":\n${textoBtn} → ${destino}`);
});
bot.command('vincular_canal', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  // /vincular_canal tienda -> responde a mensaje reenviado del canal
  const menuId = ctx.message.text.split(' ')[1]?.toLowerCase();
  if(!menuId) return ctx.reply('Uso: reenvía msg del canal aquí y responde /vincular_canal tienda');
  if(!ctx.message.reply_to_message) return ctx.reply('Responde a un mensaje reenviado del canal');
  const fwd = ctx.message.reply_to_message;
  const realMsgId = fwd.forward_from_message_id || fwd.message_id;
  const ref = doc(db,"menus", menuId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return ctx.reply('Menú no existe');
  await setDoc(ref, {canalMsgId: realMsgId}, {merge:true});
  ctx.reply(`✨ Menú "${menuId}" vinculado a mensaje premium ${realMsgId} del canal`);
});

// COMANDOS CANAL PREMIUM (ya los tenías)
bot.command('guardar', async (ctx) => {
  if(String(ctx.chat.id)!==String(LOG_GROUP_ID)) return;
  const keyword = ctx.message.text.split(' ')[1]?.toLowerCase();
  if(!keyword) return ctx.reply('Uso: /guardar hola');
  if(!ctx.message.reply_to_message) return ctx.reply('Responde a msg del canal');
  const fwd = ctx.message.reply_to_message;
  const realMsgId = fwd.forward_from_message_id || fwd.message_id;
  await setDoc(doc(db,"respuestas_canal", keyword), { keyword, channelId: CANAL_ID, messageId: realMsgId });
  ctx.reply(`✅ Guardado ${keyword} → ${realMsgId}`);
});
bot.command('r', async (ctx) => {
  if(String(ctx.chat.id)!==String(LOG_GROUP_ID)) return; if(!isAdmin(ctx.from.id)) return;
  const threadId=ctx.message.message_thread_id; if(!threadId) return;
  const texto=ctx.message.text.replace('/r','').trim();
  const snap=await getDocs(collection(db,"topics")); let userFound=null; snap.forEach(d=>{ if(d.data().topicId===threadId) userFound=d.data(); });
  if(!userFound) return;
  try{ await bot.telegram.sendMessage(Number(userFound.userId), texto); await ctx.reply(`✅ Enviado`); }catch(e){ ctx.reply(e.message); }
});

// NAVEGACIÓN
bot.action(/nav_(.+)/, async (ctx) => {
  const destino = ctx.match[1];
  ctx.answerCbQuery();
  // Si es una respuesta del canal
  const snapCanal = await getDoc(doc(db,"respuestas_canal", destino));
  if(snapCanal.exists()){
    const d = snapCanal.data();
    await bot.telegram.copyMessage(ctx.chat.id, d.channelId, d.messageId).catch(()=>{});
    return;
  }
  // Si es un menú
  await mostrarMenu(ctx, destino);
});

bot.start(async (ctx) => {
  if(isAdmin(ctx.from.id)) return ctx.reply(`👑 Hola jefa\nUsa /ver_menus /crear_menu`, Markup.inlineKeyboard([[Markup.button.callback('📂 Ver menús','ver_menus_btn')]]));
  await mostrarMenu(ctx, 'principal');
  const topicId = await getOrCreateTopic(ctx.from.id, `${ctx.from.first_name}`);
  if(topicId) await bot.telegram.sendMessage(LOG_GROUP_ID, `💬 /start ${ctx.from.first_name}`, {message_thread_id: topicId}).catch(()=>{});
});
bot.action('ver_menus_btn', async (ctx) => { const snap = await getDocs(collection(db,"menus")); let t='📂 Menús:\n'; snap.forEach(d=> t+=`• ${d.id}\n`); ctx.answerCbQuery(); ctx.reply(t); });
bot.command('menu', (ctx) => mostrarMenu(ctx, 'principal'));
bot.on('text', async (ctx) => {
  if(String(ctx.chat.id)===String(LOG_GROUP_ID)) return;
  if(isAdmin(ctx.from.id) && ctx.message.text.startsWith('/')) return; if(isAdmin(ctx.from.id)) return;
  const topicId = await getOrCreateTopic(ctx.from.id, `${ctx.from.first_name}`);
  if(topicId) await bot.telegram.sendMessage(LOG_GROUP_ID, `💬 ${ctx.from.first_name}:\n${ctx.message.text}`, {message_thread_id: topicId}).catch(()=>{});
  const snap = await getDocs(collection(db,"respuestas_canal"));
  for(const d of snap.docs){
    if(ctx.message.text.toLowerCase().includes(d.data().keyword.toLowerCase())){
      const data = d.data(); await bot.telegram.copyMessage(ctx.chat.id, data.channelId, data.messageId).catch(()=>{}); return;
    }
  }
});

await bot.telegram.deleteWebhook({drop_pending_updates:true}).catch(()=>{});
bot.launch().then(()=> console.log('✅ V7.0 MENÚS ON'));
const app=express(); app.get('/', (req,res)=>res.send('V7 ON')); app.listen(process.env.PORT||3000);
