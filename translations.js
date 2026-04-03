// ─── Confidence Book — i18n System ───────────────────────────────────────────
// Usage:
//   HTML:   <span data-i18n="feed.title"></span>
//           <input data-i18n-placeholder="auth.phrase_placeholder">
//   JS:     t('feed.title')          → returns translated string
//           applyTranslations()      → updates all data-i18n elements in DOM
//           setLanguage('fr')        → saves + applies without reload
//           getCurrentLanguage()     → returns current lang ('en' or 'fr')

const CB_LANG_KEY = 'confidenceBookLanguage';
const CB_DEFAULT_LANG = 'en';

const translations = {
  en: {
    welcome: {
      title: "Welcome to Confidence Book",
      subtitle: "A digital refuge where no one faces their story alone",
      mission: "Express your emotions, share your experiences, receive support — all 100% anonymous and kind.",
      rules_title: "Our Kindness Rules",
      rule1: "Guaranteed anonymity — No personal data required",
      rule2: "Mutual respect — Zero tolerance for hate and judgment",
      rule3: "AI moderation — Automatic protection against harmful content",
      rule4: "Temporality — Posts disappear after 90 days (except Premium)",
      rule5: "Free access — No intrusive ads, ever",
      accept: "I accept and continue",
      emergency_title: "Need immediate help?",
      emergency_subtitle: "These numbers are available 24/7"
    },
    auth: {
      title: "Your Anonymous Space",
      create_title: "Create my space",
      create_subtitle: "Choose a secret phrase",
      phrase_placeholder: "e.g. My cat's name is Felix",
      phrase_help: "This phrase lets you recover your space. Minimum 8 characters.",
      create_button: "Create my anonymous space",
      login_title: "I already have a space",
      login_subtitle: "Sign in with your ID or phrase",
      input_placeholder: "CB_xxxxxxxx or your secret phrase",
      login_button: "Sign in",
      success_title: "Your space is created!",
      success_id: "Your anonymous ID:",
      success_phrase: "Your secret phrase:",
      success_warning: "Copy your ID or remember your phrase — they are the only way to access your space from any device.",
      copy_id: "Copy ID",
      understood: "I understand, continue",
      error_invalid: "Invalid ID or secret phrase",
      error_short: "Phrase must be at least 8 characters"
    },
    feed: {
      title: "Feed",
      publish_placeholder: "Share your story, safely...",
      publish_button: "Publish",
      filter_all: "All",
      filter_ruptures: "Breakups",
      filter_isolement: "Isolation",
      filter_traumas: "Trauma",
      filter_stress: "Stress",
      filter_spiritualite: "Spirituality",
      filter_espoir: "Hope",
      reactions: "reactions",
      comments: "replies",
      view_comments: "Read & reply",
      edit: "Edit",
      delete: "Delete",
      delete_confirm: "Delete this confidence? This cannot be undone.",
      no_confidences: "No confidences yet. Be the first to share.",
      modal_title: "New Confidence",
      modal_emotion_label: "Emotional chapter",
      modal_publish: "Publish anonymously",
      modal_cancel: "Cancel",
      moderation_rejected: "Your message doesn't meet our guidelines",
      warning_title: "Need immediate help?",
      warning_message: "Your confidence was published. If you feel in immediate danger, these resources can help you now:",
      warning_note: "You don't have to be in crisis to call."
    },
    post: {
      back: "Back",
      add_comment: "Reply with kindness",
      comment_placeholder: "Write something kind...",
      send: "Send",
      no_comments: "No replies yet. Be the first to show support."
    },
    profile: {
      title: "My Profile",
      member_free: "Free Member",
      member_premium: "Premium Member",
      confidences_count: "confidences",
      reactions_received: "reactions received",
      responses_received: "replies received",
      people_helped: "people helped",
      streak: "day streak",
      my_confidences: "My Confidences",
      no_confidences: "You haven't published any confidence yet",
      view: "View",
      delete: "Delete",
      upgrade_title: "Upgrade to Premium",
      upgrade_description: "Unlimited confidences, forever storage + more",
      learn_more: "Learn more"
    },
    settings: {
      title: "Settings",
      language_title: "Language",
      avatar_title: "Avatar",
      avatar_description: "Your anonymous identity icon",
      my_id: "My Anonymous ID",
      my_id_help: "Keep this safe — it's the only way to recover your account.",
      logout: "Log out",
      delete_account: "Delete my account",
      delete_confirm: "Are you sure? This is permanent and cannot be undone.",
      saved: "Saved"
    },
    premium: {
      title: "Confidence Book Premium",
      subtitle: "Unlock the full potential of your space",
      feature1: "Unlimited storage",
      feature1_desc: "Your confidences stay forever",
      feature2: "Unlimited posts",
      feature2_desc: "No 20-confidence limit",
      feature3: "Advanced customization",
      feature3_desc: "Custom avatar and colors",
      feature4: "Emotional insights",
      feature4_desc: "Charts of your emotional journey",
      feature5: "Priority support",
      feature5_desc: "Response within 24h",
      price_title: "Pricing",
      price_monthly: "$2/month",
      price_yearly: "$20/year (save $4)",
      how_title: "How to pay?",
      how_step1: "Send a WhatsApp message to:",
      how_step2: "Say: Premium — [Your CB_ID]",
      how_step3: "Choose your plan (Mobile Money / PayPal)",
      how_step4: "Activated within 1 hour",
      contact_whatsapp: "Contact on WhatsApp",
      faq_title: "FAQ",
      faq_q1: "Can I cancel?",
      faq_a1: "Yes, anytime. Your data stays for 1 month after cancellation.",
      faq_q2: "What about my free confidences?",
      faq_a2: "They stay and will no longer be deleted.",
      faq_q3: "Payment methods?",
      faq_a3: "Mobile Money (MTN, Moov, Wave) or PayPal"
    },
    support: {
      title: "Support Confidence Book",
      subtitle: "Help us keep this platform free and kind",
      mission_title: "Our Mission",
      mission_text: "Confidence Book is a 100% free, ad-free platform for anonymous emotional support. Your support helps us:",
      mission1: "Keep the platform free for everyone",
      mission2: "Improve our AI moderation",
      mission3: "Add new features",
      mission4: "Stay independent — no ads",
      ways_title: "How to support?",
      way1_title: "Make a donation",
      way1_desc: "WhatsApp: +229 69 05 62 83 (Mobile Money / PayPal)",
      way2_title: "Upgrade to Premium",
      way2_desc: "$2/month to unlock advanced features",
      way3_title: "Share the platform",
      way3_desc: "Tell someone who might need it",
      way4_title: "Contribute to code",
      way4_desc: "Developers: contribute on GitHub",
      thanks: "Thank you for your support!"
    },
    reactions: {
      soutiens: "I support you",
      espoir: "Keep hope",
      compatis: "I empathize",
      pas_seul: "You're not alone",
      courage: "Courage",
      triste: "Heartbroken"
    },
    emotions: {
      ruptures: "Breakups",
      isolement: "Isolation",
      traumas: "Trauma",
      stress: "Stress",
      spiritualite: "Spirituality",
      espoir: "Hope"
    },
    common: {
      loading: "Loading...",
      error: "An error occurred",
      copied: "Copied!",
      just_now: "Just now",
      minutes: "m",
      hours: "h",
      days: "d"
    }
  },

  fr: {
    welcome: {
      title: "Bienvenue sur Confidence Book",
      subtitle: "Un refuge numérique où personne ne reste seul face à son histoire",
      mission: "Exprimez vos émotions, partagez vos expériences, recevez du soutien — 100% anonyme et bienveillant.",
      rules_title: "Nos Règles de Bienveillance",
      rule1: "Anonymat garanti — Aucune donnée personnelle requise",
      rule2: "Respect mutuel — Zéro tolérance pour la haine et le jugement",
      rule3: "Modération IA — Protection automatique contre les contenus nuisibles",
      rule4: "Temporalité — Les publications disparaissent après 90 jours (sauf Premium)",
      rule5: "Gratuit — Aucune publicité intrusive",
      accept: "J'accepte et je continue",
      emergency_title: "Besoin d'aide immédiate ?",
      emergency_subtitle: "Ces numéros sont disponibles 24h/24"
    },
    auth: {
      title: "Votre Espace Anonyme",
      create_title: "Créer mon espace",
      create_subtitle: "Choisissez une phrase secrète",
      phrase_placeholder: "Ex : Mon chat s'appelle Felix",
      phrase_help: "Cette phrase vous permettra de récupérer votre espace. Minimum 8 caractères.",
      create_button: "Créer mon espace anonyme",
      login_title: "J'ai déjà un espace",
      login_subtitle: "Connectez-vous avec votre ID ou phrase",
      input_placeholder: "CB_xxxxxxxx ou votre phrase secrète",
      login_button: "Se connecter",
      success_title: "Votre espace est créé !",
      success_id: "Votre ID anonyme :",
      success_phrase: "Votre phrase secrète :",
      success_warning: "Copiez votre ID ou retenez votre phrase — c'est le seul moyen d'accéder à votre espace depuis n'importe quel appareil.",
      copy_id: "Copier l'ID",
      understood: "J'ai compris, continuer",
      error_invalid: "ID ou phrase secrète invalide",
      error_short: "La phrase doit contenir au moins 8 caractères"
    },
    feed: {
      title: "Fil d'actualité",
      publish_placeholder: "Partagez votre histoire en toute sécurité...",
      publish_button: "Publier",
      filter_all: "Tous",
      filter_ruptures: "Ruptures",
      filter_isolement: "Isolement",
      filter_traumas: "Traumas",
      filter_stress: "Stress",
      filter_spiritualite: "Spiritualité",
      filter_espoir: "Espoir",
      reactions: "réactions",
      comments: "réponses",
      view_comments: "Lire & répondre",
      edit: "Modifier",
      delete: "Supprimer",
      delete_confirm: "Supprimer cette confidence ? Cette action est irréversible.",
      no_confidences: "Aucune confidence pour le moment. Soyez le premier à partager.",
      modal_title: "Nouvelle Confidence",
      modal_emotion_label: "Chapitre émotionnel",
      modal_publish: "Publier anonymement",
      modal_cancel: "Annuler",
      moderation_rejected: "Votre message ne respecte pas nos règles",
      warning_title: "Besoin d'aide immédiate ?",
      warning_message: "Votre confidence a été publiée. Si vous ressentez un danger immédiat, ces ressources peuvent vous aider MAINTENANT :",
      warning_note: "Vous n'avez pas besoin d'être en crise pour appeler."
    },
    post: {
      back: "Retour",
      add_comment: "Répondre avec bienveillance",
      comment_placeholder: "Écris quelque chose de bienveillant...",
      send: "Envoyer",
      no_comments: "Aucune réponse pour le moment. Soyez le premier à apporter du soutien."
    },
    profile: {
      title: "Mon Profil",
      member_free: "Membre Gratuit",
      member_premium: "Membre Premium",
      confidences_count: "confidences",
      reactions_received: "réactions reçues",
      responses_received: "réponses reçues",
      people_helped: "personnes aidées",
      streak: "jours consécutifs",
      my_confidences: "Mes Confidences",
      no_confidences: "Vous n'avez pas encore publié de confidence",
      view: "Voir",
      delete: "Supprimer",
      upgrade_title: "Passer à Premium",
      upgrade_description: "Confidences illimitées, conservation à vie + plus encore",
      learn_more: "En savoir plus"
    },
    settings: {
      title: "Paramètres",
      language_title: "Langue",
      avatar_title: "Avatar",
      avatar_description: "Votre icône d'identité anonyme",
      my_id: "Mon ID Anonyme",
      my_id_help: "Conservez-le précieusement — c'est le seul moyen de récupérer votre compte.",
      logout: "Déconnexion",
      delete_account: "Supprimer mon compte",
      delete_confirm: "Vous êtes sûr ? Cette action est permanente et irréversible.",
      saved: "Sauvegardé"
    },
    premium: {
      title: "Confidence Book Premium",
      subtitle: "Débloquez tout le potentiel de votre espace",
      feature1: "Conservation illimitée",
      feature1_desc: "Vos confidences restent à vie",
      feature2: "Publications illimitées",
      feature2_desc: "Pas de limite des 20 confidences",
      feature3: "Personnalisation avancée",
      feature3_desc: "Avatar et couleurs personnalisés",
      feature4: "Insights émotionnels",
      feature4_desc: "Graphiques de votre évolution émotionnelle",
      feature5: "Support prioritaire",
      feature5_desc: "Réponse garantie sous 24h",
      price_title: "Prix",
      price_monthly: "2€/mois",
      price_yearly: "20€/an (économisez 4€)",
      how_title: "Comment payer ?",
      how_step1: "Envoyez un message WhatsApp à :",
      how_step2: "Indiquez : Premium — [Votre CB_ID]",
      how_step3: "Choisissez votre formule (Mobile Money / PayPal)",
      how_step4: "Activation sous 1h après paiement",
      contact_whatsapp: "Contacter sur WhatsApp",
      faq_title: "Questions fréquentes",
      faq_q1: "Puis-je annuler ?",
      faq_a1: "Oui, à tout moment. Vos données restent accessibles 1 mois après annulation.",
      faq_q2: "Mes confidences gratuites ?",
      faq_a2: "Elles restent accessibles et ne seront plus supprimées.",
      faq_q3: "Moyens de paiement ?",
      faq_a3: "Mobile Money (MTN, Moov, Wave) ou PayPal"
    },
    support: {
      title: "Soutenir Confidence Book",
      subtitle: "Ensemble, gardons cette plateforme gratuite et bienveillante",
      mission_title: "Notre Mission",
      mission_text: "Confidence Book est une plateforme 100% gratuite, sans publicité, dédiée au soutien émotionnel anonyme. Votre soutien nous permet de :",
      mission1: "Maintenir la plateforme gratuite pour tous",
      mission2: "Améliorer l'intelligence artificielle de modération",
      mission3: "Ajouter de nouvelles fonctionnalités",
      mission4: "Rester indépendants — pas de publicité",
      ways_title: "Comment soutenir ?",
      way1_title: "Faire un don",
      way1_desc: "WhatsApp : +229 69 05 62 83 (Mobile Money / PayPal)",
      way2_title: "Passer Premium",
      way2_desc: "2€/mois pour débloquer des fonctionnalités avancées",
      way3_title: "Partager la plateforme",
      way3_desc: "Parlez-en à quelqu'un qui pourrait en avoir besoin",
      way4_title: "Contribuer au code",
      way4_desc: "Développeurs : contribuez sur GitHub",
      thanks: "Merci pour votre soutien !"
    },
    reactions: {
      soutiens: "Je te soutiens",
      espoir: "Garde espoir",
      compatis: "Je compatis",
      pas_seul: "T'es pas seul·e",
      courage: "Courage",
      triste: "Triste"
    },
    emotions: {
      ruptures: "Ruptures",
      isolement: "Isolement",
      traumas: "Traumas",
      stress: "Stress",
      spiritualite: "Spiritualité",
      espoir: "Espoir"
    },
    common: {
      loading: "Chargement...",
      error: "Une erreur est survenue",
      copied: "Copié !",
      just_now: "À l'instant",
      minutes: "min",
      hours: "h",
      days: "j"
    }
  }
};

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Get current language — always reads from localStorage, defaults to 'en'
 */
