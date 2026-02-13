import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type Language = "en" | "hi" | "mr" | "te" | "kn";

export const LANGUAGES: { code: Language; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "mr", label: "Marathi", nativeLabel: "मराठी" },
  { code: "te", label: "Telugu", nativeLabel: "తెలుగు" },
  { code: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ" },
];

// Translation keys
const translations: Record<Language, Record<string, string>> = {
  en: {
    "nav.home": "Home",
    "nav.transactions": "Transactions",
    "nav.health": "Health",
    "nav.assistant": "Assistant",
    "nav.more": "More",
    "home.greeting": "Good",
    "home.morning": "Morning",
    "home.afternoon": "Afternoon",
    "home.evening": "Evening",
    "home.todayEarnings": "Today's Earnings",
    "home.quickActions": "Quick Actions",
    "home.recentTransactions": "Recent Transactions",
    "home.pendingReminders": "Pending Reminders",
    "home.addIncome": "Add Income",
    "home.addExpense": "Add Expense",
    "home.carCheck": "Car Check",
    "home.notes": "Notes",
    "home.noTransactions": "No transactions yet",
    "home.viewAll": "View All",
    "common.driver": "Driver",
  },
  hi: {
    "nav.home": "होम",
    "nav.transactions": "लेन-देन",
    "nav.health": "स्वास्थ्य",
    "nav.assistant": "सहायक",
    "nav.more": "और",
    "home.greeting": "शुभ",
    "home.morning": "प्रभात",
    "home.afternoon": "दोपहर",
    "home.evening": "संध्या",
    "home.todayEarnings": "आज की कमाई",
    "home.quickActions": "त्वरित कार्य",
    "home.recentTransactions": "हाल के लेन-देन",
    "home.pendingReminders": "लंबित अनुस्मारक",
    "home.addIncome": "आय जोड़ें",
    "home.addExpense": "खर्च जोड़ें",
    "home.carCheck": "कार जांच",
    "home.notes": "नोट्स",
    "home.noTransactions": "अभी तक कोई लेन-देन नहीं",
    "home.viewAll": "सभी देखें",
    "common.driver": "ड्राइवर",
  },
  mr: {
    "nav.home": "होम",
    "nav.transactions": "व्यवहार",
    "nav.health": "आरोग्य",
    "nav.assistant": "सहाय्यक",
    "nav.more": "अधिक",
    "home.greeting": "शुभ",
    "home.morning": "सकाळ",
    "home.afternoon": "दुपार",
    "home.evening": "संध्याकाळ",
    "home.todayEarnings": "आजची कमाई",
    "home.quickActions": "जलद कृती",
    "home.recentTransactions": "अलीकडील व्यवहार",
    "home.pendingReminders": "प्रलंबित स्मरणपत्रे",
    "home.addIncome": "उत्पन्न जोडा",
    "home.addExpense": "खर्च जोडा",
    "home.carCheck": "कार तपासणी",
    "home.notes": "नोट्स",
    "home.noTransactions": "अजून कोणतेही व्यवहार नाहीत",
    "home.viewAll": "सर्व पहा",
    "common.driver": "चालक",
  },
  te: {
    "nav.home": "హోమ్",
    "nav.transactions": "లావాదేవీలు",
    "nav.health": "ఆరోగ్యం",
    "nav.assistant": "సహాయకుడు",
    "nav.more": "మరిన్ని",
    "home.greeting": "శుభ",
    "home.morning": "ఉదయం",
    "home.afternoon": "మధ్యాహ్నం",
    "home.evening": "సాయంత్రం",
    "home.todayEarnings": "నేటి ఆదాయం",
    "home.quickActions": "త్వరిత చర్యలు",
    "home.recentTransactions": "ఇటీవల లావాదేవీలు",
    "home.pendingReminders": "పెండింగ్ రిమైండర్లు",
    "home.addIncome": "ఆదాయం జోడించు",
    "home.addExpense": "ఖర్చు జోడించు",
    "home.carCheck": "కారు తనిఖీ",
    "home.notes": "నోట్స్",
    "home.noTransactions": "ఇంకా లావాదేవీలు లేవు",
    "home.viewAll": "అన్నీ చూడండి",
    "common.driver": "డ్రైవర్",
  },
  kn: {
    "nav.home": "ಮುಖಪುಟ",
    "nav.transactions": "ವಹಿವಾಟುಗಳು",
    "nav.health": "ಆರೋಗ್ಯ",
    "nav.assistant": "ಸಹಾಯಕ",
    "nav.more": "ಇನ್ನಷ್ಟು",
    "home.greeting": "ಶುಭ",
    "home.morning": "ಬೆಳಿಗ್ಗೆ",
    "home.afternoon": "ಮಧ್ಯಾಹ್ನ",
    "home.evening": "ಸಂಜೆ",
    "home.todayEarnings": "ಇಂದಿನ ಗಳಿಕೆ",
    "home.quickActions": "ತ್ವರಿತ ಕ್ರಿಯೆಗಳು",
    "home.recentTransactions": "ಇತ್ತೀಚಿನ ವಹಿವಾಟುಗಳು",
    "home.pendingReminders": "ಬಾಕಿ ಜ್ಞಾಪನೆಗಳು",
    "home.addIncome": "ಆದಾಯ ಸೇರಿಸಿ",
    "home.addExpense": "ಖರ್ಚು ಸೇರಿಸಿ",
    "home.carCheck": "ಕಾರು ಪರಿಶೀಲನೆ",
    "home.notes": "ಟಿಪ್ಪಣಿಗಳು",
    "home.noTransactions": "ಇನ್ನೂ ವಹಿವಾಟುಗಳಿಲ್ಲ",
    "home.viewAll": "ಎಲ್ಲಾ ನೋಡಿ",
    "common.driver": "ಚಾಲಕ",
  },
};

type I18nContextType = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextType>({
  language: "en",
  setLanguage: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("dh-lang");
    return (saved as Language) || "en";
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("dh-lang", lang);
  }, []);

  const t = useCallback(
    (key: string): string => {
      return translations[language]?.[key] || translations.en[key] || key;
    },
    [language]
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
