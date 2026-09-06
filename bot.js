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

const menuPrincipal = () => Markup.inlineKeyboard([
  [Markup.button.callback('🛍️ Tienda','menu_tienda'), Markup.button.callback('🛒 Carrito','ver_carrito')],
  [Markup.button.callback('🤖 Chatbot','menu_chatbot'), Markup.button.callback('📦 Módulos','ver_modulos')],
  [Markup.button.callback('✨ Bienvenida','ver_bienvenida')]
]);

async function getOrCreateTopic(userId, userName){
  const ref = doc(db, "topics", String(userId));
  const snap = await getDoc(ref);
  if(snap.exists()) return snap.data().topicId;
  try{
    const topic = await bot.telegram.createForumTopic(LOG_GROUP_ID, `${userName}`.substring(0,100));
    await setDoc(ref, { userId: String(userId), userName, topicId: topic.message_thread_id, creado: new Date().toISOString() });
    await bot.telegram.sendMessage(LOG_GROUP_ID, `👤 Nuevo chat de: ${userName}\nID: ${userId}\nUsa /r tu mensaje para responder`, {message_thread_id: topic.message_thread_id});
    return topic.message_thread_id;
  }catch(e){ console.log('Error topic:', e.message); return 1; }
}

const bienvenidaScene = new Scenes.WizardScene('set_bienvenida',
  (ctx) => { if(!isAdmin(ctx.from.id)) return ctx.scene.leave(); ctx.reply('✨ Envía tu bienvenida con {nombre} y emojis premium\n/cancelar'); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text||''; const entidades = ctx.message.entities||[];
    await setDoc(doc(db, "config", "bienvenida"), {texto, entidades});
    ctx.reply(`✅ Guardada! Vista previa:`);
    try{ await ctx.reply(texto.replace('{nombre}', ctx.from.first_name), {entities: entidades,...menuPrincipal()}); }
    catch{ await ctx.reply(texto.replace('{nombre}', ctx.from.first_name), menuPrincipal()); }
    return ctx.scene.leave();
  }
);
const respuestaScene = new Scenes.WizardScene('crear_respuesta',
  (ctx) => { if(!isAdmin(ctx.from.id)) return ctx.scene.leave(); ctx.reply('Palabra clave: /cancelar'); return ctx.wizard.next(); },
  (ctx) => { ctx.wizard.state.trigger = ctx.message.text.toLowerCase(); ctx.reply(`Respuesta para "${ctx.wizard.state.trigger}" con premium:`); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text||''; const entidades = ctx.message.entities||[];
    await setDoc(doc(db, "respuestas", ctx.wizard.state.trigger), {trigger: ctx.wizard.state.trigger, texto, entidades});
    ctx.reply(`✅ Respuesta "${ctx.wizard.state.trigger}" creada`, menuPrincipal()); return ctx.scene.leave();
  }
);
const moduloScene = new Scenes.WizardScene('crear_modulo',
  (ctx) => { if(!isAdmin(ctx.from.id)) return ctx.scene.leave(); ctx.reply('Nombre módulo:'); return ctx.wizard.next(); },
  (ctx) => { ctx.wizard.state.nombre = ctx.message.text.toLowerCase().replace(/\s/g,'_'); ctx.reply(`Mensaje para "${ctx.wizard.state.nombre}":`); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text||''; const entidades = ctx.message.entities||[];
    await setDoc(doc(db, "modulos", ctx.wizard.state.nombre), {nombre: ctx.wizard.state.nombre, texto, entidades});
    ctx.reply(`✅ Módulo ${ctx.wizard.state.nombre}`, menuPrincipal()); return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([respuestaScene, moduloScene, bienvenidaScene]);
bot.use(session());
bot.use(stage.middleware());

bot.start(async (ctx) => {
  try{
    let texto=`Hola {nombre} bienvenida ✨`; let entidades=[];
    const snap=await getDoc(doc(db,"config","bienvenida"));
    if(snap.exists()){ texto=snap.data().texto; entidades=snap.data().entidades||[]; }
    const finalTexto = texto.replace('{nombre}', ctx.from.first_name);
    try{
      await ctx.reply(finalTexto, {entities: entidades,...menuPrincipal()});
    }catch(err){
      console.log('Error bienvenida con estilos, enviando sin estilos:', err.message);
      await ctx.reply(finalTexto, menuPrincipal());
    }
  }catch(e){
    await ctx.reply(`Hola ${ctx.from.first_name} bienvenida ✨`, menuPrincipal());
  }
});

bot.command('menu', (ctx) => ctx.reply('Menú:', menuPrincipal()));
bot.command('admins', (ctx) => { if(isAdmin(ctx.from.id)) ctx.reply(`👑 ADMINS: ${ADMIN_IDS.join(', ')}\nLOG: ${LOG_GROUP_ID}\nTú: ${ctx.from.id}`); });
bot.command('set_bienvenida', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('set_bienvenida'); });
bot.command('reset_bienvenida', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  await deleteDoc(doc(db,"config","bienvenida")).catch(()=>{});
  ctx.reply('🗑️ Bienvenida borrada, ya arranca el bot', menuPrincipal());
});
bot.command('ver_bienvenida', async (ctx) => {
  const snap=await getDoc(doc(db,"config","bienvenida"));
  if(!snap.exists()) return ctx.reply('No hay personalizada', menuPrincipal());
  try{ await ctx.reply(`Actual: ${snap.data().texto}`, {entities: snap.data().entidades,...menuPrincipal()}); }
  catch{ await ctx.reply(`Actual: ${snap.data().texto}`, menuPrincipal()); }
});
bot.command('crear_respuesta', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('crear_respuesta'); });
bot.command('crear_modulo', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('crear_modulo'); });
bot.command('respuestas', async (ctx) => { const snap=await getDocs(collection(db,"respuestas")); let t='🤖 Respuestas:\n'; snap.forEach(d=>t+=`• ${d.id}\n`); ctx.reply(t||'Vacío', menuPrincipal()); });
bot.command('borrar_respuesta', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const k=ctx.message.text.split(' ')[1]?.toLowerCase(); if(!k) return ctx.reply('Uso: /borrar_respuesta hola');
  await deleteDoc(doc(db,"respuestas",k)); ctx.reply(`🗑️ Borrada "${k}"`, menuPrincipal());
});
bot.command('modulos', async (ctx) => { const snap=await getDocs(collection(db,"modulos")); let t='📦 Módulos:\n'; snap.forEach(d=>t+=`• ${d.id}\n`); ctx.reply(t); });

