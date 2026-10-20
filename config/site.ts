// Site Configuration - Kartcade Racing Simulator Lounge

export const siteConfig = {
  // Brand
  name: "Kartcade",
  tagline: "Race. Fly. Win.",
  description: "Oregon's premier racing simulator lounge featuring 10 state-of-the-art simulators. Experience racing, drifting, flying and more.",

  // Contact
  email: "info@kartcade.com",
  phone: "503-490-9194",
  whatsapp: "15034909194", // Without + sign, used in wa.me links

  // Location
  address: {
    city: "West Linn",
    state: "Oregon",
    country: "USA",
  },

  // URLs
  siteUrl: "https://www.kartcade.com",
  giftCardsUrl: "https://giftup.app/place-order/dd0ba2da-46cb-4e33-43c4-08de38bb5f40?platform=hosted",
  googleMapsUrl: "https://maps.app.goo.gl/KkMsyMYUE1E1H9Z36",

  // Social (add your social links)
  social: {
    twitter: "",
    linkedin: "",
    instagram: "",
    facebook: "",
  },

  // Business Info (for structured data)
  business: {
    priceRange: "$30 - $400+",
    openingHours: "Wed-Thu 2-8pm, Fri 2-9pm, Sat 10am-9pm, Sun 10am-7pm (closed Mon-Tue)",
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
    adultHourly: 40,
    youthHourly: 30,
    birthdayPackage: 400,
    currency: "$",
  },

  // Equipment Stats
  stats: {
    totalSimulators: 10,
    racingKarts: 5,
    fullSizeRigs: 4,
    motionSimulator: 1,
    flightSimulator: 1,
    maxConcurrentDrivers: 10,
    maxBirthdayGuests: 40,
  }
};

export default siteConfig;
