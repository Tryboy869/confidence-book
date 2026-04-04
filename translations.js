// Confidence Book — i18n via i18next (CDN, no bundler needed)
// Place this file at the ROOT of your repo as /translations.js
// Include in every HTML page: <script src="/translations.js"></script>
// Usage:  i18n.t('feed.title')   or    data-i18n="feed.title"

const CB_TRANSLATIONS = {
  en: {
    translation: {
      welcome: {
        tagline: "100% anonymous · No account required",
        hero_title: "No one should face their story alone.",
        hero_sub: "A safe, judgment-free space to share what you carry in silence. Express yourself freely, receive genuine support from real humans.",
        cta_start: "Start sharing anonymously",
        cta_read: "Read others' stories",
        features_title: "Why Confidence Book?",
        features_sub: "Built differently from every other platform.",
        how_title: "How it works",
        rules_title: "Community guidelines",
        crisis_title: "Need immediate help?",
        crisis_sub: "These crisis lines are free and available 24/7.",
        cta_bottom_title: "Ready to finally say it?",
        cta_bottom_sub: "No sign-up. No data. Just you and your story.",
        cta_bottom_btn: "Create my anonymous space"
      },
      auth: {
        title: "Your Anonymous Space",
        tab_create: "Create my space",
        tab_login: "I already have a space",
        phrase_label: "Choose a secret phrase",
        phrase_placeholder: "e.g. My cat's name is Felix",
        phrase_help: "This phrase lets you recover your space. Minimum 8 characters.",
        create_btn: "Create my anonymous space",
        login_label: "Enter your ID or secret phrase",
        login_placeholder: "CB_xxxxxxxx or your secret phrase",
        login_btn: "Sign in",
        save_title: "Save your ID!",
        save_sub: "Without it, you can <strong>never</strong> recover your space.",
        copy_id: "Copy ID",
        download_id: "Download",
        confirm_label: "I've saved my ID or secret phrase. I understand that without them, my space is inaccessible.",
        continue_btn: "Access my space →",
        error_short: "Phrase must be at least 8 characters.",
        error_invalid: "Invalid ID or secret phrase. Check your input.",
        creating: "Creating...",
        signing_in: "Signing in..."
      },
      feed: {
        title: "Confidence Book",
        compose_placeholder: "Share your story, safely...",
        compose_tag: "1 left this week",
        limit_week: "You've already shared this week. Next reset: {{date}}",
        filter_all: "All",
        filter_ruptures: "💔 Breakups",
        filter_isolement: "😔 Isolation",
        filter_traumas: "🔥 Trauma",
        filter_stress: "🧠 Stress",
        filter_spiritualite: "🪞 Spirituality",
        filter_espoir: "🤝 Hope",
        subscribe: "Subscribe",
        subscribed: "Subscribed ✓",
        subscribe_desc: "Get notified when someone shares in this category",
        publish_title: "New Confidence",
        publish_placeholder: "Express yourself freely. Sadness, anger, fear, hope... everything is welcome.",
        emotion_label: "Emotional chapter",
        publish_btn: "Publish anonymously",
        cancel: "Cancel",
        analyzing: "Analyzing...",
        moderation_msg: "AI moderation in progress...",
        moderation_sub: "Your message is being reviewed for safety",
        load_more: "Load more",
        no_confidences: "No confidences yet in this category. Be the first to share.",
        react: "React",
        reacted: "✓ Reacted",
        reply: "reply",
        replies: "replies",
        read_reply: "Read & reply →",
        delete: "Delete",
        delete_confirm: "Delete this confidence? This cannot be undone.",
        people_reacted: "{{n}} person reacted",
        people_reacted_plural: "{{n}} people reacted",
        warning_title: "Need immediate help?",
        warning_sub: "Your confidence was published. If you feel in immediate danger:",
        safe_btn: "I'm safe, continue",
        prompt_week: "Question of the week",
        answer_prompt: "Answer this →",
        notification_title: "Notifications",
        mark_read: "Mark all read",
        no_notifications: "No notifications yet",
        emotion_ruptures: "Breakups",
        emotion_isolement: "Isolation",
        emotion_traumas: "Trauma",
        emotion_stress: "Stress",
        emotion_spiritualite: "Spirituality",
        emotion_espoir: "Hope",
        react_soutiens: "I support you",
        react_espoir: "Keep hope",
        react_compatis: "I empathize",
        react_pas_seul: "You're not alone",
        react_courage: "Courage",
        react_triste: "Heartbroken for you",
        reactions_question: "How does this confidence make you feel?"
      },
      post: {
        back: "Back",
        reply_title: "Reply with kindness",
        reply_placeholder: "Write something kind...",
        send: "Send",
        sending: "Sending...",
        no_replies: "No replies yet. Be the first to show support.",
        limit_comments: "You've reached your {{n}} comments limit today. Resets at {{time}}.",
        share_title: "Share this confidence",
        share_copied: "Link copied!",
        share_btn: "Share",
        delete_confirm: "Delete this confidence?",
        react_btn: "+ React",
        reacted_btn: "✓ Reacted",
        touched: "{{n}} person was touched by this",
        touched_plural: "{{n}} people were touched by this"
      },
      profile: {
        title: "My Profile",
        free: "Free Member",
        premium: "Premium Member",
        confidences: "confidences",
        reactions: "reactions received",
        replies: "replies received",
        helped: "people helped",
        streak: "day streak",
        emotion_chart: "My emotional journey",
        my_confidences: "My Confidences",
        no_confidences: "You haven't published any confidence yet",
        upgrade_title: "Upgrade to Premium",
        upgrade_desc: "Unlimited confidences, forever storage + more",
        learn_more: "Learn more",
        install_title: "Install the app",
        install_desc: "Add Confidence Book to your home screen",
        install_btn: "Install Confidence Book"
      },
      settings: {
        title: "Settings",
        language: "Language",
        avatar: "Avatar",
        avatar_desc: "Your anonymous identity icon",
        my_id: "My Anonymous ID",
        my_id_help: "Keep this safe — it's the only way to recover your account.",
        account: "Account",
        logout: "Log out",
        delete: "Delete my account",
        delete_confirm: "Are you sure? This is permanent and cannot be undone.",
        saved: "Saved",
        install_title: "Install the app",
        install_desc: "Add Confidence Book to your home screen for quick access",
        install_btn: "Install Confidence Book"
      },
      common: {
        loading: "Loading...",
        error: "An error occurred. Please try again.",
        copied: "Copied!",
        just_now: "Just now",
        minutes: "m",
        hours: "h",
        days: "d",
        cancel: "Cancel",
        confirm: "Confirm"
      }
    }
  },
  fr: {
    translation: {
      welcome: {
        tagline: "100% anonyme · Sans inscription",
        hero_title: "Personne ne doit rester seul face à son histoire.",
        hero_sub: "Un espace sûr et bienveillant pour partager ce que tu portes en silence. Exprime-toi librement, reçois un vrai soutien humain.",
        cta_start: "Commencer à partager anonymement",
        cta_read: "Lire les histoires des autres",
        features_title: "Pourquoi Confidence Book ?",
        features_sub: "Construit différemment de toutes les autres plateformes.",
        how_title: "Comment ça marche",
        rules_title: "Règles de la communauté",
        crisis_title: "Besoin d'aide immédiate ?",
        crisis_sub: "Ces lignes de crise sont gratuites et disponibles 24h/24.",
        cta_bottom_title: "Prêt·e à enfin le dire ?",
        cta_bottom_sub: "Sans inscription. Sans données. Juste toi et ton histoire.",
        cta_bottom_btn: "Créer mon espace anonyme"
      },
      auth: {
        title: "Votre Espace Anonyme",
        tab_create: "Créer mon espace",
        tab_login: "J'ai déjà un espace",
        phrase_label: "Choisissez une phrase secrète",
        phrase_placeholder: "Ex : Mon chat s'appelle Felix",
        phrase_help: "Cette phrase vous permettra de récupérer votre espace. Minimum 8 caractères.",
        create_btn: "Créer mon espace anonyme",
        login_label: "Entrez votre ID ou phrase secrète",
        login_placeholder: "CB_xxxxxxxx ou votre phrase secrète",
        login_btn: "Se connecter",
        save_title: "Sauvegarde ton ID !",
        save_sub: "Sans lui, tu ne pourras <strong>jamais</strong> récupérer ton espace.",
        copy_id: "Copier l'ID",
        download_id: "Télécharger",
        confirm_label: "J'ai sauvegardé mon ID ou ma phrase. Je comprends que sans eux, mon espace est inaccessible.",
        continue_btn: "Accéder à mon espace →",
        error_short: "La phrase doit contenir au moins 8 caractères.",
        error_invalid: "ID ou phrase secrète invalide. Vérifiez votre saisie.",
        creating: "Création...",
        signing_in: "Connexion..."
      },
      feed: {
        title: "Confidence Book",
        compose_placeholder: "Partagez votre histoire en toute sécurité...",
        compose_tag: "1 restant cette semaine",
        limit_week: "Tu as déjà publié cette semaine. Prochain reset le {{date}}",
        filter_all: "Tous",
        filter_ruptures: "💔 Ruptures",
        filter_isolement: "😔 Isolement",
        filter_traumas: "🔥 Traumas",
        filter_stress: "🧠 Stress",
        filter_spiritualite: "🪞 Spiritualité",
        filter_espoir: "🤝 Espoir",
        subscribe: "S'abonner",
        subscribed: "Abonné·e ✓",
        subscribe_desc: "Recevez une notification quand quelqu'un partage dans cette catégorie",
        publish_title: "Nouvelle Confidence",
        publish_placeholder: "Exprimez-vous librement. Tristesse, colère, peur, espoir... tout est bienvenu.",
        emotion_label: "Chapitre émotionnel",
        publish_btn: "Publier anonymement",
        cancel: "Annuler",
        analyzing: "Analyse en cours...",
        moderation_msg: "Modération IA en cours...",
        moderation_sub: "Votre message est analysé pour votre sécurité",
        load_more: "Charger plus",
        no_confidences: "Aucune confidence dans cette catégorie. Soyez le premier à partager.",
        react: "Réagir",
        reacted: "✓ Réagi",
        reply: "réponse",
        replies: "réponses",
        read_reply: "Lire & répondre →",
        delete: "Supprimer",
        delete_confirm: "Supprimer cette confidence ? Cette action est irréversible.",
        people_reacted: "{{n}} personne a réagi",
        people_reacted_plural: "{{n}} personnes ont réagi",
        warning_title: "Besoin d'aide immédiate ?",
        warning_sub: "Votre confidence a été publiée. Si vous êtes en danger immédiat :",
        safe_btn: "Je suis en sécurité, continuer",
        prompt_week: "Question de la semaine",
        answer_prompt: "Répondre à ça →",
        notification_title: "Notifications",
        mark_read: "Tout marquer comme lu",
        no_notifications: "Aucune notification pour le moment",
        emotion_ruptures: "Ruptures",
        emotion_isolement: "Isolement",
        emotion_traumas: "Traumas",
        emotion_stress: "Stress",
        emotion_spiritualite: "Spiritualité",
        emotion_espoir: "Espoir",
        react_soutiens: "Je te soutiens",
        react_espoir: "Garde espoir",
        react_compatis: "Je compatis",
        react_pas_seul: "T'es pas seul·e",
        react_courage: "Courage",
        react_triste: "Triste pour toi",
        reactions_question: "Comment cette confidence te touche ?"
      },
      post: {
        back: "Retour",
        reply_title: "Répondre avec bienveillance",
        reply_placeholder: "Écris quelque chose de bienveillant...",
        send: "Envoyer",
        sending: "Envoi...",
        no_replies: "Aucune réponse pour le moment. Soyez le premier à apporter du soutien.",
        limit_comments: "Tu as atteint ta limite de {{n}} commentaires aujourd'hui. Reset à {{time}}.",
        share_title: "Partager cette confidence",
        share_copied: "Lien copié !",
        share_btn: "Partager",
        delete_confirm: "Supprimer cette confidence ?",
        react_btn: "+ Réagir",
        reacted_btn: "✓ Réagi",
        touched: "{{n}} personne a été touchée par ceci",
        touched_plural: "{{n}} personnes ont été touchées par ceci"
      },
      profile: {
        title: "Mon Profil",
        free: "Membre Gratuit",
        premium: "Membre Premium",
        confidences: "confidences",
        reactions: "réactions reçues",
        replies: "réponses reçues",
        helped: "personnes aidées",
        streak: "jours consécutifs",
        emotion_chart: "Mon parcours émotionnel",
        my_confidences: "Mes Confidences",
        no_confidences: "Vous n'avez pas encore publié de confidence",
        upgrade_title: "Passer à Premium",
        upgrade_desc: "Confidences illimitées, conservation à vie + plus encore",
        learn_more: "En savoir plus",
        install_title: "Installer l'application",
        install_desc: "Ajoutez Confidence Book à votre écran d'accueil",
        install_btn: "Installer Confidence Book"
      },
      settings: {
        title: "Paramètres",
        language: "Langue",
        avatar: "Avatar",
        avatar_desc: "Votre icône d'identité anonyme",
        my_id: "Mon ID Anonyme",
        my_id_help: "Conservez-le précieusement — c'est le seul moyen de récupérer votre compte.",
        account: "Compte",
        logout: "Déconnexion",
        delete: "Supprimer mon compte",
        delete_confirm: "Vous êtes sûr·e ? Cette action est permanente et irréversible.",
        saved: "Sauvegardé",
        install_title: "Installer l'application",
        install_desc: "Ajoutez Confidence Book à votre écran d'accueil pour un accès rapide",
        install_btn: "Installer Confidence Book"
      },
      common: {
        loading: "Chargement...",
        error: "Une erreur est survenue. Réessayez.",
        copied: "Copié !",
        just_now: "À l'instant",
        minutes: "min",
        hours: "h",
        days: "j",
        cancel: "Annuler",
        confirm: "Confirmer"
      }
    }
  }
};

