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

const menuPrincipal = () => Markup.inlineKeyboard([
  [Markup.button.callback('🛍️ Tienda','menu_tienda'), Markup.button.callback('🛒 Carrito','ver_carrito')],
  [Markup.button.callback('🤖 Chatbot','menu_chatbot'), Markup.button.callback('📦 Módulos','ver_modulos')],
]);

async function getOrCreateTopic(userId, userName){
  const ref = doc(db, "topics", String(userId));
  const snap = await getDoc(ref);
  if(snap.exists()) return snap.data().topicId;
  try{
    const topic = await bot.telegram.createForumTopic(LOG_GROUP_ID, `${userName}`.substring(0,80));
    await setDoc(ref, { userId: String(userId), userName, topicId: topic.message_thread_id, creado: new Date().toISOString() });
    await bot.telegram.sendMessage(LOG_GROUP_ID, `👤 Nuevo: ${userName}\nID: ${userId}`, {message_thread_id: topic.message_thread_id});
    return topic.message_thread_id;
  }catch(e){ console.log('Error topic', e.message); return null; }
}

bot.command('guardar', async (ctx) => {
  if(String(ctx.chat.id)!==String(LOG_GROUP_ID)) return;
  const keyword = ctx.message.text.split(' ')[1]?.toLowerCase();
  if(!keyword) return ctx.reply('Uso:\n1. Reenvía un mensaje de tu canal -1004406033994 aquí\n2. Respóndele con: /guardar hola');
  if(!ctx.message.reply_to_message) return ctx.reply('⚠️ Responde a un mensaje reenviado del canal');
  const fwd = ctx.message.reply_to_message;
  const realMsgId = fwd.forward_from_message_id || fwd.message_id;
  const realChannelId = fwd.forward_from_chat?.id || CANAL_ID;
  await setDoc(doc(db,"respuestas_canal", keyword), { keyword, channelId: realChannelId, messageId: realMsgId, vista: fwd.text||fwd.caption||'media' });
  ctx.reply(`✅ ¡Guardado jefa!\n🔑 Palabra: "${keyword}"\n📨 ID Mensaje: ${realMsgId}\n\nAhora escribe "${keyword}" desde otra cuenta para probar`);
});

bot.command('ver_respuestas', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const snap = await getDocs(collection(db,"respuestas_canal"));
  let t='📦 Respuestas premium guardadas:\n\n'; snap.forEach(d=> t+= `• ${d.id} → msg ${d.data().messageId}\n`);
  ctx.reply(t||'Vacío');
});

bot.command('borrar_respuesta', async (ctx) => {
  if(!isAdmin(ctx.from.id)) return;
  const k = ctx.message.text.split(' ')[1]?.toLowerCase();
  await deleteDoc(doc(db,"respuestas_canal", k)); ctx.reply(`🗑️ Borrado ${k}`);
});

const bienvenidaScene = new Scenes.WizardScene('set_bienvenida',
  (ctx) => { ctx.reply('Envía tu bienvenida con {nombre} /cancelar'); return ctx.wizard.next(); },
  async (ctx) => { await setDoc(doc(db, "config", "bienvenida"), {texto: ctx.message.text, entidades: ctx.message.entities||[]}); ctx.reply(`✅ Guardada`); return ctx.scene.leave(); }
);
const stage = new Scenes.Stage([bienvenidaScene]);
bot.use(session()); bot.use(stage.middleware());

bot.start(async (ctx) => {
  if(isAdmin(ctx.from.id)) return ctx.reply(`👑 Hola jefa ${ctx.from.first_name}`, menuPrincipal());
  try{
    let texto=`Hola {nombre} bienvenida ✨`; let entidades=[];
    const snap=await getDoc(doc(db,"config","bienvenida"));
    if(snap.exists()){ texto=snap.data().texto; entidades=snap.data().entidades||[]; }
    const finalTexto = texto.replace('{nombre}', ctx.from.first_name);
    try{ await ctx.reply(finalTexto, {entities: entidades,...menuPrincipal()}); }catch{ await ctx.reply(finalTexto, menuPrincipal()); }
    const topicId = await getOrCreateTopic(ctx.from.id, `${ctx.from.first_name} ${ctx.from.last_name||''}`.trim());
    if(topicId) await bot.telegram.sendMessage(LOG_GROUP_ID, `💬 /start de ${ctx.from.first_name}`, {message_thread_id: topicId});
  }catch(e){ console.log(e); }
});

