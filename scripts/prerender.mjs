// Post-build step: write a static HTML file for each public route so search
// engines, AI crawlers and link previews see real text and page-specific
// metadata without running JavaScript. React replaces the #root contents on
// load, so visitors see the normal app.
//
// Output: dist/<route>.html, served at /<route> via "cleanUrls" in vercel.json.
// Optional: set VITE_GA_ID (e.g. G-ABC123) in Vercel to enable Google Analytics.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://www.kartcade.com';
const DIST = 'dist';
const GA_ID = process.env.VITE_GA_ID || '';

const NAP = `<p>Kartcade, 18750 Willamette Dr, West Linn, OR 97068 · <a href="tel:+15034909194">503-490-9194</a> · <a href="/book">Book a session</a></p>
<p>Hours: Wed and Thu 2pm to 8pm, Fri 2pm to 9pm, Sat 10am to 9pm, Sun 10am to 7pm. Closed Mon and Tue.</p>`;

const routes = [
  {
    path: '/',
    title: 'Kartcade | Racing & Flight Simulator Lounge | West Linn, Oregon',
    description: "Oregon's first racing and flight simulator lounge. 10 simulators, from kid-friendly karts to a full-motion rig. Walk in or book online in West Linn, near Lake Oswego and Portland.",
    body: `<h1>Kartcade: Oregon's first racing and flight simulator lounge</h1>
<p>Race head-to-head on 10 networked simulators, or fly anywhere in the world in Microsoft Flight Simulator. No experience needed. Ages 5 and up.</p>
<ul><li>Racing karts for kids and teens</li><li>Direct-drive full sim rigs</li><li>Full-motion simulator</li><li>Flight simulator with HOTAS controls</li></ul>
<p>Hourly sessions, birthday parties, corporate team building and private events, 20 minutes from downtown Portland.</p>`,
  },
  {
    path: '/pricing',
    title: 'Pricing | Racing Simulator Sessions from $30/hr | Kartcade West Linn',
    description: 'Racing karts $30/hr, full sim rigs $40/hr, flight sim $40/hr, motion simulator $50/hr. Priced per person, everyone gets their own rig. Birthday parties from $400.',
    body: `<h1>Kartcade pricing</h1>
<p>Pricing is per person per hour. Everyone in your group gets their own simulator, so nobody waits for a turn.</p>
<ul><li>Racing Karts (ages 5+): $30/hour</li><li>Full Sim Rig, direct drive (ages 10+): $40/hour</li><li>Motion Simulator (ages 14+): $50/hour</li><li>Flight Simulator (all ages): $40/hour</li><li>Birthday parties: from $400</li><li>Corporate events: custom quotes</li></ul>`,
  },
  {
    path: '/experiences',
    title: 'Experiences | Sim Racing, Drifting & Flight Simulation | Kartcade',
    description: 'Race F1, GT and rally cars, drift, or fly 250+ aircraft. 20+ racing titles plus Microsoft Flight Simulator 2024, Star Wars: Squadrons and more at Kartcade in West Linn.',
    body: `<h1>Racing and flight simulator experiences</h1>
<p>Over 20 driving games for head-to-head racing, plus a dedicated flight simulator running Microsoft Flight Simulator 2024, Star Wars: Squadrons, Ace Combat 7 and Digital Combat Simulator.</p>`,
  },
  {
    path: '/equipment',
    title: 'Our Simulators | Motion Rig, Direct-Drive Rigs, Karts & Flight Sim | Kartcade',
    description: 'See the 10 simulators at Kartcade: a full-motion rig, pro-grade direct-drive racing rigs, racing karts for kids and teens, and a HOTAS flight simulator.',
    body: `<h1>Our simulators</h1><ul><li>Full-motion racing simulator</li><li>Pro-grade direct-drive racing rigs</li><li>Racing karts for kids and teens</li><li>Flight simulator</li></ul>`,
  },
  {
    path: '/events',
    title: 'Birthday Parties & Corporate Events | Kartcade Racing Simulator Lounge',
    description: 'Host a birthday party, team-building tournament or private buyout on 10 racing and flight simulators in West Linn, Oregon. Up to 40 guests, $400 for 2 hours.',
    body: `<h1>Birthday parties and private events</h1><p>Birthday parties, corporate team building with tournaments and leaderboards, and private buyouts. Up to 40 guests: $400 for 2 hours, $200 for each extra hour.</p>`,
  },
  {
    path: '/membership',
    title: 'Membership | Race More for Less | Kartcade',
    description: 'Kartcade memberships for regular racers: better hourly rates and member perks at Oregon\'s first sim racing lounge.',
    body: `<h1>Kartcade membership</h1><p>Discounted hourly rates and perks for regular drivers.</p>`,
  },
  {
    path: '/leaderboard',
    title: 'Lap Time Leaderboard | Kartcade',
    description: 'Fastest lap times set at Kartcade. Post your time and try to take the top spot.',
    body: `<h1>Lap time leaderboard</h1><p>The fastest drivers at Kartcade. Every session can post a time.</p>`,
  },
  {
    path: '/faq',
    title: 'FAQ | Ages, Walk-ins, What to Wear | Kartcade Racing Simulators',
    description: 'Answers about age requirements, walk-ins, what to wear, group pricing and parties at Kartcade racing and flight simulator lounge in West Linn.',
    body: `<h1>Frequently asked questions</h1><p>Ages, walk-ins, what to wear, group pricing and party details.</p>`,
  },
  {
    path: '/gallery',
    title: 'Gallery | Kartcade Racing Simulator Lounge',
    description: 'Photos of the simulators, events and parties at Kartcade in West Linn, Oregon.',
    body: `<h1>Gallery</h1>`,
  },
  {
    path: '/about',
    title: "About Kartcade | Oregon's First Racing Simulator Lounge",
    description: "Kartcade is Oregon's first racing and flight simulator lounge, featured on KOIN 6 and FOX 12. Located on Willamette Drive in West Linn.",
    body: `<h1>About Kartcade</h1><p>Oregon's first racing and flight simulator lounge, as featured on KOIN 6 and FOX 12.</p>`,
  },
  {
    path: '/contact',
    title: 'Contact & Directions | Kartcade West Linn',
    description: 'Find Kartcade at 18750 Willamette Dr, West Linn, OR. Call 503-490-9194 or email info@kartcade.com.',
    body: `<h1>Contact Kartcade</h1><p>Email <a href="mailto:info@kartcade.com">info@kartcade.com</a></p>`,
  },
  {
    path: '/rules',
    title: 'Rules & Safety | Kartcade',
    description: 'Lounge rules, age guidelines and safety information for Kartcade racing and flight simulators.',
    body: `<h1>Rules and safety</h1>`,
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const gaSnippet = GA_ID
  ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>`
  : '';

const template = readFileSync(join(DIST, 'index.html'), 'utf8');

// Untouched SPA shell for every other route (booking, login, checkout, equipment details).
writeFileSync(join(DIST, 'app.html'), template.replace('</head>', `  ${gaSnippet}\n</head>`));
console.log('wrote SPA fallback -> dist/app.html');

for (const r of routes) {
  const url = SITE + (r.path === '/' ? '/' : r.path);
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(r.title)}</title>`)
    .replace(/<meta name="description"[\s\S]*?\/>/, `<meta name="description" content="${esc(r.description)}" />`)
    .replace(/<meta property="og:title"[\s\S]*?\/>/, `<meta property="og:title" content="${esc(r.title)}" />`)
    .replace(/<meta property="og:description"[\s\S]*?\/>/, `<meta property="og:description" content="${esc(r.description)}" />`)
    .replace('</head>', `  <link rel="canonical" href="${url}" />\n  <meta property="og:url" content="${url}" />\n  ${gaSnippet}\n</head>`)
    .replace('<div id="root"></div>', `<div id="root"><main>${r.body}\n${NAP}</main></div>`);

  const file = r.path === '/' ? 'index.html' : `${r.path.slice(1)}.html`;
  writeFileSync(join(DIST, file), html);
  console.log(`prerendered ${r.path} -> dist/${file}`);
}
