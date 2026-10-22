// Home page sections below the hero (design proposal A, "Broadcast").
// Every price, age and hour here comes from config/business.json.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import business, { station, stations, hoursByDay, weekRows, formatHour, minPrice, fullAddress } from '../../config/business';
import './broadcast.css';

const P = business.party;
const ageText = (id: Parameters<typeof station>[0]) => {
    const s = station(id);
    return s.minAge ? `Ages ${s.minAge} and up` : 'All ages';
};

const seats = [
    { id: 'karts' as const, img: 'karts', title: 'Racing karts', alt: 'A kid-sized racing kart simulator with a curved screen' },
    { id: 'rigs' as const, img: 'rigs', title: 'Full-size rigs', alt: 'A full-size direct-drive racing rig with triple screens' },
    { id: 'motion' as const, img: 'motion', title: 'Motion simulator', alt: 'The motion simulator with three wraparound screens' },
    { id: 'flight' as const, img: 'flight', title: 'Flight simulator', alt: 'The flight simulator seat with an ultrawide screen' },
];

const priceRows = [
    { id: 'karts' as const, title: 'Racing karts', sub: 'Lower speed, beginner-friendly games, staff close by.' },
    { id: 'rigs' as const, title: 'Full-size rigs', sub: 'Direct-drive wheels, load-cell pedals, full game library.' },
    { id: 'motion' as const, title: 'Motion simulator', sub: 'Triple screens on a platform that moves with the car.' },
    { id: 'flight' as const, title: 'Flight simulator', sub: 'Stick and throttle, space and atmospheric flight.' },
];

interface Lap { id: string; driverName: string; lapTime: string; lapTimeMs: number; track?: string; car?: string; game?: string }

function useTopLaps(n = 5) {
    const [laps, setLaps] = useState<Lap[] | null>(null);
    useEffect(() => {
        let live = true;
        getDocs(query(collection(db, 'lap_times'), where('status', '==', 'approved')))
            .then((snap) => {
                const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Lap, 'id'>) }));
                all.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
                if (live) setLaps(all.slice(0, n));
            })
            .catch(() => live && setLaps([]));
        return () => { live = false; };
    }, [n]);
    return laps;
}

