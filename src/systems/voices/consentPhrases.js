/*
 * Doom's Enhancement Suite for SillyTavern — Voices: cloning consent statements
 * Copyright (C) 2026 Jordan (DangerDaza)
 *
 * This file is part of Doom's Enhancement Suite and is licensed under the
 * GNU Affero General Public License v3.0 or later. If you redistribute this
 * file or a modified version of it, you must keep this notice intact, state
 * your changes, and release your version under the same license.
 *
 * See the LICENSE file in the project root for the full terms and for
 * additional copyright notices.
 *
 * https://github.com/DangerDaza/Dooms-Enhancement-Suite
 */

/**
 * The statements Google requires the speaker to read aloud before a voice
 * can be cloned — copied VERBATIM (generated from the table) from
 * https://ai.google.dev/gemini-api/docs/voice-replication#consent-phrases-by-language
 * (fetched 2026-09-26). Google checks the consent recording against these
 * words, so never edit them by hand; regenerate from the page if it changes.
 */
export const CONSENT_PHRASES = Object.freeze([
    { locale: "ar-XA", language: "Arabic", text: "أنا مالك هذا الصوت وأوافق على أن تستخدم Google هذا الصوت لإنشاء نموذج صوتي اصطناعي." },
    { locale: "bn-IN", language: "Bengali", text: "আমি এই ভয়েসের মালিক এবং আমি একটি সিন্থেটিক ভয়েস মডেল তৈরি করতে এই ভয়েস ব্যবহার করে Google-এর সাথে সম্মতি দিচ্ছি।" },
    { locale: "zh-CN", language: "Chinese (Simplified)", text: "我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型" },
    { locale: "nl-NL", language: "Dutch", text: "Ik ben de eigenaar van deze stem en ik geef Google toestemming om deze stem te gebruiken om een synthetisch stemmodel te maken." },
    { locale: "en-US", language: "English (US)", text: "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model." },
    { locale: "en-GB", language: "English (UK)", text: "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model." },
    { locale: "en-IN", language: "English (India)", text: "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model." },
    { locale: "en-AU", language: "English (Australia)", text: "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model." },
    { locale: "fr-FR", language: "French (France)", text: "Je suis le propriétaire de cette voix et j'autorise Google à utiliser cette voix pour créer un modèle de voix synthétique." },
    { locale: "fr-CA", language: "French (Canada)", text: "Je suis le propriétaire de cette voix et j'autorise Google à utiliser cette voix pour créer un modèle de voix synthétique." },
    { locale: "de-DE", language: "German", text: "Ich bin der Eigentümer dieser Stimme und bin damit einverstanden, dass Google diese Stimme zur Erstellung eines synthetischen Stimmmodells verwendet." },
    { locale: "gu-IN", language: "Gujarati", text: "હું આ વોઈસનો માલિક છું અને સિન્થેટિક વોઈસ મોડલ બનાવવા માટે આ વોઈસનો ઉપયોગ કરીને google ને હું સંમતિ આપું છું" },
    { locale: "hi-IN", language: "Hindi", text: "मैं इस आवाज का मालिक हूं और मैं सिंथेटिक आवाज मॉडल बनाने के लिए Google को इस आवाज का उपयोग करने की सहमति देता हूं" },
    { locale: "id-ID", language: "Indonesian", text: "Saya pemilik suara ini dan saya menyetujui Google menggunakan suara ini untuk membuat model suara sintetis." },
    { locale: "it-IT", language: "Italian", text: "Sono il proprietario di questa voce e acconsento che Google la utilizzi per creare un modello di voce sintetica." },
    { locale: "ja-JP", language: "Japanese", text: "私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。" },
    { locale: "kn-IN", language: "Kannada", text: "ನಾನು ಈ ಧ್ವನಿಯ ಮಾಲಿಕ ಮತ್ತು ಸಂಶ್ಲೇಷಿತ ಧ್ವನಿ ಮಾದರಿಯನ್ನು ರಚಿಸಲು ಈ ಧ್ವನಿಯನ್ನು ಬಳಸಿಕೊಂಡುಗೂಗಲ್ ಗೆ ನಾನು ಸಮ್ಮತಿಸುತ್ತೇನೆ." },
    { locale: "ko-KR", language: "Korean", text: "나는 이 음성의 소유자이며 구글이 이 음성을 사용하여 음성 합성 모델을 생성할 것을 허용합니다." },
    { locale: "ml-IN", language: "Malayalam", text: "ഈ ശബ്ദത്തിന്റെ ഉടമ ഞാനാണ്, ഒരു സിന്തറ്റിക് വോയ്സ് മോഡൽ സൃഷ്ടിക്കാൻ ഈ ശബ്ദം ഉപയോഗിക്കുന്നതിന് ഞാൻ Google-ന് സമ്മതം നൽകുന്നു." },
    { locale: "mr-IN", language: "Marathi", text: "मी या आवाजाचा मालक आहे आणि सिंथेटिक व्हॉइस मॉडेल तयार करण्यासाठी हा आवाज वापरण्यासाठी मी Google ला संमती देतो" },
    { locale: "pl-PL", language: "Polish", text: "Jestem właścicielem tego głosu i wyrażam zgodę na wykorzystanie go przez Google w celu utworzenia syntetycznego modelu głosu." },
    { locale: "pt-BR", language: "Portuguese (Brazil)", text: "Eu sou o proprietário desta voz e autorizo o Google a usá-la para criar um modelo de voz sintética." },
    { locale: "ru-RU", language: "Russian", text: "Я являюсь владельцем этого голоса и даю согласие Google на использование этого голоса для создания модели синтетического голоса." },
    { locale: "es-ES", language: "Spanish (Spain)", text: "Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética." },
    { locale: "es-US", language: "Spanish (US)", text: "Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética." },
    { locale: "ta-IN", language: "Tamil", text: "நான் இந்த குரலின் உரிமையாளர் மற்றும் செயற்கை குரல் மாதிரியை உருவாக்க இந்த குரலை பயன்படுத்த குகல்க்கு நான் ஒப்புக்கொள்கிறேன்." },
    { locale: "te-IN", language: "Telugu", text: "నేను ఈ వాయిస్ యజమానిని మరియు సింతటిక్ వాయిస్ మోడల్ ని రూపొందించడానికి ఈ వాయిస్ ని ఉపయోగించడానికి googleకి నేను సమ్మతిస్తున్నాను." },
    { locale: "th-TH", language: "Thai", text: "ฉันเป็นเจ้าของเสียงนี้ และฉันยินยอมให้ Google ใช้เสียงนี้เพื่อสร้างแบบจำลองเสียงสังเคราะห์" },
    { locale: "tr-TR", language: "Turkish", text: "Bu sesin sahibi benim ve Google'ın bu sesi kullanarak sentetik bir ses modeli oluşturmasına izin veriyorum." },
    { locale: "vi-VN", language: "Vietnamese", text: "Tôi là chủ sở hữu giọng nói này và tôi đồng ý cho Google sử dụng giọng nói này để tạo mô hình giọng nói tổng hợp." },
]);

/** The statement for a locale (en-US when unknown). */
export function consentPhraseFor(locale) {
    return CONSENT_PHRASES.find(p => p.locale === locale) || CONSENT_PHRASES.find(p => p.locale === 'en-US');
}
