/** Every published string, character for character. Pure data, imported by the server and both browsers' screens. */
import type { Language, Town } from "./towns.ts";

const DESK_COPY = {
  "F-01": "Working…",
  "F-02": "Couldn't refresh. Trying again.",
  "F-03": "Your session ended. Sign in again to keep going — what you typed is still here.",
  "F-04": "This field is required.",
  "F-05": "This is longer than <n> characters.",
  "F-06": "That is not an email address.",
  "F-07": "That is not a date.",
  "F-08": "That number is out of range.",
  "F-09": "That email and password do not match.",
  "F-10": "Use at least 10 characters.",
  "F-11": "Thank you. Your enquiry is on its way.",
  "F-12": "Too many enquiries. You can try again at <minute> Turin time.",
  "F-13": "That stamp number does not check out. Read it again from the frame.",
  "F-14": "Another piece on this desk has that stamp number.",
  "F-15": "<title> saved.",
  "F-16": "<title> archived.",
  "F-17": "Search is unavailable right now. The full list is still here.",
  "F-18": "Nothing found for <text>.",
  "F-19": "<name> is closing. You can bring it back until <date>.",
  "F-20": "<name> is back.",
  "F-22": "Pin placed at <x>, <y>.",
  "F-23": "Pin removed.",
  "F-24": "This file is not a PNG or JPEG.",
  "F-25": "This file is over 8,000,000 bytes.",
  "F-26": "Already on this piece as photograph <n>.",
  "F-27": "The file store is unavailable right now. Nothing was saved.",
  "F-28": "<file name> stored.",
  "F-29": "The supplier could not be read. Your library has not changed.",
  "F-30": "Search could not take the new entries. Your library has not changed.",
  "F-31": "Library refreshed: <n> materials.",
  "F-32": "The tray holds four. Take one out first.",
  "F-33": "Held until <date>",
  "F-34": "Hold ended on <date>.",
  "F-35": "The supplier is busy. You can try again at <minute> Turin time.",
  "F-36": "The supplier is unavailable right now. Nothing changed.",
  "F-37": "No single dye lot holds <n> hides of <name>. The largest holds <m>.",
  "F-38": "No single dye lot holds <n> m of <name>. The largest holds <m> m.",
  "F-39": "Lot <lot> holds <m>.",
  "F-40": "This piece is held on lot <lot>. All its hides come from one dye lot.",
  "F-41": "This lot is already held for this piece for <q>.",
  "F-42": "<part> lifted. Arrow keys move it, Enter places it, Escape puts it back.",
  "F-43": "<part> back in the tray.",
  "F-44": "<part> put back.",
  "F-45": "<part> placed at <x>, <y> cm.",
  "F-46": "<name> answered about <title> at <time> Turin time.",
  "F-47": "<part> cannot go there. It runs off the hide.",
  "F-48": "<part> cannot go there. It crosses the flaw at <x>, <y> cm.",
  "F-49": "<part> cannot go there. It overlaps <other part>.",
  "F-50": "<part> runs with the grain and turns only 0 or 180.",
  "F-51": "This layout was changed at <time> Turin time in another window. Your piece is still lifted.",
  "F-52": "Used <used> sq ft of 51.67 sq ft (<percent>%)",
  "F-53": "Total now <total>.",
  "F-54": "Estimate saved.",
  "F-55": "This estimate was changed at <time> Turin time in another window. Your figures are still here.",
  "F-56": "Labour goes in quarter hours.",
  "F-57": "Rate saved. It applies to new estimates from <date>.",
  "F-58": "A rate already takes effect on that day.",
  "F-59": "Rates take effect today or later.",
  "F-60": "Client page sent to <email>.",
  "F-61": "Client page ended.",
  "F-62": "Give this piece a due date first.",
  "F-63": "This client has no email address yet.",
  "F-64": "<job> moved to <bench> on <date>.",
  "F-65": "No more days this week. Use Move to….",
  "F-66": "That bench is taken on <date> by <job>.",
  "F-67": "The glue on <title> cures until <datetime>.",
  "F-68": "<time> does not exist in <town> on <date>.",
  "F-69": "Glue laid on <job>. It cures at <datetime>.",
  "F-70": "The bench works Monday to Friday.",
  "F-71": "Glue goes on a frame bench job.",
  "F-72": "The courier could not confirm. Nothing was booked.",
  "F-73": "The courier is busy. You can try again at <minute> Turin time.",
  "F-74": "That time was just taken at <time> Turin time. Pick another.",
  "F-75": "Booked",
  "F-76": "Quote: <amount>.",
  "F-77": "The courier could not give a quote. Nothing changed.",
  "F-78": "This piece needs its width, depth, height and weight first.",
  "F-79": "This piece is already booked for <collection time>.",
  "F-80": "This file has a column the desk does not know: <name>.",
  "F-81": "This file is missing a column: <name>.",
  "F-82": "This file is over 2,000,000 bytes.",
  "F-83": "This file is not UTF-8 text.",
  "F-84": "Row <n>: that stamp number does not check out.",
  "F-85": "Row <n>: the piece has no title.",
  "F-86": "Row <n>: the desk has no material <code>.",
  "F-87": "Row <n>: that row does not have seven fields.",
  "F-88": "Saved: <a> new, <b> matched, <c> refused.",
  "F-90": "The PDF service is unavailable right now. Nothing was saved.",
  "F-91": "Too many downloads. You can try again at <minute> Turin time.",
  "F-92": "This piece has no signed-off estimate yet.",
  "F-93": "Dossier stored.",
  "F-94": "Dossier signed.",
  "F-95": "That is not the name on this desk.",
  "F-96": "A signed dossier never changes.",
  "F-97": "The dossier is not stored yet.",
  "F-98": "Close this client instead.",
  "F-99": "Loading…",
  "F-100": "Page not found",
  "F-101": "Password changed.",
  "F-102": "<name> saved.",
  "F-103": "<name> deleted.",
  "F-104": "<title> duplicated.",
  "F-105": "<title> is now <state>.",
  "F-106": "Hide cleared.",
  "F-107": "<job> added to <bench> on <date>.",
  "F-108": "Preview ready: <a> new, <b> matched, <c> refused.",
  "F-109": "That email already has a desk.",
  "F-110": "This client can no longer be brought back.",
  "F-111": "That is not a time. Write it like 09:00.",
  "F-112": "That is not a number. Write it like 12.50.",
} as const;