function getCurrentLanguage() {
  return localStorage.getItem(CB_LANG_KEY) || CB_DEFAULT_LANG;
}

/**
 * Translate a key like 'feed.title' in current language
 */
function t(key, lang) {
  const l = lang || getCurrentLanguage();
  const keys = key.split('.');
  let value = translations[l] || translations[CB_DEFAULT_LANG];
  for (const k of keys) { value = value?.[k]; }
  return value || key;
}

/**
 * Apply translations to all elements with data-i18n attribute
 * No page reload needed — call this after changing language
 */
function applyTranslations(lang) {
  const l = lang || getCurrentLanguage();

  // Text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key, l);
    if (translated && translated !== key) el.textContent = translated;
  });

  // Placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const translated = t(key, l);
    if (translated && translated !== key) el.placeholder = translated;
  });

  // HTML content (for elements that need HTML, use sparingly)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    const translated = t(key, l);
    if (translated && translated !== key) el.innerHTML = translated;
  });

  // Update html lang attribute
  document.documentElement.lang = l;
}

/**
 * Change language, save to localStorage, apply immediately — NO RELOAD
 */
function setLanguage(lang) {
  if (!translations[lang]) return;
  localStorage.setItem(CB_LANG_KEY, lang);
  applyTranslations(lang);
}

// Auto-apply on script load (so any page that includes this file gets translated)
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations(getCurrentLanguage());
});