bot.action('menu_principal', (ctx) => { ctx.answerCbQuery(); ctx.reply('Menú:', menuPrincipal()); });
bot.action('menu_tienda', (ctx) => { ctx.answerCbQuery(); ctx.reply('🛍️ Tienda próximamente', menuPrincipal()); });
bot.action('ver_carrito', (ctx) => { ctx.answerCbQuery(); ctx.reply('🛒 Carrito vacío', menuPrincipal()); });
bot.action('menu_chatbot', (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  ctx.answerCbQuery();
  ctx.reply('🤖 Panel Chatbot:', Markup.inlineKeyboard([
    [Markup.button.callback('➕ Crear Respuesta','crear_resp'), Markup.button.callback('📋 Ver Respuestas','list_resp')],
    [Markup.button.callback('✨ Cambiar Bienvenida','set_bien'), Markup.button.callback('🗑️ Reset Bienvenida','reset_bien'), Markup.button.callback('⬅️ Principal','menu_principal')]
  ]));
});
bot.action('crear_resp', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('crear_respuesta'); });
bot.action('set_bien', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('set_bienvenida'); });
bot.action('reset_bien', async (ctx) => { await deleteDoc(doc(db,"config","bienvenida")).catch(()=>{}); ctx.answerCbQuery(); ctx.reply('🗑️ Bienvenida borrada'); });
bot.action('list_resp', async (ctx) => { const snap=await getDocs(collection(db,"respuestas")); let t='Respuestas:\n'; snap.forEach(d=>t+=`• ${d.id}\n`); ctx.reply(t||'Vacío'); ctx.answerCbQuery(); });
bot.action('ver_modulos', async (ctx) => {
  ctx.answerCbQuery();
  const snap=await getDocs(collection(db,"modulos")); const btns=[]; snap.forEach(d=>btns.push([Markup.button.callback(d.id, `sendmod_${d.id}`)]));
  btns.push([Markup.button.callback('⬅️','menu_principal')]);
  ctx.reply('📦 Tus módulos:', Markup.inlineKeyboard(btns));
});
bot.action(/^sendmod_/, async (ctx) => {
  const snap=await getDoc(doc(db,"modulos", ctx.callbackQuery.data.replace('sendmod_',''))); if(!snap.exists()) return;
  const data=snap.data();
  try{ await ctx.reply(data.texto, {entities: data.entidades}); }catch{ await ctx.reply(data.texto); }
  ctx.answerCbQuery();
});
bot.action('ver_bienvenida', async (ctx) => {
  ctx.answerCbQuery();
  const snap=await getDoc(doc(db,"config","bienvenida"));
  if(!snap.exists()) return ctx.reply('No hay bienvenida', menuPrincipal());
  try{ await ctx.reply(snap.data().texto, {entities: snap.data().entidades,...menuPrincipal()}); }
  catch{ await ctx.reply(snap.data().texto, menuPrincipal()); }
});