const CLIENT_COPY = {
  C01: { en: "Your piece", it: "Il tuo pezzo", ja: "お預かりの品", ar: "قطعتك" },
  C02: { en: "Steps", it: "Passaggi", ja: "手順", ar: "الخطوات" },
  C03: { en: "Before and after", it: "Prima e dopo", ja: "施工前と施工後", ar: "قبل وبعد" },
  C04: { en: "The cover", it: "Il rivestimento", ja: "張地", ar: "الغطاء" },
  C05: { en: "The estimate", it: "Il preventivo", ja: "見積もり", ar: "التقدير" },
  C06: { en: "Your answer", it: "La tua risposta", ja: "あなたの回答", ar: "إجابتك" },
  C07: { en: "What seat height would you like, in cm?", it: "Quale altezza della seduta desideri, in cm?", ja: "ご希望の座面の高さ（cm）を教えてください。", ar: "ما ارتفاع المقعد الذي تفضله بالسنتيمتر؟" },
  C08: { en: "Seat height in cm", it: "Altezza della seduta in cm", ja: "座面の高さ（cm）", ar: "ارتفاع المقعد بالسنتيمتر" },
  C09: { en: "Send my answer", it: "Invia la risposta", ja: "回答を送信する", ar: "إرسال إجابتي" },
  C10: { en: "Your full name", it: "Il tuo nome completo", ja: "お名前（フルネーム）", ar: "اسمك الكامل" },
  C11: { en: "Approve this cover", it: "Approva questo rivestimento", ja: "この張地を承認する", ar: "الموافقة على هذا الغطاء" },
  C12: { en: "Close", it: "Chiudi", ja: "閉じる", ar: "إغلاق" },
  C13: { en: "Write the height like 44.5.", it: "Scrivi l'altezza così: 44,5.", ja: "高さは 44.5 のように入力してください。", ar: "اكتب الارتفاع هكذا: ٤٤٫٥." },
  C14: { en: "That is not the name we hold. Type your full name.", it: "Non è il nome che abbiamo. Scrivi il tuo nome completo.", ja: "お預かりしているお名前と一致しません。フルネームを入力してください。", ar: "هذا ليس الاسم المسجل لدينا. اكتب اسمك الكامل." },
  C15: { en: "Your answer is with the conservator.", it: "La tua risposta è arrivata al restauratore.", ja: "回答を修復担当者に届けました。", ar: "وصلت إجابتك إلى المرمِّم." },
  C16: { en: "Approved at <time> <town> time.", it: "Approvato alle <time>, ora di <town>.", ja: "<time>（<town>時間）に承認しました。", ar: "تمت الموافقة في الساعة <time> بتوقيت <town>." },
  C17: { en: "Already approved at <time> <town> time.", it: "Già approvato alle <time>, ora di <town>.", ja: "<time>（<town>時間）に承認済みです。", ar: "تمت الموافقة بالفعل في الساعة <time> بتوقيت <town>." },
  C18: { en: "A newer estimate was made at <time> Turin time. Read it first.", it: "È stato fatto un preventivo più recente alle <time>, ora di Torino. Leggilo prima.", ja: "<time>（トリノ時間）に新しい見積もりが作成されました。先にお読みください。", ar: "أُعدّ تقدير أحدث في الساعة <time> بتوقيت تورينو. اقرأه أولاً." },
  C19: { en: "Please answer by <date>.", it: "Rispondi entro il <date>.", ja: "<date> までにご回答ください。", ar: "يرجى الإجابة قبل نهاية يوم <date>." },
  C20: { en: "This page has ended.", it: "Questa pagina è scaduta.", ja: "このページは終了しました。", ar: "انتهت هذه الصفحة." },
  C21: { en: "Couldn't refresh. Trying again.", it: "Aggiornamento non riuscito. Riprovo.", ja: "更新できませんでした。再試行します。", ar: "تعذر التحديث. نحاول مرة أخرى." },
  C22: { en: "Working…", it: "Attendi…", ja: "処理中…", ar: "جارٍ العمل…" },
  C23: { en: "This field is required.", it: "Questo campo è obbligatorio.", ja: "この項目は必須です。", ar: "هذا الحقل مطلوب." },
  C24: { en: "Announcements", it: "Annunci", ja: "お知らせ", ar: "الإعلانات" },
  C25: { en: "Refresh state", it: "Stato di aggiornamento", ja: "更新の状態", ar: "حالة التحديث" },
  C26: { en: "Problems", it: "Problemi", ja: "問題", ar: "المشكلات" },
  C27: { en: "Before", it: "Prima", ja: "施工前", ar: "قبل" },
  C28: { en: "After", it: "Dopo", ja: "施工後", ar: "بعد" },
  C29: { en: "<n>% before", it: "<n>% prima", ja: "施工前 <n>%", ar: "<n>% قبل" },
  C30: { en: "Photograph before the work", it: "Foto prima del lavoro", ja: "施工前の写真", ar: "صورة قبل العمل" },
  C31: { en: "Photograph after the work", it: "Foto dopo il lavoro", ja: "施工後の写真", ar: "صورة بعد العمل" },
  C32: { en: "Drawing of the chosen material", it: "Disegno del materiale scelto", ja: "選んだ素材の図", ar: "رسم المادة المختارة" },
  C33: { en: "Dye lot", it: "Partita di tintura", ja: "染色ロット", ar: "دفعة الصبغ" },
  C34: { en: "Material", it: "Materiale", ja: "素材", ar: "المادة" },
  C35: { en: "Labour", it: "Manodopera", ja: "工賃", ar: "العمل" },
  C36: { en: "Subtotal", it: "Subtotale", ja: "小計", ar: "المجموع الفرعي" },
  C37: { en: "Tax", it: "Imposta", ja: "税", ar: "الضريبة" },
  C38: { en: "Total", it: "Totale", ja: "合計", ar: "الإجمالي" },
  C39: { en: "Stage <n>", it: "Fase <n>", ja: "第<n>段階", ar: "المرحلة <n>" },
  C40: { en: "Frame work only, no material", it: "Solo lavoro sul telaio, nessun materiale", ja: "フレームの作業のみ（素材なし）", ar: "عمل على الهيكل فقط، بلا مادة" },
  C41: { en: "No estimate yet.", it: "Ancora nessun preventivo.", ja: "見積もりはまだありません。", ar: "لا يوجد تقدير بعد." },
  C42: { en: "Condition notes", it: "Note sullo stato", ja: "状態の記録", ar: "ملاحظات الحالة" },
  C43: { en: "Tear", it: "Strappo", ja: "裂け", ar: "تمزق" },
  C44: { en: "Crack", it: "Crepa", ja: "ひび", ar: "شرخ" },
  C45: { en: "Stain", it: "Macchia", ja: "しみ", ar: "بقعة" },
  C46: { en: "Loose joint", it: "Giunto allentato", ja: "接合部のゆるみ", ar: "مفصل مرخي" },
  C47: { en: "Woodworm", it: "Tarlo", ja: "虫食い", ar: "سوس الخشب" },
  C48: { en: "Main action", it: "Azione principale", ja: "主な操作", ar: "الإجراء الرئيسي" },
  C49: { en: "Loading…", it: "Caricamento…", ja: "読み込み中…", ar: "جارٍ التحميل…" },
  C50: { en: "No photographs yet.", it: "Ancora nessuna foto.", ja: "写真はまだありません。", ar: "لا توجد صور بعد." },
  C51: { en: "No condition notes yet.", it: "Ancora nessuna nota sullo stato.", ja: "状態の記録はまだありません。", ar: "لا توجد ملاحظات حالة بعد." },
  C52: { en: "Your answer could not be sent. Try again.", it: "Invio non riuscito. Riprova.", ja: "回答を送信できませんでした。もう一度お試しください。", ar: "تعذر إرسال إجابتك. حاول مرة أخرى." },
  M1: { en: "Your estimate for <title>", it: "Il preventivo per <title>", ja: "<title> のお見積もり", ar: "تقدير <title>" },
  M2: { en: "Reminder: your estimate for <title>", it: "Promemoria: il preventivo per <title>", ja: "リマインダー: <title> のお見積もり", ar: "تذكير: تقدير <title>" },
  M3: { en: "Dear <name>,", it: "Gentile <name>,", ja: "<name> 様", ar: "مرحبًا <name>،" },
  M4: { en: "Read it and answer here: <address>", it: "Leggilo e rispondi qui: <address>", ja: "こちらからご確認のうえご回答ください: <address>", ar: "اقرأه وأجب من هنا: <address>" },
  K1: { en: "Care card", it: "Scheda di cura", ja: "お手入れカード", ar: "بطاقة العناية" },
  K2: { en: "Keep the piece out of direct sun and away from radiators. Dust it with a soft dry cloth. Ask the conservator before using any cleaner.", it: "Tieni il pezzo lontano dal sole diretto e dai termosifoni. Spolveralo con un panno morbido e asciutto. Chiedi al restauratore prima di usare qualsiasi detergente.", ja: "直射日光と暖房器具を避けてください。乾いた柔らかい布でほこりを払ってください。クリーナーを使う前に修復担当者にご相談ください。", ar: "أبعد القطعة عن أشعة الشمس المباشرة والمدافئ. أزل الغبار بقطعة قماش ناعمة وجافة. استشر المرمِّم قبل استخدام أي منظف." },
} as const;

