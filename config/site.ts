import business, { stations, station, minPrice, weekRows } from "./business";

// Site Configuration - Kartcade Racing Simulator Lounge

export const siteConfig = {
  // Brand
  name: "Kartcade",
  tagline: "Race. Fly. Win.",
  description: "Oregon's premier racing simulator lounge featuring 10 state-of-the-art simulators. Experience racing, drifting, flying and more.",

  // Contact
  email: business.email,
  phone: business.phone,
  whatsapp: "15034909194", // Without + sign, used in wa.me links

  // Location
  address: {
    city: "West Linn",
    state: "Oregon",
    country: "USA",
  },

  // URLs
  siteUrl: "https://www.kartcade.com",
  giftCardsUrl: business.giftCardsUrl,
  googleMapsUrl: business.mapsUrl,

  // Social (add your social links)
  social: {
    twitter: "",
    linkedin: "",
    instagram: "",
    facebook: "",
  },

  // Business Info (for structured data)
  business: {
    priceRange: `$${minPrice} - $${business.party.basePrice}+`,
    openingHours: weekRows.map((r) => `${r.name.slice(0, 3)} ${r.label}`).join(", "),
    areaServed: "West Linn, Oregon",
    languages: ["English"]
  },

  // Colors (from logo - Italian racing flag)
  colors: {
    primary: "#D42428",      // Racing Red - CTAs, buttons
    secondary: "#2D9E49",    // Racing Green - Accents, hover
    background: "#0A0A0A",   // Dark background
    surface: "#141414",      // Cards, sections
    text: "#FFFFFF",         // Main text
    textMuted: "#9CA3AF",    // Secondary text
  },

  // Pricing
  pricing: {
    adultHourly: station("rigs").price,
    youthHourly: station("karts").price,
    birthdayPackage: business.party.basePrice,
    currency: "$",
  },

  // Equipment Stats
  stats: {
    totalSimulators: stations.reduce((n, s) => n + s.units, 0),
    racingKarts: station("karts").units,
    fullSizeRigs: station("rigs").units,
    motionSimulator: station("motion").units,
    flightSimulator: station("flight").units,
    maxConcurrentDrivers: stations.reduce((n, s) => n + s.units, 0),
    maxBirthdayGuests: business.party.maxGuests,
  }
};

export default siteConfig;
