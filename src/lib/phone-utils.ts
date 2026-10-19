/**
 * CouturPro — Utilitaires Téléphonie & Indicatifs Afrique de l'Ouest
 * 
 * Permet la détection automatique de l'indicatif, la normalisation des numéros
 * et la génération d'identifiants internes Supabase Auth pour les artisans sans email.
 */

export interface WestAfricanCountry {
  code: string;       // ex: "BF"
  name: string;       // ex: "Burkina Faso"
  dialCode: string;   // ex: "+226"
  flag: string;       // ex: "🇧🇫"
  exampleLength: number[]; // longueurs typiques de numéros
}

export const WEST_AFRICAN_COUNTRIES: WestAfricanCountry[] = [
  { code: "BF", name: "Burkina Faso", dialCode: "+226", flag: "🇧🇫", exampleLength: [8] },
  { code: "CI", name: "Côte d'Ivoire", dialCode: "+225", flag: "🇨🇮", exampleLength: [10] },
  { code: "SN", name: "Sénégal", dialCode: "+221", flag: "🇸🇳", exampleLength: [9] },
  { code: "ML", name: "Mali", dialCode: "+223", flag: "🇲🇱", exampleLength: [8] },
  { code: "GN", name: "Guinée", dialCode: "+224", flag: "🇬🇳", exampleLength: [9] },
  { code: "TG", name: "Togo", dialCode: "+228", flag: "🇹🇬", exampleLength: [8] },
  { code: "BJ", name: "Bénin", dialCode: "+229", flag: "🇧🇯", exampleLength: [8, 10] },
  { code: "NE", name: "Niger", dialCode: "+227", flag: "🇳🇪", exampleLength: [8] },
  { code: "CM", name: "Cameroun", dialCode: "+237", flag: "🇨🇲", exampleLength: [9] },
  { code: "GA", name: "Gabon", dialCode: "+241", flag: "🇬🇦", exampleLength: [7, 8] },
  { code: "CG", name: "Congo", dialCode: "+242", flag: "🇨🇬", exampleLength: [9] },
  { code: "GH", name: "Ghana", dialCode: "+233", flag: "🇬🇭", exampleLength: [9] },
  { code: "NG", name: "Nigéria", dialCode: "+234", flag: "🇳🇬", exampleLength: [10, 11] },
];

/**
 * Nettoie une chaîne pour ne conserver que les chiffres.
 */
export function extractDigits(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

/**
 * Détecte si l'identifiant saisi est un email ou un numéro de téléphone.
 */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/**
 * Détecte automatiquement le pays ou l'indicatif à partir du texte saisi.
 * Recherche par indicatif international (+226, 00226, 226...) ou format national.
 */
export function detectCountryFromPhone(phone: string): WestAfricanCountry | null {
  const clean = phone.trim();
  if (!clean) return null;

  // 1. Détection directe si préfixé par "+"
  if (clean.startsWith("+")) {
    for (const country of WEST_AFRICAN_COUNTRIES) {
      if (clean.startsWith(country.dialCode)) {
        return country;
      }
    }
  }

  // 2. Détection si préfixé par "00"
  if (clean.startsWith("00")) {
    const without00 = clean.slice(2);
    for (const country of WEST_AFRICAN_COUNTRIES) {
      const dialDigits = country.dialCode.replace("+", "");
      if (without00.startsWith(dialDigits)) {
        return country;
      }
    }
  }

  // 3. Détection par préfixe direct des chiffres (ex: 226...)
  const digits = extractDigits(clean);
  for (const country of WEST_AFRICAN_COUNTRIES) {
    const dialDigits = country.dialCode.replace("+", "");
    if (digits.startsWith(dialDigits) && digits.length > dialDigits.length + 5) {
      return country;
    }
  }

  return null;
}

/**
 * Calcule l'évaluation de validité indicative du numéro (non-bloquante pour laisser passer les tests).
 */
export function getPhoneValidationStatus(phone: string): {
  isValidFormat: boolean;
  detectedCountry: WestAfricanCountry | null;
  message: string | null;
} {
  const digits = extractDigits(phone);
  if (!digits) {
    return { isValidFormat: false, detectedCountry: null, message: null };
  }

  const country = detectCountryFromPhone(phone);
  if (country) {
    const dialDigits = country.dialCode.replace("+", "");
    const localDigitsLength = digits.startsWith(dialDigits)
      ? digits.slice(dialDigits.length).length
      : digits.length;

    const matchesExpected = country.exampleLength.includes(localDigitsLength);
    return {
      isValidFormat: matchesExpected,
      detectedCountry: country,
      message: matchesExpected
        ? `${country.flag} ${country.name} (${country.dialCode})`
        : `${country.flag} ${country.name} (${localDigitsLength} chiffres détectés)`,
    };
  }

  // Aucun indicatif international explicite : si le numéro a entre 8 et 10 chiffres (format national typique en Afrique de l'Ouest)
  if (digits.length >= 8 && digits.length <= 10) {
    return {
      isValidFormat: true,
      detectedCountry: null,
      message: `Numéro local (${digits.length} chiffres)`,
    };
  }

  return {
    isValidFormat: true, // Non-bloquant selon consigne utilisateur
    detectedCountry: null,
    message: null,
  };
}

/**
 * Génère l'identifiant interne déterministe pour Supabase Auth
 * à partir du numéro de téléphone.
 */
export function phoneToInternalEmail(phone: string): string {
  const digits = extractDigits(phone);
  return `tel_${digits}@couturpro.atelier`;
}