bot.on('business_connection', async (ctx) => {
  const conn=ctx.businessConnection;
  await setDoc(doc(db,"business",conn.id), {id: conn.id, userId: conn.user.id, fecha: new Date().toISOString()});
  await bot.telegram.sendMessage(LOG_GROUP_ID, `✅ Cuenta conectada: ${conn.user.first_name} ID:${conn.user.id}\nConn: ${conn.id}`);
});

bot.on('business_message', async (ctx) => {
  const msg=ctx.businessMessage; const connId=ctx.businessConnectionId;
  if(!msg || msg.from.is_bot) return;
  const userId=msg.from.id; const userName=msg.from.first_name;
  const textoUsuario=msg.text||'[Archivo]';
  const topicId=await getOrCreateTopic(userId, userName);
  await bot.telegram.sendMessage(LOG_GROUP_ID, `💬 ${userName} (@${msg.from.username||'no user'}) ID:${userId}\n📩 ${textoUsuario}`, {message_thread_id: topicId}).catch(()=>{});
  const snap=await getDocs(collection(db,"respuestas"));
  for(const d of snap.docs){
    if(textoUsuario.toLowerCase().includes(d.data().trigger.toLowerCase())){
      try{
        const data=d.data();
        try{ await ctx.telegram.sendMessage(msg.chat.id, data.texto, {entities: data.entidades, business_connection_id: connId}); }
        catch{ await ctx.telegram.sendMessage(msg.chat.id, data.texto, {business_connection_id: connId}); }
        await bot.telegram.sendMessage(LOG_GROUP_ID, `🤖 Auto-respuesta a ${userName}: ${data.texto}`, {message_thread_id: topicId});
      }catch(e){} return;
    }
  }
});

bot.command('r', async (ctx) => {
  if(String(ctx.chat.id)!==String(LOG_GROUP_ID)) return;
  if(!isAdmin(ctx.from.id)) return;
  const threadId=ctx.message.message_thread_id;
  if(!threadId) return ctx.reply('Usa /r DENTRO del tema del usuario');
  const texto=ctx.message.text.replace('/r','').trim(); if(!texto) return ctx.reply('Uso: /r Hola guapa ✨');
  const snap=await getDocs(collection(db,"topics")); let userFound=null;
  snap.forEach(d=>{ if(d.data().topicId===threadId) userFound=d.data(); });
  if(!userFound) return ctx.reply('No encontré usuario de este tema.');
  const bizSnap=await getDocs(collection(db,"business"));
  if(bizSnap.empty) return ctx.reply('❌ No hay cuentas conectadas. Reconecta en Ajustes > Telegram Business > Chatbots');
  const lastConn=bizSnap.docs[0].data();
  try{
    await bot.telegram.sendMessage(Number(userFound.userId), texto, {business_connection_id: lastConn.id});
    await ctx.reply(`✅ Enviado a ${userFound.userName}`);
    await bot.telegram.sendMessage(LOG_GROUP_ID, `👩‍💼 Tú: ${texto}`, {message_thread_id: threadId});
  }catch(e){ ctx.reply(`❌ Error: ${e.message}`); }
});

bot.on('text', async (ctx, next) => {
  if(ctx.message.text.startsWith('/')) return next();
  if(String(ctx.chat.id)===String(LOG_GROUP_ID)) return;
  const snap=await getDocs(collection(db,"respuestas"));
  for(const d of snap.docs){
    if(ctx.message.text.toLowerCase().includes(d.data().trigger.toLowerCase())){
      try{ await ctx.reply(d.data().texto, {entities: d.data().entidades}); }
      catch{ await ctx.reply(d.data().texto); }
      break;
    }
  }
  return next();
});

bot.command('cancelar', (ctx) => { ctx.scene.leave().catch(()=>{}); ctx.reply('Cancelado', menuPrincipal()); });
bot.catch((err)=> console.log('Bot error:', err.message));

await bot.telegram.deleteWebhook({drop_pending_updates:true}).catch(()=>{});
bot.launch().then(()=> console.log('✅ V5.2 FIX ESTILOS NUEVOS + TOPICS'));
const app=express(); app.get('/', (req,res)=>res.send('V5.2 ON')); app.listen(process.env.PORT||3000);
