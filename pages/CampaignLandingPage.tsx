import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Phone, Mail, MapPin, Sparkles } from 'lucide-react';
import bookingConfig from '../config/booking';
import business, { station } from '../config/business';

const CampaignLandingPage: React.FC = () => {
    const location = useLocation();
    const [logStatus, setLogStatus] = useState<string>('pending');
    
    // Identify channel from the URL path: /mailer, /august, /email
    const path = location.pathname.toLowerCase();
    const channel = path.includes('mailer') ? 'mailer' : (path.includes('email') ? 'email' : 'august');

    useEffect(() => {
        // Set document title
        document.title = "1st Anniversary | 50% Off Simulator Sessions | Kartcade";

        // Add robots noindex meta tag to keep this page out of search engine indexes
        let metaRobots = document.querySelector('meta[name="robots"]');
        if (!metaRobots) {
            metaRobots = document.createElement('meta');
            metaRobots.setAttribute('name', 'robots');
            document.head.appendChild(metaRobots);
        }
        metaRobots.setAttribute('content', 'noindex, nofollow');

        // Log scan/hit server-side
        const logScan = async () => {
            try {
                const response = await fetch(`/api/log-scan?channel=${channel}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await response.json();
                if (data.success) {
                    setLogStatus('success');
                } else {
                    setLogStatus('ignored_or_failed');
                }
            } catch (err) {
                console.error('Error logging scan server-side:', err);
                setLogStatus('error');
            }
        };

        logScan();

        return () => {
            if (metaRobots) {
                metaRobots.removeAttribute('content');
            }
        };
    }, [channel]);

    const simulatorOffers = [
        {
            id: 'karts',
            title: "Racing Karts",
            ageReq: `Ages ${station('karts').ageLabel}`,
            desc: "Designed for younger drivers and beginners. Casual, fun, and responsive.",
            normalPrice: bookingConfig.stations.karts.price,
            promoPrice: bookingConfig.stations.karts.price / 2,
            image: "/images/kartcade/karts.webp",
            tag: "5 Units"
        },
        {
            id: 'rigs',
            title: "Full-Size Rigs",
            ageReq: `Ages ${station('rigs').ageLabel}`,
            desc: "Professional direct-drive steering wheels and high-fidelity load cell pedals.",
            normalPrice: bookingConfig.stations.rigs.price,
            promoPrice: bookingConfig.stations.rigs.price / 2,
            image: "/images/kartcade/rigs.webp",
            tag: "4 Units"
        },
        {
            id: 'motion',
            title: "Motion Simulator",
            ageReq: `Ages ${station('motion').ageLabel}`,
            desc: "The ultimate ride. Triple screen wrapping with a physical pitch/roll platform.",
            normalPrice: bookingConfig.stations.motion.price,
            promoPrice: bookingConfig.stations.motion.price / 2,
            image: "/images/kartcade/motion_home.webp",
            tag: "1 Unit"
        },
        {
            id: 'flight',
            title: "Flight Simulator",
            ageReq: station('flight').ageLabel,
            desc: "Full HOTAS throttle and flight stick setups. Aerial combat and space flight.",
            normalPrice: bookingConfig.stations.flight.price,
            promoPrice: bookingConfig.stations.flight.price / 2,
            image: "/images/kartcade/flight_home.webp",
            tag: "1 Unit"
        }
    ];

    const videoGames = [
        {
            name: "F1 25",
            category: "Formula Simulator",
            videoUrl: "https://firebasestorage.googleapis.com/v0/b/kartcade-website.firebasestorage.app/o/F1%202025.MOV%20(1).mp4?alt=media&token=f2ba986c-7684-4957-b3e3-c92371f923bc",
            tags: ["Official Sim", "Formula 1"],
            desc: "The official video game of the FIA Formula One World Championship with pro-level physics.",
            videoClass: "object-cover object-center scale-125 group-hover:scale-[1.35]"
        },
        {
            name: "Assetto Corsa Rally",
            category: "Dirt & Rally",
            videoUrl: "https://firebasestorage.googleapis.com/v0/b/kartcade-website.firebasestorage.app/o/assetto-rally%20(1).MOV?alt=media&token=3f44f6b1-c601-4143-ad93-09253931b241",
            tags: ["Rally", "Motion Support"],
            desc: "Thoroughly demanding, realistic rally driving on tight and twisting gravel or tarmac stages.",
            videoClass: "object-fill group-hover:scale-105"
        },
        {
            name: "Wreckfest",
            category: "Destruction Derby",
            videoUrl: "https://firebasestorage.googleapis.com/v0/b/kartcade-website.firebasestorage.app/o/Wreckfest%20(1).MOV?alt=media&token=61c10948-aaf3-4306-a096-ff8bdda6cdf2",
            tags: ["Destruction", "Fun"],
            desc: "Full-contact racing with spectacular physics, high-speed collisions, and structural chaos.",
            videoClass: "object-fill group-hover:scale-105"
        },
        {
            name: "Ace Combat 7",
            category: "Flight Simulator",
            videoUrl: "https://firebasestorage.googleapis.com/v0/b/kartcade-website.firebasestorage.app/o/acecombat%20(1).mp4?alt=media&token=2f32e8ba-0d9e-45c9-b104-fd3e7fe992f2",
            tags: ["360° Flight", "Action"],
            desc: "Soar through photorealistic skies, engage in dogfights, and experience authentic sorties.",
            videoClass: "object-cover object-center scale-125 group-hover:scale-[1.35]"
        },
        {
            name: "Assetto Corsa",
            category: "Track & Drift",
            videoUrl: "https://firebasestorage.googleapis.com/v0/b/kartcade-website.firebasestorage.app/o/assetto-corsa%20(1).mp4?alt=media&token=e0f8b768-d644-4689-af56-43cbe2caae03",
            tags: ["Mod Support", "Drifting"],
            desc: "Compete against friends in legendary performance cars on globally laser-scanned tracks.",
            videoClass: "object-cover object-center scale-125 group-hover:scale-[1.35]"
        },
        {
            name: "Automobilista 2",
            category: "Global Racing",
            videoUrl: "https://firebasestorage.googleapis.com/v0/b/kartcade-website.firebasestorage.app/o/Automobilista%20(1).mp4?alt=media&token=b9beee21-ebe3-4d03-9348-15fe8cb06bb3",
            tags: ["Hypercars", "Ultra Realism"],
            desc: "A massive collection of motorsports disciplines ranging from go karts to modern hypercars.",
            videoClass: "object-fill group-hover:scale-105"
        }
    ];

    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#2D9E49] selection:text-white pb-20">
            
            {/* Elegant Header - Minimalist */}
            <header className="w-full py-8 border-b border-white/5 bg-[#0A0A0A]">
                <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
                    <Link to="/" className="hover:opacity-85 transition-opacity">
                        <img 
                            src="/logo.png" 
                            alt="Kartcade Logo" 
                            className="h-7 w-auto"
                        />
                    </Link>
                    <a 
                        href="mailto:info@kartcade.com" 
                        className="text-xs font-bold uppercase tracking-widest text-white/50 hover:text-[#2D9E49] transition-colors flex items-center gap-2"
                    >
                        <Mail className="w-3.5 h-3.5" /> info@kartcade.com
                    </a>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 pt-12 sm:pt-20">
                
                {/* Hero / Introduction - Editorial & Typographic */}
                <div className="max-w-4xl mb-16 sm:mb-24">
                    {/* Anniversary Flag Accent */}
                    <div className="flex items-center gap-1.5 mb-6">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#2D9E49]"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-white"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-[#D42428]"></span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 ml-2">
                            August Anniversary Campaign
                        </span>
                    </div>

                    <h1 className="font-display text-4xl sm:text-7xl font-bold uppercase tracking-tight leading-[1.05] mb-8">
                        KARTCADE <br />
                        <span className="text-[#D42428]">1 YEAR</span> ANNIVERSARY
                    </h1>

                    <h2 className="font-display text-lg sm:text-xl font-bold uppercase tracking-widest text-[#2D9E49] mb-6">
                        THANK YOU FOR AN AMAZING FIRST YEAR!
                    </h2>

                    <p className="font-sans text-lg sm:text-xl text-white/60 leading-relaxed max-w-2xl">
                        To celebrate our first milestone, enjoy <strong className="text-white font-semibold">50% OFF</strong> all racing and flight simulator sessions throughout the entire month of <strong className="text-white font-semibold uppercase">August</strong>. Thank you for making our first year unforgettable.
                    </p>
                </div>

                {/* Big Offer Banner / CTA - Solid & Clean */}
                <div className="border border-white/10 rounded-2xl p-8 sm:p-12 mb-20 bg-white text-black relative overflow-hidden">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                        <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#D42428] mb-2">
                                Limited Time Offer
                            </div>
                            <h3 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight leading-none">
                                1/2 OFF ALL MONTH LONG
                            </h3>
                            <p className="text-black/60 text-sm mt-3 font-sans">
                                Valid on all Simulator & Kart bookings from August 1 to August 31, 2026.
                            </p>
                        </div>
                        <Link
                            to="/book"
                            className="inline-flex items-center justify-center gap-2.5 px-8 py-4 bg-[#D42428] hover:bg-[#B91C1C] text-white font-bold uppercase tracking-widest rounded-full transition-all duration-300 transform hover:-translate-y-0.5 text-xs select-none w-full md:w-auto text-center"
                        >
                            Book Simulator Session <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>

                {/* Anniversary Pricing Grid - clean borders, authentic imagery */}
                <div className="mb-24">
                    <div className="mb-10">
                        <span className="text-[#D42428] text-xs font-bold uppercase tracking-widest">Simulator Fleet</span>
                        <h2 className="font-display text-3xl font-bold uppercase tracking-tight mt-1">Anniversary Rates</h2>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {simulatorOffers.map((sim, index) => (
                            <div 
                                key={sim.id} 
                                className="bg-[#111111] border border-white/5 rounded-2xl overflow-hidden flex flex-col group hover:border-white/10 transition-all duration-500"
                            >
                                {/* Visual block - large image of the actual equipment */}
                                <div className="h-48 overflow-hidden relative bg-black">
                                    <img 
                                        src={sim.image} 
                                        alt={sim.title} 
                                        className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700"
                                    />
                                    {/* Glassmorphic Tag */}
                                    <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm border border-white/10 text-white text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded">
                                        {sim.tag}
                                    </div>
                                </div>

                                <div className="p-8 flex flex-col flex-1 justify-between">
                                    <div>
                                        <div className="flex items-center justify-between gap-2 mb-3">
                                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#D42428]">
                                                0{index + 1} / Fleet
                                            </span>
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-[#2D9E49] bg-[#2D9E49]/5 border border-[#2D9E49]/15 px-2 py-0.5 rounded">
                                                {sim.ageReq}
                                            </span>
                                        </div>
                                        <h3 className="font-display text-xl font-bold uppercase tracking-tight text-white mb-3">
                                            {sim.title}
                                        </h3>
                                        <p className="text-white/50 text-xs font-sans leading-relaxed mb-6">
                                            {sim.desc}
                                        </p>
                                    </div>

                                    {/* Pricing Block - Clean Spec Sheet Style */}
                                    <div className="pt-6 border-t border-white/5">
                                        <div className="flex justify-between items-baseline mb-6">
                                            <span className="text-[10px] text-white/40 uppercase tracking-widest font-sans">
                                                Rate
                                            </span>
                                            <div className="text-right">
                                                <span className="text-white/30 line-through text-xs mr-2 font-mono">${sim.normalPrice}</span>
                                                <span className="text-2xl font-bold text-[#2D9E49] font-display">${sim.promoPrice}</span>
                                                <span className="text-[10px] text-white/50">/hr</span>
                                            </div>
                                        </div>
                                        
                                        <Link 
                                            to={`/book?station=${sim.id}`}
                                            className="block w-full py-3.5 bg-white hover:bg-white/90 text-black font-bold uppercase tracking-wider rounded-full text-[10px] text-center transition-all duration-300 transform group-hover:scale-[1.02]"
                                        >
                                            Book {sim.title.split(' ')[0]}
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Exclusive Entire Space Rental - Landscape layout, real photo background */}
                <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#141414] mb-24 grid md:grid-cols-12">
                    
                    {/* Visual Side */}
                    <div className="md:col-span-5 relative h-64 md:h-auto min-h-[250px] overflow-hidden bg-[#0A0A0A]">
                        <img 
                            src="/images/kartcade/hero.webp" 
                            alt="Kartcade Lounge Interior" 
                            className="w-full h-full object-cover opacity-75"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-[#141414] via-transparent to-transparent" />
                    </div>

                    {/* Content Side */}
                    <div className="md:col-span-7 p-8 sm:p-12 flex flex-col justify-between">
                        <div>
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#D42428]">
                                Venue Hire
                            </span>
                            <h2 className="font-display text-2xl sm:text-3xl font-bold uppercase tracking-tight text-white mt-2 mb-4">
                                RENT THE ENTIRE LOUNGE
                            </h2>
                            <p className="text-white/50 text-sm leading-relaxed mb-6 font-sans">
                                Get exclusive private access to all 10 state-of-the-art simulator stations, fully supervised by our staff. Bring your own food, cake, and drinks. Perfect for birthday events, family reunions, and team competitions.
                            </p>
                            
                            {/* Features list */}
                            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-8 text-[11px] font-bold uppercase tracking-widest text-[#2D9E49]">
                                <span>• BIRTHDAYS</span>
                                <span>• CORPORATE EVENTS</span>
                                <span>• REUNIONS</span>
                            </div>
                        </div>

                        {/* Space Rental Spec & Call */}
                        <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                            <div>
                                <div className="text-2xl font-bold text-white font-display">${business.party.basePrice}</div>
                                <div className="text-[9px] font-bold uppercase tracking-widest text-white/40">
                                    For 2 Hours • Up to 40 Guests
                                </div>
                            </div>
                            
                            <a 
                                href="mailto:info@kartcade.com"
                                className="inline-flex items-center justify-center gap-2.5 px-8 py-3.5 bg-[#2D9E49] hover:bg-[#248C3E] text-white font-bold uppercase tracking-widest rounded-full transition-all duration-300 w-full sm:w-auto text-xs"
                            >
                                <Mail className="w-4 h-4" /> Email Us
                            </a>
                        </div>
                    </div>
                </div>

                {/* Anniversary Game Showcase - Loop Video Cards */}
                <div className="mb-24">
                    <div className="mb-10 text-center sm:text-left">
                        <span className="text-[#D42428] text-xs font-bold uppercase tracking-widest">Featured Experiences</span>
                        <h2 className="font-display text-3xl font-bold uppercase tracking-tight mt-1">Simulator Titles</h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-12 gap-x-8">
                        {videoGames.map((game, index) => (
                            <div 
                                key={game.name} 
                                className="group flex flex-col"
                            >
                                {/* Video Container */}
                                <div className="relative w-full aspect-square rounded-2xl overflow-hidden border border-white/5 bg-[#141414] z-0">
                                    <video
                                        src={game.videoUrl}
                                        autoPlay
                                        muted
                                        loop
                                        playsInline
                                        className={`w-full h-full opacity-80 group-hover:opacity-100 transition-all duration-700 ${game.videoClass}`}
                                    />
                                </div>
                                
                                {/* Typography Block Below Video */}
                                <div className="mt-4 flex items-center gap-3">
                                    <span className="font-display text-xs font-bold text-[#D42428]">
                                        0{index + 1}
                                    </span>
                                    <span className="w-4 h-[1px] bg-white/20" />
                                    <h3 className="font-display text-xs sm:text-sm font-bold uppercase tracking-[0.2em] text-white">
                                        {game.name}
                                    </h3>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer and Terms */}
                <footer className="border-t border-white/10 pt-10 text-center text-xs text-white/40 space-y-4">
                    <div className="flex flex-wrap items-center justify-center gap-y-2 gap-x-6 text-[10px] uppercase tracking-widest">
                        <span className="flex items-center gap-1.5 text-white/60">
                            <MapPin className="w-3.5 h-3.5 text-[#D42428]" /> 18750 Willamette Dr, West Linn, OR 97068
                        </span>
                        <span className="flex items-center gap-1.5 text-white/60">
                            <Mail className="w-3.5 h-3.5 text-[#2D9E49]" /> info@kartcade.com
                        </span>
                    </div>
                    <p className="max-w-xl mx-auto text-white/40 leading-relaxed font-sans">
                        All simulator sessions in August 2026 are automatically discounted by 50% on our booking system. Cannot be combined with other discount codes or memberships.
                    </p>
                    <div className="text-[9px] uppercase tracking-widest text-white/20">
                        ALL AGES WELCOME! • © {new Date().getFullYear()} Kartcade. All rights reserved.
                    </div>
                </footer>

            </main>
        </div>
    );
};

export default CampaignLandingPage;