bot.on('business_message', async (ctx) => {
  try{
    const msg = ctx.businessMessage || ctx.message; const clienteId = msg.from.id;
    if(isAdmin(clienteId)) return;
    const topicId = await getOrCreateTopic(clienteId, `${msg.from.first_name||'Cliente'}`);
    if(!topicId) return;
    await bot.telegram.sendMessage(LOG_GROUP_ID, `💼 Business ${msg.from.first_name}:\n${msg.text||'media'}`, {message_thread_id: topicId});
  }catch(e){ console.log(e); }
});

bot.command('r', async (ctx) => {
  if(String(ctx.chat.id)!==String(LOG_GROUP_ID)) return; if(!isAdmin(ctx.from.id)) return;
  const threadId=ctx.message.message_thread_id; if(!threadId) return ctx.reply('Dentro del tema');
  const texto=ctx.message.text.replace('/r','').trim(); if(!texto) return ctx.reply('Uso: /r Hola');
  const snap=await getDocs(collection(db,"topics")); let userFound=null; snap.forEach(d=>{ if(d.data().topicId===threadId) userFound=d.data(); });
  if(!userFound) return ctx.reply('No encontré usuario');
  try{ await bot.telegram.sendMessage(Number(userFound.userId), texto); await ctx.reply(`✅ Enviado a ${userFound.userName}`); await bot.telegram.sendMessage(LOG_GROUP_ID, `👩‍💼 Tú: ${texto}`, {message_thread_id: threadId}); }catch(e){ ctx.reply(`❌ ${e.message}`); }
});

bot.on('text', async (ctx) => {
  if(String(ctx.chat.id)===String(LOG_GROUP_ID)) return;
  if(isAdmin(ctx.from.id) && ctx.message.text.startsWith('/')) return; if(isAdmin(ctx.from.id)) return;
  const textoUsuario = ctx.message.text.toLowerCase();
  const topicId = await getOrCreateTopic(ctx.from.id, `${ctx.from.first_name} ${ctx.from.last_name||''}`.trim());
  if(!topicId) return;
  await bot.telegram.sendMessage(LOG_GROUP_ID, `💬 ${ctx.from.first_name}:\n${ctx.message.text}`, {message_thread_id: topicId}).catch(()=>{});
  const snap = await getDocs(collection(db,"respuestas_canal"));
  for(const d of snap.docs){
    if(textoUsuario.includes(d.data().keyword.toLowerCase())){
      const data = d.data();
      try{
        await bot.telegram.copyMessage(ctx.chat.id, data.channelId, data.messageId);
        await bot.telegram.sendMessage(LOG_GROUP_ID, `🤖 Auto canal: ${d.id}`, {message_thread_id: topicId}).catch(()=>{});
      }catch(e){ ctx.reply('❌ Error: bot no es admin del canal'); }
      return;
    }
  }
});

bot.command('menu', (ctx) => ctx.reply('Menú:', menuPrincipal()));
bot.command('set_bienvenida', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('set_bienvenida'); });
bot.command('cancelar', (ctx) => { ctx.scene.leave(); ctx.reply('Cancelado'); });
bot.action('menu_principal', (ctx) => { ctx.answerCbQuery(); ctx.reply('Menú:', menuPrincipal()); });
bot.action('menu_tienda', (ctx) => { ctx.answerCbQuery(); ctx.reply('🛍️ Tienda pronto', menuPrincipal()); });
bot.action('ver_carrito', (ctx) => { ctx.answerCbQuery(); ctx.reply('🛒 Vacío', menuPrincipal()); });
bot.action('menu_chatbot', (ctx) => { ctx.answerCbQuery(); ctx.reply('🤖 Panel', Markup.inlineKeyboard([[Markup.button.callback('📦 Ver respuestas','ver_resp'), Markup.button.callback('✨ Bienvenida','set_bien')], [Markup.button.callback('⬅️','menu_principal')]])); });
bot.action('ver_resp', async (ctx) => { const snap = await getDocs(collection(db,"respuestas_canal")); let t='📦 Guardadas:\n'; snap.forEach(d=> t+=`• ${d.id}\n`); ctx.answerCbQuery(); ctx.reply(t); });
bot.action('set_bien', (ctx) => { ctx.answerCbQuery(); ctx.scene.enter('set_bienvenida'); });

await bot.telegram.deleteWebhook({drop_pending_updates:true}).catch(()=>{});
bot.launch().then(()=> console.log('✅ V6.0 CANAL -1004406033994 ON'));
const app=express(); app.get('/', (req,res)=>res.send('V6 ON')); app.listen(process.env.PORT||3000);
