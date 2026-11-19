import type { Language } from "./catalog";

interface AnswerCopy {
  heading: string;
  intro: (labelName: string, styleName: string) => string;
  due: (dueDate: string, town: string) => string;
  steps: string;
  stepEnergy: string;
  stepWater: string;
  stepOrigin: string;
  stepEvidence: string;
  stepSend: string;
  energy: string;
  water: string;
  origin: string;
  unit: string;
  gas: string;
  close: string;
  next: string;
  back: string;
  evidence: string;
  send: string;
  working: string;
  sent: string;
  ended: string;
  number: string;
  fileType: string;
  tooBig: string;
  storeDown: string;
  problems: string;
  refresh: string;
  empty: string;
  countries: Record<string, string>;
}

export const ANSWER_COPY: Record<Language, AnswerCopy> = {
  en: {
    heading: "Your answers",
    intro: (label, style) => `${label} asks about ${style}.`,
    due: (due, town) => `Please answer by ${due} 23:59:59 ${town} time.`,
    steps: "Steps",
    stepEnergy: "Energy",
    stepWater: "Water",
    stepOrigin: "Fibre origin",
    stepEvidence: "Evidence",
    stepSend: "Send",
    energy: "Energy per kg of finished goods",
    water: "Water in litres per kg of finished goods",
    origin: "Country of fibre origin",
    unit: "Unit",
    gas: "m³ of natural gas",
    close: "Close",
    next: "Next",
    back: "Back",
    evidence: "Evidence file (PDF, JPEG or PNG)",
    send: "Send answers",
    working: "Working…",
    sent: "Sent",
    ended: "This page has ended.",
    number: "That number isn't in the form this page uses, for example 1,250.5.",
    fileType: "That file isn't a PDF, JPEG or PNG.",
    tooBig: "That file is over 5,000,000 bytes.",
    storeDown: "The file store is unavailable right now. Nothing was saved.",
    problems: "Problems",
    refresh: "Couldn't refresh. Trying again.",
    empty: "Give an answer here.",
    countries: { PT: "Portugal", TR: "Turkey", VN: "Vietnam", EG: "Egypt", IN: "India", BD: "Bangladesh" },
  },
  fr: {
    heading: "Vos réponses",
    intro: (label, style) => `${label} pose des questions sur ${style}.`,
    due: (due, town) => `Merci de répondre avant le ${due} 23:59:59, heure de ${town}.`,
    steps: "Étapes",
    stepEnergy: "Énergie",
    stepWater: "Eau",
    stepOrigin: "Origine de la fibre",
    stepEvidence: "Justificatif",
    stepSend: "Envoi",
    energy: "Énergie par kg de produit fini",
    water: "Eau en litres par kg de produit fini",
    origin: "Pays d'origine de la fibre",
    unit: "Unité",
    gas: "m³ de gaz naturel",
    close: "Fermer",
    next: "Suivant",
    back: "Retour",
    evidence: "Justificatif (PDF, JPEG ou PNG)",
    send: "Envoyer les réponses",
    working: "En cours…",
    sent: "Envoyé",
    ended: "Cette page est terminée.",
    number: "Ce nombre n'est pas écrit comme il faut, par exemple 1 250,5.",
    fileType: "Ce fichier n'est ni un PDF, ni un JPEG, ni un PNG.",
    tooBig: "Ce fichier dépasse 5 000 000 octets.",
    storeDown: "Le stockage des fichiers est indisponible pour le moment. Rien n'a été enregistré.",
    problems: "Problèmes",
    refresh: "Actualisation impossible. Nouvel essai en cours.",
    empty: "Répondez ici.",
    countries: { PT: "Portugal", TR: "Turquie", VN: "Viêt Nam", EG: "Égypte", IN: "Inde", BD: "Bangladesh" },
  },
  tr: {
    heading: "Yanıtlarınız",
    intro: (label, style) => `${label}, ${style} hakkında soruyor.`,
    due: (due, town) => `Lütfen ${due} 23:59:59 (${town} saati) tarihine kadar yanıtlayın.`,
    steps: "Adımlar",
    stepEnergy: "Enerji",
    stepWater: "Su",
    stepOrigin: "Elyaf kökeni",
    stepEvidence: "Kanıt belgesi",
    stepSend: "Gönderim",
    energy: "Bitmiş ürünün kg'si başına enerji",
    water: "Bitmiş ürünün kg'si başına litre su",
    origin: "Elyafın menşe ülkesi",
    unit: "Birim",
    gas: "m³ doğal gaz",
    close: "Kapat",
    next: "İleri",
    back: "Geri",
    evidence: "Kanıt dosyası (PDF, JPEG veya PNG)",
    send: "Yanıtları gönder",
    working: "İşleniyor…",
    sent: "Gönderildi",
    ended: "Bu sayfanın süresi doldu.",
    number: "Bu sayı doğru biçimde değil, örneğin 1.250,5.",
    fileType: "Bu dosya PDF, JPEG veya PNG değil.",
    tooBig: "Bu dosya 5.000.000 baytı aşıyor.",
    storeDown: "Dosya deposu şu anda kullanılamıyor. Hiçbir şey kaydedilmedi.",
    problems: "Sorunlar",
    refresh: "Yenilenemedi. Yeniden deneniyor.",
    empty: "Buraya bir yanıt girin.",
    countries: { PT: "Portekiz", TR: "Türkiye", VN: "Vietnam", EG: "Mısır", IN: "Hindistan", BD: "Bangladeş" },
  },
  ar: {
    heading: "إجاباتك",
    intro: (label, style) => `تسأل ${label} عن ${style}.`,
    due: (due, town) => `يرجى الإجابة قبل ${due} 23:59:59 بتوقيت ${town}.`,
    steps: "الخطوات",
    stepEnergy: "الطاقة",
    stepWater: "الماء",
    stepOrigin: "منشأ الألياف",
    stepEvidence: "مستند داعم",
    stepSend: "الإرسال",
    energy: "الطاقة لكل كيلوغرام من المنتج النهائي",
    water: "الماء باللتر لكل كيلوغرام من المنتج النهائي",
    origin: "بلد منشأ الألياف",
    unit: "الوحدة",
    gas: "م³ من الغاز الطبيعي",
    close: "إغلاق",
    next: "التالي",
    back: "السابق",
    evidence: "ملف المستند (PDF أو JPEG أو PNG)",
    send: "إرسال الإجابات",
    working: "جارٍ العمل…",
    sent: "تم الإرسال",
    ended: "انتهت هذه الصفحة.",
    number: "هذا الرقم ليس بالصيغة الصحيحة، مثل ١٬٢٥٠٫٥.",
    fileType: "هذا الملف ليس PDF أو JPEG أو PNG.",
    tooBig: "يتجاوز هذا الملف ٥٬٠٠٠٬٠٠٠ بايت.",
    storeDown: "مخزن الملفات غير متاح حاليًا. لم يُحفظ أي شيء.",
    problems: "المشكلات",
    refresh: "تعذر التحديث. جارٍ المحاولة مجددًا.",
    empty: "أدخل إجابة هنا.",
    countries: { PT: "البرتغال", TR: "تركيا", VN: "فيتنام", EG: "مصر", IN: "الهند", BD: "بنغلاديش" },
  },
};

