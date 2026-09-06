import 'dotenv/config';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, getDocs, getDoc, collection, deleteDoc } from "firebase/firestore";
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
const LOG_GROUP_ID = Number(process.env.LOG_GROUP_ID); // -1003947557816

// Guardar conexiones de negocio
let businessConnections = {};

async function getOrCreateTopic(userId, userName){
  const ref = doc(db, "topics", String(userId));
  const snap = await getDoc(ref);
  if(snap.exists()) return snap.data().topicId;

  try{
    const topic = await bot.telegram.createForumTopic(LOG_GROUP_ID, `${userName} | ${userId}`);
    await setDoc(ref, { userId, userName, topicId: topic.message_thread_id, creado: new Date().toISOString() });
    return topic.message_thread_id;
  }catch(e){ console.log('Error creando topic', e.message); return null; }
}

async function logToTopic(userId, userName, texto, threadId=null){
  if(!LOG_GROUP_ID) return null;
  const topicId = threadId || await getOrCreateTopic(userId, userName);
  if(!topicId) return null;
  try{
    await bot.telegram.sendMessage(LOG_GROUP_ID, texto, {message_thread_id: topicId});
  }catch(e){ console.log('log error', e.message)}
  return topicId;
}

// ESCENAS
const bienvenidaScene = new Scenes.WizardScene('set_bienvenida',
  (ctx) => { if(!isAdmin(ctx.from.id)) return ctx.scene.leave(); ctx.reply('✨ Envía tu mensaje de bienvenida con {nombre} y emojis premium\n/cancelar'); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text||''; const entidades = ctx.message.entities||[];
    await setDoc(doc(db, "config", "bienvenida"), {texto, entidades});
    ctx.reply('✅ Guardada!'); return ctx.scene.leave();
  }
);
const respuestaScene = new Scenes.WizardScene('crear_respuesta',
  (ctx) => { if(!isAdmin(ctx.from.id)) return ctx.scene.leave(); ctx.reply('Palabra clave:'); return ctx.wizard.next(); },
  (ctx) => { ctx.wizard.state.trigger = ctx.message.text.toLowerCase(); ctx.reply(`Respuesta para "${ctx.wizard.state.trigger}":`); return ctx.wizard.next(); },
  async (ctx) => {
    const texto = ctx.message.text||''; const entidades = ctx.message.entities||[];
    await setDoc(doc(db, "respuestas", ctx.wizard.state.trigger), {trigger: ctx.wizard.state.trigger, texto, entidades});
    ctx.reply('✅ Creada'); return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([respuestaScene, bienvenidaScene]);
bot.use(session());
bot.use(stage.middleware());

// --- 1. MANEJO DE CONEXIONES BUSINESS (tus 3 cuentas) ---
bot.on('business_connection', async (ctx) => {
  const conn = ctx.businessConnection;
  businessConnections[conn.id] = conn;
  await setDoc(doc(db, "business", conn.id), {id: conn.id, userId: conn.user.id, username: conn.user.username, fecha: new Date().toISOString()});
  console.log('Nueva conexión business:', conn.id);
  if(LOG_GROUP_ID) bot.telegram.sendMessage(LOG_GROUP_ID, `✅ Nueva cuenta conectada como chatbot:\n${conn.user.first_name} @${conn.user.username||''} ID:${conn.user.id}\nConnection: ${conn.id}`);
});

// --- 2. MENSAJES QUE LLEGAN A TUS 3 CUENTAS PRIVADAS ---
bot.on('business_message', async (ctx) => {
  const msg = ctx.businessMessage;
  const connId = ctx.businessConnectionId;
  if(!msg || msg.from.is_bot) return;

  const userId = msg.from.id;
  const userName = msg.from.first_name;
  const textoUsuario = msg.text || msg.caption || '[Archivo]';

  // 1. Crear/Loguear tema por usuario
  const topicId = await logToTopic(userId, userName, `💬 Nuevo mensaje en cuenta ${ctx.businessConnection?.user?.first_name||connId}\n\n👤 ${userName} (@${msg.from.username||'sin user'}) ID: ${userId}\n📩 Dice: ${textoUsuario}`);

  // 2. Buscar auto-respuesta
  const snap = await getDocs(collection(db, "respuestas"));
  for(const d of snap.docs){
    const data=d.data();
    if(textoUsuario.toLowerCase().includes(data.trigger.toLowerCase())){
      try{
        await ctx.telegram.sendMessage(msg.chat.id, data.texto, {entities: data.entidades, business_connection_id: connId});
        await logToTopic(userId, userName, `🤖 Auto-respuesta enviada (trigger: ${data.trigger}):\n${data.texto}`, topicId);
      }catch(e){ console.log(e.message)}
      return;
    }
  }

  // 3. Si no hay auto-respuesta, bienvenida
  try{
    const bienvSnap = await getDoc(doc(db, "config", "bienvenida"));
    if(bienvSnap.exists()){
      let txt = bienvSnap.data().texto.replace('{nombre}', userName);
      await ctx.telegram.sendMessage(msg.chat.id, txt, {entities: bienvSnap.data().entidades, business_connection_id: connId});
    }
  }catch(e){ console.log(e.message)}
});

// --- 3. COMANDO PARA RESPONDER DESDE EL GRUPO ---
// Uso en el grupo: Responde al tema del usuario con /r Hola guapa ✨ O /responder Hola...
bot.command('r', async (ctx) => {
  if(String(ctx.chat.id)!== String(LOG_GROUP_ID)) return;
  if(!isAdmin(ctx.from.id)) return ctx.reply('⛔ Solo tus 3 cuentas');

  const threadId = ctx.message.message_thread_id;
  if(!threadId) return ctx.reply('⚠️ Usa este comando DENTRO del tema del usuario');

  const textoRespuesta = ctx.message.text.replace('/r','').trim();
  if(!textoRespuesta) return ctx.reply('Escribe: /r tu mensaje');

  // Buscar a que usuario pertenece este topic
  const snap = await getDocs(collection(db, "topics"));
  let userFound = null;
  snap.forEach(d=>{ if(d.data().topicId === threadId) userFound = d.data(); });
  if(!userFound) return ctx.reply('No encontré al usuario de este tema');

  // Buscar una conexión business activa
  const bizSnap = await getDocs(collection(db, "business"));
  if(bizSnap.empty) return ctx.reply('No hay cuentas conectadas');

  try{
    const lastConn = bizSnap.docs[0].data(); // usa la primera, o puedes mejorar para elegir
    await bot.telegram.sendMessage(userFound.userId, textoRespuesta, {business_connection_id: lastConn.id});
    await ctx.reply(`✅ Enviado a ${userFound.userName} (${userFound.userId})`);
    await logToTopic(userFound.userId, userFound.userName, `👩‍💼 Tú respondiste desde el grupo:\n${textoRespuesta}`, threadId);
  }catch(e){ ctx.reply(`❌ Error: ${e.message}\nAsegúrate que el bot sigue conectado como chatbot en tus 3 cuentas`); }
});

bot.command('responder', async (ctx) => {
  // alias de /r
  ctx.message.text = ctx.message.text.replace('responder','r');
  return bot.handleUpdate({...ctx.update, message: ctx.message});
});

// Comandos normales
bot.start(async (ctx) => {
  let txt=`Hola {nombre} ✨`; let ent=[];
  try{ const s=await getDoc(doc(db,"config","bienvenida")); if(s.exists()){ txt=s.data().texto; ent=s.data().entidades; } }catch{}
  ctx.reply(txt.replace('{nombre}', ctx.from.first_name), {entities: ent});
});
bot.command('set_bienvenida', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('set_bienvenida'); });
bot.command('crear_respuesta', (ctx) => { if(isAdmin(ctx.from.id)) ctx.scene.enter('crear_respuesta'); });
bot.command('respuestas', async (ctx) => { const s=await getDocs(collection(db,"respuestas")); let t='Respuestas:\n'; s.forEach(d=>t+=`• ${d.id}\n`); ctx.reply(t); });
bot.command('borrar_respuesta', async (ctx) => { const k=ctx.message.text.split(' ')[1]?.toLowerCase(); if(!k) return ctx.reply('Uso: /borrar_respuesta hola'); await deleteDoc(doc(db,"respuestas",k)); ctx.reply(`Borrada ${k}`); });
bot.command('admins', (ctx) => { if(isAdmin(ctx.from.id)) ctx.reply(`👑 ${ADMIN_IDS.join(', ')} LOG: ${LOG_GROUP_ID}`); });

await bot.telegram.deleteWebhook({drop_pending_updates:true}).catch(()=>{});
bot.launch().then(()=> console.log('✅ V5 BUSINESS + TOPICS + RESPUESTAS RAPIDAS'));
const app = express();
app.get('/', (req,res) => res.send('V5 BUSINESS ON'));
app.listen(process.env.PORT||3000);