const TOWN_COPY: Record<Town, Record<Language, string>> = {
  "Turin": { en: "Turin", it: "Torino", ja: "トリノ", ar: "تورينو" },
  "London": { en: "London", it: "Londra", ja: "ロンドン", ar: "لندن" },
  "New York": { en: "New York", it: "New York", ja: "ニューヨーク", ar: "نيويورك" },
  "Kyoto": { en: "Kyoto", it: "Kyoto", ja: "京都", ar: "كيوتو" },
  "Dubai": { en: "Dubai", it: "Dubai", ja: "ドバイ", ar: "دبي" },
};

export const ERASED_CLIENT_NAME = "Erased client";

type DeskCopyId = keyof typeof DESK_COPY;
export type ClientCopyId = keyof typeof CLIENT_COPY;
type Values = Record<string, string | number>;

function fill(template: string, values: Values): string {
  return template.replace(/<([a-z ]+)>/g, (slot, name: string) => String(values[name] ?? slot));
}

export function copy(id: DeskCopyId, values: Values = {}): string {
  return fill(DESK_COPY[id], values);
}

export function clientCopy(id: ClientCopyId, language: Language, values: Values = {}): string {
  return fill(CLIENT_COPY[id][language], values);
}

export function townCopy(town: Town, language: Language): string {
  return TOWN_COPY[town][language];
}

const IT_DAYS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
const IT_MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const EN_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const JA_DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const AR_DAYS = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** A `YYYY-MM-DD` date in the client page's published date form. */
export function clientDate(date: string, language: Language): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  switch (language) {
    case "en":
      return `${EN_DAYS[weekday]} ${day} ${EN_MONTHS[month - 1]} ${year}`;
    case "it":
      return `${IT_DAYS[weekday]} ${day} ${IT_MONTHS[month - 1]} ${year}`;
    case "ja":
      return `${year}年${month}月${day}日(${JA_DAYS[weekday]})`;
    case "ar":
      return `${AR_DAYS[weekday]} ${day} ${AR_MONTHS[month - 1]} ${year}`;
  }
}