interface PassportCopy {
  label: string;
  garment: string;
  garments: Record<string, string>;
  footprint: string;
  measures: Record<string, string>;
  score: (score: string, per100g: string) => string;
  edition: (n: number) => string;
  factorEdition: (edition: string) => string;
  dataQuality: (grade: string, percent: number) => string;
  corrected: (date: string) => string;
  withdrawn: string;
  claim: string;
}

export const PASSPORT_COPY: Record<Language, PassportCopy> = {
  en: {
    label: "Label",
    garment: "Garment",
    garments: { tshirt: "T-shirt", shirt: "Shirt", jeans: "Jeans", coat: "Coat" },
    footprint: "Footprint",
    measures: {
      climate: "Climate",
      water: "Water",
      fossilEnergy: "Fossil energy",
      landUse: "Land use",
      freshwaterToxicity: "Freshwater toxicity",
      microfibres: "Microfibres",
    },
    score: (score, per100g) => `Score ${score} points (${per100g} per 100 g)`,
    edition: (n) => `Edition ${n}`,
    factorEdition: (edition) => `Factor edition ${edition}`,
    dataQuality: (grade, percent) => `Data quality ${grade} (${percent}%)`,
    corrected: (date) => `Corrected ${date}`,
    withdrawn: "This passport has been withdrawn.",
    claim: "These figures are published sums. They are not a legal claim.",
  },
  fr: {
    label: "Marque",
    garment: "Vêtement",
    garments: { tshirt: "T-shirt", shirt: "Chemise", jeans: "Jean", coat: "Manteau" },
    footprint: "Empreinte",
    measures: {
      climate: "Climat",
      water: "Eau",
      fossilEnergy: "Énergie fossile",
      landUse: "Usage des sols",
      freshwaterToxicity: "Toxicité en eau douce",
      microfibres: "Microfibres",
    },
    score: (score, per100g) => `Score ${score} points (${per100g} pour 100 g)`,
    edition: (n) => `Édition ${n}`,
    factorEdition: (edition) => `Édition des facteurs ${edition}`,
    dataQuality: (grade, percent) => `Qualité des données ${grade} (${percent}%)`,
    corrected: (date) => `Corrigé le ${date}`,
    withdrawn: "Ce passeport a été retiré.",
    claim: "Ces chiffres sont des sommes publiées. Ils ne constituent pas une affirmation légale.",
  },
  tr: {
    label: "Marka",
    garment: "Giysi",
    garments: { tshirt: "Tişört", shirt: "Gömlek", jeans: "Kot pantolon", coat: "Kaban" },
    footprint: "Ayak izi",
    measures: {
      climate: "İklim",
      water: "Su",
      fossilEnergy: "Fosil enerji",
      landUse: "Arazi kullanımı",
      freshwaterToxicity: "Tatlı su toksisitesi",
      microfibres: "Mikrolifler",
    },
    score: (score, per100g) => `Puan ${score} (100 g başına ${per100g})`,
    edition: (n) => `${n}. sürüm`,
    factorEdition: (edition) => `Faktör sürümü ${edition}`,
    dataQuality: (grade, percent) => `Veri kalitesi ${grade} (%${percent})`,
    corrected: (date) => `Düzeltildi: ${date}`,
    withdrawn: "Bu pasaport geri çekildi.",
    claim: "Bu rakamlar yayımlanmış toplamlardır. Yasal bir iddia değildir.",
  },
  ar: {
    label: "العلامة",
    garment: "الملبس",
    garments: { tshirt: "قميص قصير", shirt: "قميص", jeans: "جينز", coat: "معطف" },
    footprint: "البصمة",
    measures: {
      climate: "المناخ",
      water: "الماء",
      fossilEnergy: "الطاقة الأحفورية",
      landUse: "استخدام الأراضي",
      freshwaterToxicity: "سمية المياه العذبة",
      microfibres: "الألياف الدقيقة",
    },
    score: (score, per100g) => `الدرجة ${score} نقطة (${per100g} لكل 100 غ)`,
    edition: (n) => `الإصدار ${n}`,
    factorEdition: (edition) => `إصدار العوامل ${edition}`,
    dataQuality: (grade, percent) => `جودة البيانات ${grade} (${percent}%)`,
    corrected: (date) => `صُحِّح في ${date}`,
    withdrawn: "تم سحب هذا الجواز.",
    claim: "هذه الأرقام مجاميع منشورة وليست ادعاءً قانونيًا.",
  },
};

export const SESSION_ENDED_COPY = "Your session ended. Sign in again to keep going — what you typed is still here.";
export const REFRESH_FAILED_COPY = "Couldn't refresh. Trying again.";
export const NOT_FOUND_HEADING = "We couldn't find that page.";
export const TITLE_TAIL = " — Fio Contado Desk";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "fr" || value === "tr" || value === "ar";
}