// ─── i18next init (CDN version — no bundler) ──────────────────────────────────
// Requires: <script src="https://unpkg.com/i18next@23/dist/umd/i18next.min.js"></script>
// before this file in your HTML

const CB_LANG_KEY = 'cbLang';

function _initI18n() {
  const lang = localStorage.getItem(CB_LANG_KEY) || navigator.language?.slice(0, 2) || 'en';
  const resolvedLang = CB_TRANSLATIONS[lang] ? lang : 'en';

  i18next.init({
    lng: resolvedLang,
    fallbackLng: 'en',
    resources: CB_TRANSLATIONS,
    interpolation: { escapeValue: false }
  });

  document.documentElement.lang = resolvedLang;
  _applyDOM();
}

function _applyDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = i18next.t(key);
    if (val && val !== key) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    const val = i18next.t(key);
    if (val && val !== key) el.innerHTML = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const val = i18next.t(key);
    if (val && val !== key) el.placeholder = val;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Translate a key. Use like: t('feed.title') or t('post.touched', {n: 5}) */
function t(key, opts) {
  if (typeof i18next !== 'undefined' && i18next.isInitialized) {
    return i18next.t(key, opts) || key;
  }
  return key;
}

/** Get current language code ('en' or 'fr') */
function getCurrentLanguage() {
  return localStorage.getItem(CB_LANG_KEY) || 'en';
}

/** Change language instantly, no page reload */
function setLanguage(lang) {
  if (!CB_TRANSLATIONS[lang]) return;
  localStorage.setItem(CB_LANG_KEY, lang);
  i18next.changeLanguage(lang, () => {
    document.documentElement.lang = lang;
    _applyDOM();
    // Fire custom event so pages can react if needed
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  });
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initI18n);
} else {
  _initI18n();
}
