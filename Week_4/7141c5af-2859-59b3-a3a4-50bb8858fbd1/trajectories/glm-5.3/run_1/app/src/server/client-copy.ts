/** The client page copy table, verbatim from the brief. */
export type ClientLang = "en" | "it" | "ja" | "ar";

export type ClientCopy = {
  C01: string; C02: string; C03: string; C04: string; C05: string; C06: string; C07: string; C08: string; C09: string;
  C10: string; C11: string; C12: string; C13: string; C14: string; C15: string; C16: string; C17: string; C18: string;
  C19: string; C20: string; C21: string; C22: string; C23: string; C24: string; C25: string; C26: string; C27: string;
  C28: string; C29: string; C30: string; C31: string; C32: string; C33: string; C34: string; C35: string; C36: string;
  C37: string; C38: string; C39: string; C40: string; C41: string; C42: string; C43: string; C44: string; C45: string;
  C46: string; C47: string; C48: string; C49: string; C50: string; C51: string; C52: string; M1: string; M2: string;
  M3: string; M4: string; K1: string; K2: string;
};

export const clientCopy: Record<ClientLang, ClientCopy> = {
  en: {
    C01: "Your piece", C02: "Steps", C03: "Before and after", C04: "The cover", C05: "The estimate", C06: "Your answer",
    C07: "What seat height would you like, in cm?", C08: "Seat height in cm", C09: "Send my answer", C10: "Your full name",
    C11: "Approve this cover", C12: "Close", C13: "Write the height like 44.5.", C14: "That is not the name we hold. Type your full name.",
    C15: "Your answer is with the conservator.", C16: "Approved at <time> <town> time.", C17: "Already approved at <time> <town> time.",
    C18: "A newer estimate was made at <time> Turin time. Read it first.", C19: "Please answer by <date>.", C20: "This page has ended.",
    C21: "Couldn't refresh. Trying again.", C22: "Working…", C23: "This field is required.", C24: "Announcements", C25: "Refresh state",
    C26: "Problems", C27: "Before", C28: "After", C29: "<n>% before", C30: "Photograph before the work", C31: "Photograph after the work",
    C32: "Drawing of the chosen material", C33: "Dye lot", C34: "Material", C35: "Labour", C36: "Subtotal", C37: "Tax", C38: "Total",
    C39: "Stage <n>", C40: "Frame work only, no material", C41: "No estimate yet.", C42: "Condition notes",
    C43: "Tear", C44: "Crack", C45: "Stain", C46: "Loose joint", C47: "Woodworm", C48: "Main action", C49: "Loading…",
    C50: "No photographs yet.", C51: "No condition notes yet.", C52: "Your answer could not be sent. Try again.",
    M1: "Your estimate for <title>", M2: "Reminder: your estimate for <title>", M3: "Dear <name>,", M4: "Read it and answer here: <address>",
    K1: "Care card", K2: "Keep the piece out of direct sun and away from radiators. Dust it with a soft dry cloth. Ask the conservator before using any cleaner.",
  },
  it: {
    C01: "Il tuo pezzo", C02: "Passaggi", C03: "Prima e dopo", C04: "Il rivestimento", C05: "Il preventivo", C06: "La tua risposta",
    C07: "Quale altezza della seduta desideri, in cm?", C08: "Altezza della seduta in cm", C09: "Invia la risposta", C10: "Il tuo nome completo",
    C11: "Approva questo rivestimento", C12: "Chiudi", C13: "Scrivi l'altezza così: 44,5.", C14: "Non è il nome che abbiamo. Scrivi il tuo nome completo.",
    C15: "La tua risposta è arrivata al restauratore.", C16: "Approvato alle <time>, ora di <town>.", C17: "Già approvato alle <time>, ora di <town>.",
    C18: "È stato fatto un preventivo più recente alle <time>, ora di Torino. Leggilo prima.", C19: "Rispondi entro il <date>.", C20: "Questa pagina è scaduta.",
    C21: "Aggiornamento non riuscito. Riprovo.", C22: "Attendi…", C23: "Questo campo è obbligatorio.", C24: "Annunci", C25: "Stato di aggiornamento",
    C26: "Problemi", C27: "Prima", C28: "Dopo", C29: "<n>% prima", C30: "Foto prima del lavoro", C31: "Foto dopo il lavoro",
    C32: "Disegno del materiale scelto", C33: "Partita di tintura", C34: "Materiale", C35: "Manodopera", C36: "Subtotale", C37: "Imposta", C38: "Totale",
    C39: "Fase <n>", C40: "Solo lavoro sul telaio, nessun materiale", C41: "Ancora nessun preventivo.", C42: "Note sullo stato",
    C43: "Strappo", C44: "Crepa", C45: "Macchia", C46: "Giunto allentato", C47: "Tarlo", C48: "Azione principale", C49: "Caricamento…",
    C50: "Ancora nessuna foto.", C51: "Ancora nessuna nota sullo stato.", C52: "Invio non riuscito. Riprova.",
    M1: "Il preventivo per <title>", M2: "Promemoria: il preventivo per <title>", M3: "Gentile <name>,", M4: "Leggilo e rispondi qui: <address>",
    K1: "Scheda di cura", K2: "Tieni il pezzo lontano dal sole diretto e dai termosifoni. Spolveralo con un panno morbido e asciutto. Chiedi al restauratore prima di usare qualsiasi detergente.",
  },
  ja: {
    C01: "お預かりの品", C02: "手順", C03: "施工前と施工後", C04: "張地", C05: "見積もり", C06: "あなたの回答",
    C07: "ご希望の座面の高さ（cm）を教えてください。", C08: "座面の高さ（cm）", C09: "回答を送信する", C10: "お名前（フルネーム）",
    C11: "この張地を承認する", C12: "閉じる", C13: "高さは 44.5 のように入力してください。", C14: "お預かりしているお名前と一致しません。フルネームを入力してください。",
    C15: "回答を修復担当者に届けました。", C16: "<time>（<town>時間）に承認しました。", C17: "<time>（<town>時間）に承認済みです。",
    C18: "<time>（トリノ時間）に新しい見積もりが作成されました。先にお読みください。", C19: "<date> までにご回答ください。", C20: "このページは終了しました。",
    C21: "更新できませんでした。再試行します。", C22: "処理中…", C23: "この項目は必須です。", C24: "お知らせ", C25: "更新の状態",
    C26: "問題", C27: "施工前", C28: "施工後", C29: "施工前 <n>%", C30: "施工前の写真", C31: "施工後の写真",
    C32: "選んだ素材の図", C33: "染色ロット", C34: "素材", C35: "工賃", C36: "小計", C37: "税", C38: "合計",
    C39: "第<n>段階", C40: "フレームの作業のみ（素材なし）", C41: "見積もりはまだありません。", C42: "状態の記録",
    C43: "裂け", C44: "ひび", C45: "しみ", C46: "接合部のゆるみ", C47: "虫食い", C48: "主な操作", C49: "読み込み中…",
    C50: "写真はまだありません。", C51: "状態の記録はまだありません。", C52: "回答を送信できませんでした。もう一度お試しください。",
    M1: "<title> のお見積もり", M2: "リマインダー: <title> のお見積もり", M3: "<name> 様", M4: "こちらからご確認のうえご回答ください: <address>",
    K1: "お手入れカード", K2: "直射日光と暖房器具を避けてください。乾いた柔らかい布でほこりを払ってください。クリーナーを使う前に修復担当者にご相談ください。",
  },
  ar: {
    C01: "قطعتك", C02: "الخطوات", C03: "قبل وبعد", C04: "الغطاء", C05: "التقدير", C06: "إجابتك",
    C07: "ما ارتفاع المقعد الذي تفضله بالسنتيمتر؟", C08: "ارتفاع المقعد بالسنتيمتر", C09: "إرسال إجابتي", C10: "اسمك الكامل",
    C11: "الموافقة على هذا الغطاء", C12: "إغلاق", C13: "اكتب الارتفاع هكذا: ٤٤٫٥.", C14: "هذا ليس الاسم المسجل لدينا. اكتب اسمك الكامل.",
    C15: "وصلت إجابتك إلى المرمِّم.", C16: "تمت الموافقة في الساعة <time> بتوقيت <town>.", C17: "تمت الموافقة بالفعل في الساعة <time> بتوقيت <town>.",
    C18: "أُعدّ تقدير أحدث في الساعة <time> بتوقيت تورينو. اقرأه أولاً.", C19: "يرجى الإجابة قبل نهاية يوم <date>.", C20: "انتهت هذه الصفحة.",
    C21: "تعذر التحديث. نحاول مرة أخرى.", C22: "جارٍ العمل…", C23: "هذا الحقل مطلوب.", C24: "الإعلانات", C25: "حالة التحديث",
    C26: "المشكلات", C27: "قبل", C28: "بعد", C29: "<n>% قبل", C30: "صورة قبل العمل", C31: "صورة بعد العمل",
    C32: "رسم المادة المختارة", C33: "دفعة الصبغ", C34: "المادة", C35: "العمل", C36: "المجموع الفرعي", C37: "الضريبة", C38: "الإجمالي",
    C39: "المرحلة <n>", C40: "عمل على الهيكل فقط، بلا مادة", C41: "لا يوجد تقدير بعد.", C42: "ملاحظات الحالة",
    C43: "تمزق", C44: "شرخ", C45: "بقعة", C46: "مفصل مرخي", C47: "سوس الخشب", C48: "الإجراء الرئيسي", C49: "جارٍ التحميل…",
    C50: "لا توجد صور بعد.", C51: "لا توجد ملاحظات حالة بعد.", C52: "تعذر إرسال إجابتك. حاول مرة أخرى.",
    M1: "تقدير <title>", M2: "تذكير: تقدير <title>", M3: "مرحبًا <name>،", M4: "اقرأه وأجب من هنا: <address>",
    K1: "بطاقة العناية", K2: "أبعد القطعة عن أشعة الشمس المباشرة والمدافئ. أزل الغبار بقطعة قماش ناعمة وجافة. استشر المرمِّم قبل استخدام أي منظف.",
  },
};

export const townNames: Record<ClientLang, Record<string, string>> = {
  en: { Turin: "Turin", London: "London", "New York": "New York", Kyoto: "Kyoto", Dubai: "Dubai" },
  it: { Turin: "Torino", London: "Londra", "New York": "New York", Kyoto: "Kyoto", Dubai: "Dubai" },
  ja: { Turin: "トリノ", London: "ロンドン", "New York": "ニューヨーク", Kyoto: "京都", Dubai: "ドバイ" },
  ar: { Turin: "تورينو", London: "لندن", "New York": "نيويورك", Kyoto: "كيوتو", Dubai: "دبي" },
};
