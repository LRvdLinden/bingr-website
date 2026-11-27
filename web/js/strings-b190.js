/*
 * Build 190: pincode vergeten (wachtwoord), Snelheid in de speler. Sleutel = Engels (terugval); hier de andere talen.
 * Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var T = {
    "ar": {
      "Remove PIN": "إزالة PIN",
      "Forgot PIN?": "نسيت رمز PIN؟",
      "Enter your Bingr account password to remove the PIN.": "أدخل كلمة مرور حساب Bingr لإزالة رمز PIN.",
      "PIN removed. You can set a new one in Settings.": "تمت إزالة رمز PIN. يمكنك تعيين رمز جديد في الإعدادات.",
      "Wrong password": "كلمة المرور غير صحيحة",
      "Speed": "السرعة",
      "Normal": "عادية"
    },
    "de": {
      "Remove PIN": "PIN entfernen",
      "Forgot PIN?": "PIN vergessen?",
      "Enter your Bingr account password to remove the PIN.": "Gib das Passwort deines Bingr-Kontos ein, um die PIN zu entfernen.",
      "PIN removed. You can set a new one in Settings.": "PIN entfernt. Du kannst in den Einstellungen eine neue festlegen.",
      "Wrong password": "Falsches Passwort",
      "Speed": "Geschwindigkeit",
      "Normal": "Normal"
    },
    "es": {
      "Remove PIN": "Quitar PIN",
      "Forgot PIN?": "¿Olvidaste el PIN?",
      "Enter your Bingr account password to remove the PIN.": "Introduce la contraseña de tu cuenta de Bingr para quitar el PIN.",
      "PIN removed. You can set a new one in Settings.": "PIN eliminado. Puedes crear uno nuevo en Ajustes.",
      "Wrong password": "Contraseña incorrecta",
      "Speed": "Velocidad",
      "Normal": "Normal"
    },
    "fr": {
      "Remove PIN": "Supprimer le code PIN",
      "Forgot PIN?": "Code PIN oublié ?",
      "Enter your Bingr account password to remove the PIN.": "Saisissez le mot de passe de votre compte Bingr pour supprimer le code PIN.",
      "PIN removed. You can set a new one in Settings.": "Code PIN supprimé. Vous pouvez en définir un nouveau dans les réglages.",
      "Wrong password": "Mot de passe incorrect",
      "Speed": "Vitesse",
      "Normal": "Normale"
    },
    "it": {
      "Remove PIN": "Rimuovi PIN",
      "Forgot PIN?": "PIN dimenticato?",
      "Enter your Bingr account password to remove the PIN.": "Inserisci la password del tuo account Bingr per rimuovere il PIN.",
      "PIN removed. You can set a new one in Settings.": "PIN rimosso. Puoi impostarne uno nuovo nelle Impostazioni.",
      "Wrong password": "Password errata",
      "Speed": "Velocità",
      "Normal": "Normale"
    },
    "nl": {
      "Remove PIN": "Pincode verwijderen",
      "Forgot PIN?": "Pincode vergeten?",
      "Enter your Bingr account password to remove the PIN.": "Voer het wachtwoord van je Bingr-account in om de pincode te verwijderen.",
      "PIN removed. You can set a new one in Settings.": "Pincode verwijderd. Je kunt in de instellingen een nieuwe kiezen.",
      "Wrong password": "Onjuist wachtwoord",
      "Speed": "Snelheid",
      "Normal": "Normaal"
    },
    "pl": {
      "Remove PIN": "Usuń PIN",
      "Forgot PIN?": "Nie pamiętasz kodu PIN?",
      "Enter your Bingr account password to remove the PIN.": "Wpisz hasło do konta Bingr, aby usunąć kod PIN.",
      "PIN removed. You can set a new one in Settings.": "Kod PIN usunięty. Nowy możesz ustawić w Ustawieniach.",
      "Wrong password": "Nieprawidłowe hasło",
      "Speed": "Prędkość",
      "Normal": "Normalna"
    },
    "pt": {
      "Remove PIN": "Remover PIN",
      "Forgot PIN?": "Esqueceu o PIN?",
      "Enter your Bingr account password to remove the PIN.": "Introduza a palavra-passe da sua conta Bingr para remover o PIN.",
      "PIN removed. You can set a new one in Settings.": "PIN removido. Pode definir um novo nas Definições.",
      "Wrong password": "Palavra-passe incorreta",
      "Speed": "Velocidade",
      "Normal": "Normal"
    },
    "tr": {
      "Remove PIN": "PIN'i kaldır",
      "Forgot PIN?": "PIN'i mi unuttun?",
      "Enter your Bingr account password to remove the PIN.": "PIN'i kaldırmak için Bingr hesabının parolasını gir.",
      "PIN removed. You can set a new one in Settings.": "PIN kaldırıldı. Ayarlar'dan yenisini belirleyebilirsin.",
      "Wrong password": "Yanlış parola",
      "Speed": "Hız",
      "Normal": "Normal"
    },
    "zh-Hans": {
      "Remove PIN": "移除 PIN",
      "Forgot PIN?": "忘记 PIN？",
      "Enter your Bingr account password to remove the PIN.": "输入 Bingr 账户密码以移除 PIN。",
      "PIN removed. You can set a new one in Settings.": "PIN 已移除。你可以在设置中设置新的 PIN。",
      "Wrong password": "密码错误",
      "Speed": "速度",
      "Normal": "正常"
    }
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(T).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    Object.keys(T[lang]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = T[lang][k]; });
  });
})();
