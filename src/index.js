const API = "https://api.telegram.org";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const esc = (s = "") => String(s).replace(/[&&lt;&gt;"]/g, c => ({ "&": "&amp;", "&lt;": "&lt;", "&gt;": "&gt;", '"': "&quot;" }[c]));
async function tg(token, method, body) {
  const r = await fetch(`${API}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function send(env, chatId, text, extra = {}) {
  return tg(env.BOT_TOKEN, "sendMessage", { chat_id: chatId, text, ...extra });
}
async function session(env, userId) {
  const row = await env.DB.prepare("SELECT step, data FROM sessions WHERE telegram_user_id=?").bind(String(userId)).first();
  return row ? { step: row.step, data: JSON.parse(row.data || "{}") } : { step: "idle", data: {} };
}
async function saveSession(env, userId, step, data = {}) {
  await env.DB.prepare("INSERT INTO sessions(telegram_user_id,step,data,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(telegram_user_id) DO UPDATE SET step=excluded.step,data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(String(userId), step, JSON.stringify(data)).run();
}
async function clearSession(env, userId) {
  await env.DB.prepare("DELETE FROM sessions WHERE telegram_user_id=?").bind(String(userId)).run();
}
function keyboard(rows) { return { reply_markup: { inline_keyboard: rows } }; }
function localDate(d, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function dateLabel(date, tz) {
  const d = new Date(date + "T12:00:00Z");
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
}
function minutes(hm) { const [h,m] = hm.split(":").map(Number); return h*60+m; }
function hm(n) { return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0"); }
async function services(env) {
  const { results } = await env.DB.prepare("SELECT id,name,price,duration_minutes FROM services WHERE active=1 ORDER BY id").all();
  return results || [];
}
async function startBooking(env, chatId, userId) {
  const list = await services(env);
  if (!list.length) return send(env, chatId, "Пока нет доступных услуг. Напишите владельцу бизнеса.");
  await saveSession(env, userId, "service", {});
  return send(env, chatId, "Выберите услугу:", keyboard(list.map(s => [{ text: `${s.name} · ${s.price || "цена по запросу"}`, callback_data: `svc:${s.id}` }]).concat([[{ text: "Отмена", callback_data: "cancel" }]])));
}
async function chooseDate(env, chatId, userId, service) {
  const tz = env.TIMEZONE || "Europe/Prague";
  const rows = [];
  for (let i=0;i&lt;8;i++) {
    const d = new Date(Date.now()+i*86400000);
    const date = localDate(d,tz);
    rows.push([{ text: i===0 ? "Сегодня" : i===1 ? "Завтра" : dateLabel(date,tz), callback_data: `day:${date}` }]);
  }
  await saveSession(env,userId,"date",{service});
  return send(env,chatId,"Выберите день:",keyboard(rows.concat([[{text:"Отмена",callback_data:"cancel"}]])));
}
async function chooseTime(env, chatId, userId, data, date) {
  const svc = await env.DB.prepare("SELECT id,name,price,duration_minutes FROM services WHERE id=? AND active=1").bind(data.service).first();
  if (!svc) return send(env,chatId,"Услуга больше недоступна. Начните заново: /book");
  const open = minutes(env.OPEN_TIME || "09:00"), close = minutes(env.CLOSE_TIME || "19:00");
  const step = Math.max(15, Number(env.SLOT_STEP_MINUTES || 30));
  const { results } = await env.DB.prepare("SELECT starts_at,ends_at FROM bookings WHERE substr(starts_at,1,10)=? AND status='confirmed'").bind(date).all();
  const busy = results || [];
  const slots = [];
  for (let t=open;t+svc.duration_minutes&lt;=close;t+=step) {
    const start = `${date}T${hm(t)}:00`;
    const end = `${date}T${hm(t+svc.duration_minutes)}:00`;
    if (!busy.some(b => start &lt; b.ends_at && end &gt; b.starts_at)) slots.push(hm(t));
  }
  if (!slots.length) return send(env,chatId,"На этот день свободного времени нет. Выберите другую дату: /book");
  await saveSession(env,userId,"name",{service:svc.id,date});
  return send(env,chatId,"Свободное время. Выберите удобное:",keyboard(slots.map(t=>[{text:t,callback_data:`time:${t}`}]).concat([[{text:"Отмена",callback_data:"cancel"}]])));
}
async function handleCallback(env, q) {
  const chatId=q.message.chat.id, userId=q.from.id, value=q.data || "";
  await tg(env.BOT_TOKEN,"answerCallbackQuery",{callback_query_id:q.id});
  if (value==="cancel") { await clearSession(env,userId); return send(env,chatId,"Запись отменена. Чтобы начать снова, нажмите /book."); }
  const s=await session(env,userId);
  if (value.startsWith("svc:")) {
    const id=Number(value.slice(4));
    const svc=await env.DB.prepare("SELECT id,name,price,duration_minutes FROM services WHERE id=? AND active=1").bind(id).first();
    if (!svc) return send(env,chatId,"Услуга не найдена. Нажмите /book.");
    return chooseDate(env,chatId,userId,svc.id);
  }
  if (value.startsWith("day:")) return chooseTime(env,chatId,userId,s.data,value.slice(4));
  if (value.startsWith("time:")) {
    const time=value.slice(5);
    await saveSession(env,userId,"name",{...s.data,time});
    return send(env,chatId,"Как вас зовут?");
  }
}
async function ownerCommand(env, msg, command) {
  const chatId=msg.chat.id, owner=String(env.OWNER_ID||"");
  if (!owner || String(msg.from.id)!==owner) return send(env,chatId,"Эта команда доступна только владельцу.");
  if (command==="/today") {
    const today=localDate(new Date(),env.TIMEZONE||"Europe/Prague");
    const {results}=await env.DB.prepare("SELECT id,customer_name,phone,service_name,starts_at,status FROM bookings WHERE substr(starts_at,1,10)=? ORDER BY starts_at").bind(today).all();
    return send(env,chatId,(results||[]).length ? "Записи на сегодня:\n"+results.map(b=>`#${b.id} · ${b.starts_at.slice(11,16)} · ${b.customer_name} · ${b.service_name} · ${b.phone} · ${b.status}`).join("\n") : "На сегодня записей нет.");
  }
  if (command==="/services") {
    const list=await services(env);
    return send(env,chatId,list.map(s=>`#${s.id} ${s.name} — ${s.price}, ${s.duration_minutes} мин.`).join("\n")||"Услуг пока нет.");
  }
  if (msg.text.startsWith("/addservice ")) {
    const parts=msg.text.slice(11).split("|").map(x=>x.trim());
    if (parts.length&lt;3 || !parts[0] || !Number(parts[2])) return send(env,chatId,"Формат: /addservice Название | Цена | Длительность_в_минутах");
    await env.DB.prepare("INSERT INTO services(name,price,duration_minutes) VALUES(?,?,?)").bind(parts[0],parts[1],Number(parts[2])).run();
    return send(env,chatId,"Услуга добавлена.");
  }
  if (msg.text.startsWith("/cancel ")) {
    const id=Number(msg.text.split(/\s+/)[1]);
    if (!id) return send(env,chatId,"Формат: /cancel НОМЕР");
    const r=await env.DB.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed'").bind(id).run();
    return send(env,chatId,r.meta?.changes ? "Запись отменена." : "Активная запись с таким номером не найдена.");
  }
}
async function handleMessage(env,msg) {
  const chatId=msg.chat.id, userId=msg.from.id, text=msg.text||"";
  if (text.startsWith("/start") || text==="/help") return send(env,chatId,`Здравствуйте! Это онлайн-запись в «${env.BUSINESS_NAME||"наш бизнес"}».\n\n/book — записаться\n/help — помощь`);
  if (text==="/book") return startBooking(env,chatId,userId);
  if (text==="/myid") return send(env,chatId,`Ваш Telegram ID: ${userId}`);
  if (text.startsWith("/today") || text.startsWith("/services") || text.startsWith("/addservice") || text.startsWith("/cancel ")) return ownerCommand(env,msg,text.split(" ")[0]);
  const s=await session(env,userId);
  if (s.step==="name") {
    if (text.length&lt;2 || text.length&gt;80) return send(env,chatId,"Напишите имя (от 2 до 80 символов).");
    return saveSession(env,userId,"phone",{...s.data,name:text.trim()}).then(()=>send(env,chatId,"Оставьте номер телефона для подтверждения записи."));
  }
  if (s.step==="phone") {
    const phone=text.trim();
    if (!/^[+()\d\s-]{7,24}$/.test(phone)) return send(env,chatId,"Пожалуйста, отправьте номер телефона в обычном формате.");
    const svc=await env.DB.prepare("SELECT id,name,price,duration_minutes FROM services WHERE id=?").bind(s.data.service).first();
    if (!svc) { await clearSession(env,userId); return send(env,chatId,"Услуга не найдена. Начните заново: /book"); }
    const start=`${s.data.date}T${s.data.time}:00`;
    const end=`${s.data.date}T${hm(minutes(s.data.time)+svc.duration_minutes)}:00`;
    const clash=await env.DB.prepare("SELECT id FROM bookings WHERE status='confirmed' AND starts_at &lt; ? AND ends_at &gt; ? LIMIT 1").bind(end,start).first();
    if (clash) { await clearSession(env,userId); return send(env,chatId,"К сожалению, это время уже заняли. Выберите другое: /book"); }
    const ins=await env.DB.prepare("INSERT INTO bookings(telegram_user_id,customer_name,phone,service_id,service_name,price,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?)").bind(String(userId),s.data.name,phone,svc.id,svc.name,svc.price,start,end).run();
    await clearSession(env,userId);
    await send(env,chatId,`Готово! Вы записаны.\n\nНомер: #${ins.meta.last_row_id}\nУслуга: ${svc.name}\nДата: ${s.data.date}\nВремя: ${s.data.time}\nИмя: ${s.data.name}\nТелефон: ${phone}`);
    if (env.OWNER_ID) await send(env,env.OWNER_ID,`Новая запись #${ins.meta.last_row_id}\n${s.data.date} ${s.data.time}\n${svc.name}\n${s.data.name} · ${phone}`);
    return;
  }
  return send(env,chatId,"Чтобы записаться, нажмите /book.");
}
export default {
  async fetch(request,env) {
    if (request.method==="GET") return new Response("BotBooking is running.");
    if (request.method!=="POST") return new Response("Method not allowed",{status:405});
    if (!env.BOT_TOKEN || !env.DB) return json({ok:false,error:"Missing BOT_TOKEN or DB binding"},500);
    try {
      const update=await request.json();
      if (update.callback_query) await handleCallback(env,update.callback_query);
      else if (update.message) await handleMessage(env,update.message);
      return json({ok:true});
    } catch (e) {
      console.error("BotBooking error",e);
      return json({ok:false},200);
    }
  }
};