function useStatusNow() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(t);
    }, []);
    // Kartcade's clock, not the viewer's: open/closed is judged in Pacific time.
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
        .formatToParts(now).map((x) => [x.type, x.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const h = Number(parts.hour) + Number(parts.minute) / 60;
    const today = hoursByDay[day];
    let status = 'Closed today';
    let open = false;
    if (today) {
        if (h >= today[0] && h < today[1]) { status = 'Open now'; open = true; }
        else if (h < today[0]) status = `Opens at ${formatHour(today[0])}`;
        else status = 'Closed for today';
    }
    // Next open day, for the "closed" case.
    let next = '';
    if (!open && !(today && h < today[0])) {
        for (let i = 1; i <= 7; i++) {
            const d = (day + i) % 7;
            const hh = hoursByDay[d];
            if (hh) { next = `${i === 1 ? 'Tomorrow' : weekRows.find((r) => r.day === d)!.name} at ${formatHour(hh[0])}`; break; }
        }
    }
    return { day, today, status, open, next };
}

const Broadcast: React.FC = () => {
    const laps = useTopLaps(5);
    const now = useStatusNow();
    const totalSims = stations.reduce((n, s) => n + s.units, 0);
    const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&output=embed`;

    const tickerItems = [
        <><b className="r">Hot Lap Challenge</b> Live leaderboard at kartcade.com/leaderboard</>,
        <>Gift cards: any amount, sent by email</>,
        <>Private parties from <b>${P.basePrice}</b> for the whole space, up to {P.maxGuests} guests</>,
        <>{totalSims} simulators, your whole group races at once</>,
        <>Walk-ins welcome when rigs are free</>,
    ];

    return (
        <div className="bc">
            <div className="ticker" aria-hidden="true">
                <div className="track">
                    {[...tickerItems, ...tickerItems].map((t, i) => <span key={i}>{t}</span>)}
                </div>
            </div>

            <section id="seats">
                <div className="wrap">
                    <div className="sec-head">
                        <h2>Pick your seat</h2>
                        <p>Everyone in your group gets their own simulator and you all race together. Staff set you up, pick a game with you and stay close. Dozens of titles, from Assetto Corsa and Le Mans Ultimate to Wreckfest and Star Wars Squadrons.</p>
                    </div>
                    <div className="feeds">
                        {seats.map((s) => (
                            <Link key={s.id} className="feed" to="/book">
                                <img src={`/images/kartcade/home/${s.img}.webp`} alt={s.alt} loading="lazy" />
                                <span className="tag">{ageText(s.id)}</span>
                                <div className="cap">
                                    <h3>{s.title}</h3>
                                    <div className="meta"><span>{station(s.id).blurb}</span><span className="price">${station(s.id).price} an hour</span></div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            <section className="hotlap" id="hotlap">
                <div className="wrap hot-grid">
                    <div className="hot-copy">
                        <h2>Hot Lap Challenge</h2>
                        <p>Set a lap on a rig and it goes on the Kartcade leaderboard. Come back, find the tenths, and take the top spot from whoever holds it.</p>
                        <div className="ctas">
                            <Link className="btn btn-red" to="/book">Book a rig and set a time</Link>
                            <Link className="btn btn-ghost" to="/leaderboard">See the leaderboard</Link>
                        </div>
                    </div>
                    <div className="board" aria-label="Fastest laps">
                        <div className="head"><span><b>Fastest laps</b></span><span className="mono">Leaderboard</span></div>
                        <table>
                            <tbody>
                                {laps === null && <tr><td className="pos">…</td><td className="who">Loading times</td><td className="t">--:--.---</td></tr>}
                                {laps && laps.map((l, i) => (
                                    <tr key={l.id}>
                                        <td className="pos">{i + 1}</td>
                                        <td className="who">{l.driverName || 'Driver'}{(l.track || l.car) && <small>{[l.car, l.track].filter(Boolean).join(', ')}</small>}</td>
                                        <td className="t">{l.lapTime}</td>
                                    </tr>
                                ))}
                                {laps && laps.length < 5 && (
                                    <tr className="you"><td className="pos">{laps.length + 1}</td><td className="who">You, next visit</td><td className="t">--:--.---</td></tr>
                                )}
                            </tbody>
                        </table>
                        <div className="foot">Approved times from the rigs. Full board, filters and past winners on the leaderboard page.</div>
                    </div>
                </div>
            </section>

            <section id="pricing">
                <div className="wrap">
                    <div className="sec-head">
                        <h2>Pricing, per person, per hour</h2>
                        <p>You pay for a seat, not for the room. Four friends is four seats racing at the same time. Pay in full online or a 50 percent deposit, the rest when you arrive.</p>
                    </div>
                    <div className="prices">
                        {priceRows.map((r) => (
                            <div className="prow" key={r.id}>
                                <h3>{r.title}</h3>
                                <div className="sub">{ageText(r.id)}. {r.sub}</div>
                                <div className="amt">${station(r.id).price}<small>per hour</small></div>
                            </div>
                        ))}
                        <div className="prow">
                            <h3>Private party</h3>
                            <div className="sub">{P.minHours} hours, the whole space, up to {P.maxGuests} guests, unlimited racing. ${P.extraHourPrice} for each extra hour.</div>
                            <div className="amt">${P.basePrice}<small>{P.minHours} hours</small></div>
                        </div>
                    </div>
                    <p className="pnote">Gift cards cover any of the above. <a href={business.giftCardsUrl} rel="noopener" target="_blank">Buy a gift card</a> for any amount and it arrives by email.</p>
                </div>
            </section>

            <section id="parties" style={{ paddingTop: 0 }}>
                <div className="wrap split">
                    <div className="card">
                        <img src="/images/kartcade/home/lounge-evening.webp" alt="The lounge at night with the rigs lit up" loading="lazy" />
                        <h3>Birthday parties</h3>
                        <p>{P.minHours} hours with the whole space to yourselves. Up to {P.maxGuests} guests, every simulator yours, staff running the games.</p>
                        <ul>
                            <li>${P.basePrice} for {P.minHours} hours, ${P.extraHourPrice} each extra hour</li>
                            <li>Karts from age {station('karts').minAge}</li>
                            <li>Bring your own food, cake and decorations</li>
                        </ul>
                        <Link className="btn btn-red" to="/book-party">Plan a party</Link>
                    </div>
                    <div className="card">
                        <img src="/images/kartcade/home/lounge-rigs.webp" alt="Rows of racing rigs ready for a group" loading="lazy" />
                        <h3>Corporate and team events</h3>
                        <p>Two to four hour blocks for teams of up to {P.maxGuests}. We can run a tournament and keep the leaderboard on the big screen.</p>
                        <ul>
                            <li>Custom pricing by headcount and hours</li>
                            <li>Tournament setup included</li>
                            <li>Weekday afternoons available</li>
                        </ul>
                        <Link className="btn btn-ghost" to="/events">Ask about a team event</Link>
                    </div>
                </div>
            </section>

            <section id="visit" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="wrap">
                    <div className="sec-head"><h2>Find us</h2></div>
                    <div className="visit">
                        <div>
                            <aside className="tower" aria-label="Today at Kartcade">
                                <div className="row"><span className="k">Status</span><span className={`v${now.open ? ' live' : ''}`}>{now.status}</span></div>
                                <div className="row"><span className="k">Today</span><span className="v">{now.today ? `${formatHour(now.today[0])} to ${formatHour(now.today[1])}` : 'Closed'}</span></div>
                                {!now.open && now.next && <div className="row"><span className="k">Next open</span><span className="v">{now.next}</span></div>}
                                <div className="row"><span className="k">From</span><span className="v">${minPrice} per person, per hour</span></div>
                                <div className="row"><span className="k">Booking</span><span className="v">{business.booking.minAdvanceHours} hours notice, up to {Math.round(business.booking.maxAdvanceDays / 7)} weeks out</span></div>
                            </aside>
                            <p className="addr">
                                {business.address.street}<br />{business.address.city}, {business.address.region} {business.address.postalCode}<br />
                                <a href={business.mapsUrl} rel="noopener" target="_blank">Directions on Google Maps</a><br />
                                <a href={`tel:${business.phoneE164}`}>{business.phone}</a>&nbsp;&nbsp;<a href={`mailto:${business.email}`}>{business.email}</a>
                            </p>
                            <iframe className="map" title="Map to Kartcade" src={mapSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                        </div>
                        <div className="hours">
                            {weekRows.map((r) => (
                                <div key={r.day} className={r.day === now.day ? 'today' : ''}>
                                    <span>{r.name}</span><span className={r.closed ? 'closed' : ''}>{r.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section id="faq" style={{ paddingTop: 0 }}>
                <div className="wrap">
                    <div className="sec-head"><h2>Good to know</h2></div>
                    <div className="faq">
                        <details><summary>Do I need to book, or can I walk in?</summary><div className="a">Both. Walk-ins get a seat when one is free, but weekends and evenings fill up, so book ahead. Online bookings need {business.booking.minAdvanceHours} hours notice and can be made up to {Math.round(business.booking.maxAdvanceDays / 7)} weeks out.</div></details>
                        <details><summary>How old do you have to be?</summary><div className="a">Karts from age {station('karts').minAge}, full-size rigs from {station('rigs').minAge}, the motion simulator from {station('motion').minAge}, the flight sim at any age. Minors need a parent or guardian with them.</div></details>
                        <details><summary>I have never driven a sim. Is that a problem?</summary><div className="a">No. Most guests are first-timers. Staff pick a game that suits you and turn on driving assists until you want them off.</div></details>
                        <details><summary>What should I wear?</summary><div className="a">Comfortable clothes and clean, flat, closed-toe shoes. No flip-flops or heels, they slip off the pedals.</div></details>
                        <details><summary>Can we bring food?</summary><div className="a">Yes. Snacks, cake and outside food are welcome, just keep them away from the machines. We also sell light snacks and drinks.</div></details>
                        <details><summary>How does paying work?</summary><div className="a">Pay in full online, or a 50 percent deposit with the rest at the counter. Gift cards work for any booking.</div></details>
                    </div>
                    <p style={{ marginTop: 20 }}><Link to="/faq" style={{ color: '#fff' }}>All questions and answers</Link></p>
                </div>
            </section>
        </div>
    );
};

export default Broadcast;
