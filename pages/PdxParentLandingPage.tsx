import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Gift, MapPin, Phone, Users, Clock } from 'lucide-react';
import business, { stations, minPrice, weekRows, fullAddress } from '../config/business';

// ---------------------------------------------------------------------------
// PDX Parent holiday landing page — kartcade.com/pdxparent
// Link from the e-blast:  /pdxparent?utm_source=pdxparent&utm_medium=email&utm_campaign=holiday26
// Print QR code:          /pdxparent?utm_source=pdxparent&utm_medium=print&utm_campaign=holiday26
// Every visit is logged (api/log-scan, channel "pdxparent") and remembered for 60 days,
// so a later sign-up or booking is tagged with the source (see utils/attribution.ts).
//
// OFFER: edit this block to change the promotion. Set `enabled: false` to show no offer banner.
// ---------------------------------------------------------------------------
const OFFER = {
    enabled: false,
    eyebrow: 'PDX Parent readers',
    headline: 'Offer headline goes here',
    detail: 'One sentence on what they get and how to claim it.',
    finePrint: 'Valid through January 4, 2027. Mention PDX Parent when you book or arrive.',
};

const PdxParentLandingPage: React.FC = () => {
    const { search } = useLocation();

    useEffect(() => {
        document.title = 'Winter Break Racing in West Linn | Kartcade';

        let metaRobots = document.querySelector('meta[name="robots"]');
        if (!metaRobots) {
            metaRobots = document.createElement('meta');
            metaRobots.setAttribute('name', 'robots');
            document.head.appendChild(metaRobots);
        }
        metaRobots.setAttribute('content', 'noindex, nofollow');

        // Count the visit server-side (bots are filtered there)
        const params = new URLSearchParams(search);
        const query = new URLSearchParams({ channel: 'pdxparent' });
        ['utm_medium', 'utm_campaign'].forEach((k) => {
            const v = params.get(k);
            if (v) query.set(k, v);
        });
        fetch(`/api/log-scan?${query.toString()}`, { method: 'POST' }).catch(() => {});

        return () => {
            metaRobots?.removeAttribute('content');
        };
    }, [search]);

    const openDays = weekRows.filter((r) => !r.closed);

    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#2D9E49] selection:text-white pb-20">
            <header className="w-full py-6 border-b border-white/5">
                <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
                    <Link to="/" className="hover:opacity-85 transition-opacity">
                        <img src="/logo.png" alt="Kartcade" className="h-7 w-auto" />
                    </Link>
                    <a
                        href={`tel:${business.phoneE164}`}
                        className="text-xs font-bold uppercase tracking-widest text-white/60 hover:text-[#2D9E49] transition-colors flex items-center gap-2"
                    >
                        <Phone className="w-3.5 h-3.5" /> {business.phone}
                    </a>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6">
                {/* Hero */}
                <section className="grid md:grid-cols-2 gap-10 items-center pt-10 sm:pt-16 mb-14">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D42428] mb-4">
                            As seen in PDX Parent
                        </div>
                        <h1 className="font-display text-4xl sm:text-6xl font-bold uppercase tracking-tight leading-[1.05] mb-6">
                            Race your whole crew this winter break
                        </h1>
                        <p className="text-lg text-white/60 leading-relaxed mb-8 max-w-xl">
                            Racing sims, kid-size karts, a motion rig and a flight sim, all in one lounge in West Linn.
                            Drop in by the hour or rent the whole place for a holiday party.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Link
                                to="/book"
                                className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-[#D42428] hover:bg-[#B91C1C] text-white font-bold uppercase tracking-widest rounded-full text-xs transition-colors"
                            >
                                Book a session <ArrowRight className="w-4 h-4" />
                            </Link>
                            <Link
                                to="/book-party"
                                className="inline-flex items-center justify-center gap-2 px-7 py-4 border border-white/20 hover:border-white/50 text-white font-bold uppercase tracking-widest rounded-full text-xs transition-colors"
                            >
                                Plan a party
                            </Link>
                        </div>
                    </div>
                    <div className="rounded-2xl overflow-hidden border border-white/10 aspect-[4/3] bg-[#141414]">
                        <img
                            src="/images/kartcade/home/lounge-rigs.webp"
                            alt="Kartcade racing lounge"
                            className="w-full h-full object-cover"
                        />
                    </div>
                </section>

                {/* Offer */}
                {OFFER.enabled && (
                    <section className="rounded-2xl bg-white text-black p-8 sm:p-10 mb-14 flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#D42428] mb-2">
                                {OFFER.eyebrow}
                            </div>
                            <h2 className="font-display text-3xl sm:text-4xl font-black uppercase tracking-tight leading-none mb-3">
                                {OFFER.headline}
                            </h2>
                            <p className="text-black/70">{OFFER.detail}</p>
                            <p className="text-black/50 text-xs mt-2">{OFFER.finePrint}</p>
                        </div>
                        <Link
                            to="/book"
                            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#D42428] hover:bg-[#B91C1C] text-white font-bold uppercase tracking-widest rounded-full text-xs whitespace-nowrap"
                        >
                            Claim it <ArrowRight className="w-4 h-4" />
                        </Link>
                    </section>
                )}

                {/* Three ways to visit */}
                <section className="grid md:grid-cols-3 gap-6 mb-14">
                    <div className="bg-[#111] border border-white/5 rounded-2xl p-8 flex flex-col">
                        <Clock className="w-6 h-6 text-[#2D9E49] mb-4" />
                        <h3 className="font-display text-xl font-bold uppercase mb-2">By the hour</h3>
                        <p className="text-white/50 text-sm leading-relaxed mb-4">
                            From ${minPrice} per driver per hour. Half-hour sessions too.
                        </p>
                        <ul className="text-sm text-white/70 space-y-1 mb-6">
                            {stations.map((s) => (
                                <li key={s.id} className="flex justify-between">
                                    <span>{s.name}</span>
                                    <span className="text-white/40">${s.price}/hr · {s.ageLabel === 'All ages' ? 'all ages' : `ages ${s.ageLabel}`}</span>
                                </li>
                            ))}
                        </ul>
                        <Link to="/book" className="mt-auto text-xs font-bold uppercase tracking-widest text-[#2D9E49] hover:text-white">
                            Book a time →
                        </Link>
                    </div>

                    <div className="bg-[#111] border border-white/5 rounded-2xl p-8 flex flex-col">
                        <Users className="w-6 h-6 text-[#2D9E49] mb-4" />
                        <h3 className="font-display text-xl font-bold uppercase mb-2">Holiday parties</h3>
                        <p className="text-white/50 text-sm leading-relaxed mb-6">
                            The whole lounge and every machine, staffed for you. ${business.party.basePrice} for{' '}
                            {business.party.minHours} hours, ${business.party.extraHourPrice} each extra hour, up to{' '}
                            {business.party.maxGuests} guests. Bring your own food and cake.
                        </p>
                        <Link to="/book-party" className="mt-auto text-xs font-bold uppercase tracking-widest text-[#2D9E49] hover:text-white">
                            Pick a date →
                        </Link>
                    </div>

                    <div className="bg-[#111] border border-white/5 rounded-2xl p-8 flex flex-col">
                        <Gift className="w-6 h-6 text-[#2D9E49] mb-4" />
                        <h3 className="font-display text-xl font-bold uppercase mb-2">Gift cards</h3>
                        <p className="text-white/50 text-sm leading-relaxed mb-6">
                            Racing time for the driver who has everything. Delivered by email, good on any session.
                        </p>
                        <a
                            href={business.giftCardsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-auto text-xs font-bold uppercase tracking-widest text-[#2D9E49] hover:text-white"
                        >
                            Buy a gift card →
                        </a>
                    </div>
                </section>

                {/* Visit info */}
                <footer className="border-t border-white/10 pt-10 grid sm:grid-cols-2 gap-8 text-sm text-white/60">
                    <div className="space-y-2">
                        <a href={business.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-white">
                            <MapPin className="w-4 h-4 text-[#D42428]" /> {fullAddress}
                        </a>
                        <a href={`tel:${business.phoneE164}`} className="flex items-center gap-2 hover:text-white">
                            <Phone className="w-4 h-4 text-[#2D9E49]" /> {business.phone}
                        </a>
                    </div>
                    <ul className="space-y-1">
                        {openDays.map((r) => (
                            <li key={r.day} className="flex justify-between max-w-xs">
                                <span>{r.name}</span>
                                <span className="text-white/40">{r.label}</span>
                            </li>
                        ))}
                    </ul>
                </footer>
            </main>
        </div>
    );
};

export default PdxParentLandingPage;
