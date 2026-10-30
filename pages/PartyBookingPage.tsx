import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, Clock, Users, ArrowRight, ArrowLeft,
    CheckCircle, AlertTriangle, Shield, CreditCard,
    Loader2, Zap, Phone, Mail, User
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bookingConfig, bookingApi } from '../config/booking';
import { db } from '../config/firebase';
import { collection, addDoc, serverTimestamp, doc, setDoc, arrayUnion } from 'firebase/firestore';
import { formatCurrency } from '../utils/paymentStatus';
import CalendarPicker from '../components/CalendarPicker';
import PayPalCheckout from '../components/PayPalCheckout';
import gsap from 'gsap';
import business from '../config/business';
import { withAttribution } from '../utils/attribution';

const PartyBookingPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser, userProfile, isAdmin } = useAuth();
    const containerRef = useRef<HTMLDivElement>(null);

    // 1. STATE
    const [step, setStep] = useState(1);
    const [duration, setDuration] = useState(2); // 2 hours minimum, $200 per extra hour
    const [paymentAmountType, setPaymentAmountType] = useState<'deposit' | 'full'>('deposit');
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedTime, setSelectedTime] = useState<string | null>(null);
    const [availability, setAvailability] = useState<Record<string, boolean>>({});
    const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
    const [formData, setFormData] = useState({
        name: userProfile?.name || '',
        email: currentUser?.email || '',
        phone: userProfile?.phone || '',
        notes: '',
        guestCount: 15
    });
    const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'paypal' | 'venue'>('stripe');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 2. CONSTANTS
    const PARTY_HOURS = [2, 3, 4, 5];
    const PARTY_PRICES: Record<number, number> = Object.fromEntries(
        PARTY_HOURS.map(h => [h, bookingConfig.partyBasePrice + (h - bookingConfig.partyMinHours) * bookingConfig.partyExtraHourPrice])
    );
    const TOTAL_MACHINES = Object.fromEntries(business.stations.map((s) => [s.id, s.units])) as Record<string, number>;

    // 3. EFFECTS
    useEffect(() => {
        if (selectedDate) {
            checkFacilityAvailability(selectedDate);
        }
    }, [selectedDate, duration]);

    // 4. LOGIC: Availability Check
    const checkFacilityAvailability = async (date: Date) => {
        setIsLoadingAvailability(true);
        setSelectedTime(null);
        try {
            const dateStr = date.toISOString().split('T')[0];
            console.log(`[PARTY] Checking availability for ${dateStr} with duration ${duration}h`);

            // We need to check availability for ALL 4 station types
            const [kartsRes, rigsRes, motionRes, flightRes] = await Promise.all([
                bookingApi.getAvailability(dateStr, 'karts', duration),
                bookingApi.getAvailability(dateStr, 'rigs', duration),
                bookingApi.getAvailability(dateStr, 'motion', duration),
                bookingApi.getAvailability(dateStr, 'flight', duration)
            ]);

            // ✅ Extract slots (matches BookingPage.tsx logic)
            const karts = kartsRes?.availability || kartsRes;
            const rigs = rigsRes?.availability || rigsRes;
            const motion = motionRes?.availability || motionRes;
            const flight = flightRes?.availability || flightRes;

            // ==========================================
            // DEFENSIVE CHECKS: Ensure all responses are valid objects
            // ==========================================
            if (!karts || typeof karts !== 'object') {
                console.error('[PARTY] Karts data missing or malformed:', kartsRes);
                throw new Error('Incomplete availability data: Karts missing');
            }
            if (!rigs || typeof rigs !== 'object') {
                console.error('[PARTY] Rigs data missing or malformed:', rigsRes);
                throw new Error('Incomplete availability data: Rigs missing');
            }
            if (!motion || typeof motion !== 'object') {
                console.error('[PARTY] Motion data missing or malformed:', motionRes);
                throw new Error('Incomplete availability data: Motion missing');
            }
            if (!flight || typeof flight !== 'object') {
                console.error('[PARTY] Flight data missing or malformed:', flightRes);
                throw new Error('Incomplete availability data: Flight missing');
            }

            const partySlots: Record<string, boolean> = {};

            // Iterate through slots (base on karts as the primary anchor)
            Object.keys(karts).forEach(time => {
                const kFree = karts[time]?.available === 4;
                const rFree = rigs[time]?.available === 4;
                const mFree = motion[time]?.available === 1;
                const fFree = flight[time]?.available === 1;

                // Time blocking logic (consistent with Oregon time/past slots)
                const now = new Date();
                const oregonNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
                const isToday = date.getDate() === oregonNow.getDate() &&
                    date.getMonth() === oregonNow.getMonth() &&
                    date.getFullYear() === oregonNow.getFullYear();
                const slotHour = parseInt(time.split(':')[0]);
                const isPast = isToday && slotHour <= oregonNow.getHours();

                // All units must be free for a "Whole Venue" booking
                partySlots[time] = kFree && rFree && mFree && fFree && !isPast;
            });

            console.log(`[PARTY] Successfully processed slots. Map:`, partySlots);
            setAvailability(partySlots);
        } catch (err: any) {
            console.error('[PARTY] Availability calculation failed:', err);

            // Provide a graceful error message based on the failure type
            if (err.message && err.message.includes('Incomplete availability data')) {
                setError('The venue booking system is temporarily unavailable for this date. Please try another day or contact us.');
            } else {
                setError('Failed to load availability. Please try again.');
            }

            // Set empty availability so UI shows "No slots available" instead of stale data
            setAvailability({});
        } finally {
            setIsLoadingAvailability(false);
        }
    };

    // 5. LOGIC: Booking Flow
    const handlePayPalSuccess = async (details: any) => {
        if (!selectedDate || !selectedTime) return;
        setIsSubmitting(true);
        setError(null);

        try {
            const totalPrice = PARTY_PRICES[duration];
            const dateStr = selectedDate.toISOString().split('T')[0];
            const stationPayload = `Karts:4, Rigs:4, Motion:1, Flight:1 (${duration}h)`; // every unit, so nothing stays bookable

            // 1. Create booking in Google Sheets via API
            const amountToCharge = paymentAmountType === 'full' ? totalPrice : totalPrice * 0.5;

            // LOGIC: If Deposit chosen -> 'deposit'. If Full chosen -> 'paypal'.
            const paymentMethodString = paymentAmountType === 'full' ? 'paypal' : 'deposit';

            const result = await bookingApi.createBooking({
                date: dateStr,
                time: selectedTime,
                station: stationPayload,
                drivers: 15,
                name: formData.name,
                email: formData.email,
                phone: formData.phone,
                paymentMethod: paymentMethodString,
                notes: `[PARTY][PAYPAL:${details.id}] ${formData.notes}`
            });

            if (result.success) {
                // 2. Create the Party document in Firestore
                const partyRef = doc(collection(db, 'parties'));
                const partyId = partyRef.id;

                await setDoc(partyRef, {
                    partyId,
                    hostUserId: currentUser?.uid || '',
                    hostName: formData.name,
                    hostEmail: formData.email,
                    bookingDate: dateStr,
                    bookingTime: selectedTime,
                    duration: duration,
                    totalPrice: totalPrice,
                    depositPaid: amountToCharge,
                    remainingBalance: totalPrice - amountToCharge,
                    maxGuests: bookingConfig.partyMaxGuests,
                    registeredGuests: [],
                    status: 'confirmed',
                    source: 'paypal',
                    bookingId: result.bookingId,
                    paypalOrderId: details.id,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                // Link to user profile
                if (currentUser) {
                    const userRef = doc(db, 'users', currentUser.uid);
                    await setDoc(userRef, {
                        partyInfo: {
                            hostingParties: arrayUnion(partyId)
                        }
                    }, { merge: true });
                }

                // 3. Log the transaction
                await addDoc(collection(db, 'transactions_log'), {
                    userId: currentUser?.uid || '',
                    email: formData.email,
                    type: 'party_booking',
                    station: stationPayload,
                    amount: amountToCharge,
                    paymentMethod: paymentMethodString,
                    bookingId: result.bookingId,
                    partyId: partyId,
                    isPartyBooking: true,
                    createdAt: serverTimestamp()
                });

                navigate('/dashboard', { state: { message: 'Party booking confirmed via PayPal!' } });
            } else {
                throw new Error(result.error || 'Failed to sync booking');
            }
        } catch (err: any) {
            console.error('[PARTY] PayPal process failed:', err);
            setError(err.message || 'Bookings synced but database update failed. Please contact support.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCheckout = async () => {
        if (!selectedDate || !selectedTime) return;
        setIsSubmitting(true);
        setError(null);

        try {
            const totalPrice = PARTY_PRICES[duration];
            const depositAmount = totalPrice * 0.5;
            const dateStr = selectedDate.toISOString().split('T')[0];
            const stationPayload = `Karts:4, Rigs:4, Motion:1, Flight:1 (${duration}h)`; // every unit, so nothing stays bookable

            // BRANCH: If Pay at Venue (Admin Only)
            if (paymentMethod === 'venue') {
                const result = await bookingApi.createBooking({
                    date: dateStr,
                    time: selectedTime,
                    station: stationPayload,
                    drivers: 15,
                    name: formData.name,
                    email: formData.email,
                    phone: formData.phone,
                    paymentMethod: 'venue',
                    notes: `[PARTY] ${formData.notes}`
                });

                if (result.success) {
                    // Manually create the Party document in Firestore
                    const partyRef = doc(collection(db, 'parties'));
                    const partyId = partyRef.id;

                    await setDoc(partyRef, {
                        partyId,
                        hostUserId: currentUser?.uid || '',
                        hostName: formData.name || 'Admin Booking',
                        hostEmail: formData.email,
                        bookingDate: dateStr,
                        bookingTime: selectedTime,
                        duration: duration,
                        totalPrice: totalPrice,
                        depositPaid: 0,
                        remainingBalance: totalPrice,
                        maxGuests: bookingConfig.partyMaxGuests,
                        registeredGuests: [],
                        status: 'confirmed',
                        source: 'admin_manual',
                        bookingId: result.bookingId,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });

                    // Link to user profile if logged in
                    if (currentUser) {
                        const userRef = doc(db, 'users', currentUser.uid);
                        await setDoc(userRef, {
                            partyInfo: {
                                hostingParties: arrayUnion(partyId)
                            }
                        }, { merge: true });
                    }

                    // Log the transaction
                    await addDoc(collection(db, 'transactions_log'), {
                        userId: currentUser?.uid || '',
                        email: formData.email,
                        type: 'party_booking',
                        station: stationPayload,
                        date: dateStr,
                        time: selectedTime,
                        drivers: 15,
                        name: formData.name,
                        amount: 0,
                        bookingId: result.bookingId,
                        partyId: partyId,
                        isPartyBooking: true,
                        paymentMethod: 'venue',
                        createdAt: serverTimestamp()
                    });

                    // Success! Redirect to dashboard or show success state
                    navigate('/dashboard', { state: { message: 'Party booking created successfully!' } });
                } else {
                    setError(result.error || 'Failed to create booking');
                    setIsSubmitting(false);
                }
                return;
            }

            // Normal Flow: Stripe Checkout
            const amountToCharge = paymentAmountType === 'full' ? totalPrice : depositAmount;

            // LOGIC: If Deposit chosen -> 'deposit'. If Full chosen -> 'stripe'.
            const paymentMethodString = paymentAmountType === 'full' ? 'stripe' : 'deposit';

            const response = await fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser?.uid,
                    userEmail: currentUser?.email,
                    amount: amountToCharge * 100, // Stripe expects cents
                    mode: 'payment',
                    productName: paymentAmountType === 'full' ? `Full Payment: Whole Venue Party (${duration}hr)` : `50% Deposit: Whole Venue Party (${duration}hr)`,
                    bookingDetails: {
                        station: stationPayload,
                        date: dateStr,
                        time: selectedTime,
                        drivers: 15,
                        duration: duration.toString(),
                        name: formData.name,
                        email: formData.email,
                        phone: formData.phone,
                        notes: withAttribution(`[PARTY] ${formData.notes}`),
                        isParty: 'true',
                        totalPrice: totalPrice,
                        paymentMethod: paymentMethodString,
                        stationEquipment: TOTAL_MACHINES
                    }
                })
            });

            const data = await response.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                setError(data.error || 'Checkout failed');
                setIsSubmitting(false);
            }
        } catch (err: any) {
            console.error('[PARTY] Registration process failed:', err);
            setError(err.message || 'Connection error');
            setIsSubmitting(false);
        }
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };

    return (
        <div ref={containerRef} className="bg-[#0A0A0A] text-white min-h-screen">
            <section className="relative pt-32 pb-12 px-6 md:px-12 overflow-hidden border-b border-white/5">
                <div className="absolute inset-0 bg-gradient-to-b from-[#D42428]/10 to-transparent"></div>
                <div className="max-w-4xl mx-auto relative z-10 text-center">
                    <span className="inline-flex items-center gap-2 text-[#2D9E49] text-xs font-bold uppercase tracking-widest mb-4 bg-[#2D9E49]/10 px-4 py-1.5 rounded-full border border-[#2D9E49]/20">
                        <Zap className="w-3 h-3" /> Exclusive Group Booking
                    </span>
                    <h1 className="font-display text-4xl md:text-7xl font-bold uppercase leading-none mb-4 tracking-tighter">
                        Whole Venue <span className="text-[#D42428]">Party</span>
                    </h1>
                    <p className="text-white/60 max-w-2xl mx-auto mb-10 text-sm md:text-base leading-relaxed">
                        Rent the entire facility: ${business.party.basePrice} for {business.party.minHours} hours, ${business.party.extraHourPrice} for each extra hour. All {Object.values(TOTAL_MACHINES).reduce((a, b) => a + b, 0)} simulators, private space, and unlimited racing for up to {business.party.maxGuests} guests.
                    </p>

                    <div className="flex items-center justify-center gap-4 sm:gap-8">
                        {[1, 2, 3, 4].map((s) => (
                            <div key={s} className="flex items-center gap-2">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all ${step >= s ? 'bg-[#2D9E49] text-white shadow-[0_0_20px_rgba(45,158,73,0.3)]' : 'bg-white/5 text-white/30 border border-white/10'
                                    }`}>
                                    {step > s ? <CheckCircle className="w-4 h-4" /> : s}
                                </div>
                                <span className={`hidden md:inline text-[10px] font-bold uppercase tracking-[0.2em] ${step === s ? 'text-white' : 'text-white/30'
                                    }`}>
                                    {s === 1 ? 'Duration' : s === 2 ? 'Schedule' : s === 3 ? 'Info' : 'Pay'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <main className="max-w-4xl mx-auto py-16 px-6">
                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-2xl text-red-500 flex items-center gap-4 mb-10 animate-shake">
                        <AlertTriangle className="w-6 h-6 flex-shrink-0" />
                        <p className="text-xs font-bold uppercase tracking-widest leading-relaxed">{error}</p>
                    </div>
                )}

                {step === 1 && (
                    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-500">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                            {PARTY_HOURS.map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setDuration(d)}
                                    className={`relative p-10 rounded-3xl border-2 transition-all text-left group overflow-hidden ${duration === d
                                        ? 'border-[#2D9E49] bg-[#2D9E49]/5 shadow-2xl shadow-[#2D9E49]/5'
                                        : 'border-white/5 bg-white/[0.02] hover:border-white/20'
                                        }`}
                                >
                                    <div className="text-4xl font-bold text-white mb-2">{d} <span className="text-sm font-normal text-white/40 tracking-widest align-middle ml-1">HRS</span></div>
                                    <div className="text-[#2D9E49] font-display text-2xl font-bold">{formatCurrency(PARTY_PRICES[d])}</div>
                                    <p className="mt-6 text-[10px] text-white/40 uppercase tracking-widest font-bold border-t border-white/5 pt-4">Entire Facility Area</p>
                                    {duration === d && <div className="absolute top-0 right-0 p-4"><CheckCircle className="w-6 h-6 text-[#2D9E49]" /></div>}
                                </button>
                            ))}
                        </div>
                        <button onClick={() => setStep(2)} className="w-full bg-[#D42428] hover:bg-[#B71F23] text-white font-bold py-6 rounded-2xl flex items-center justify-center gap-3 group transition-all shadow-2xl shadow-[#D42428]/20 text-sm uppercase tracking-[0.2em]">
                            Check Availability <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-500">
                        <button onClick={() => setStep(1)} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-[0.2em]">
                            <ArrowLeft className="w-4 h-4" /> Change Duration
                        </button>

                        <div className="grid lg:grid-cols-12 gap-16">
                            <div className="lg:col-span-7">
                                <label className="block text-[11px] uppercase tracking-[0.3em] font-bold text-[#2D9E49] mb-8">Select Date</label>
                                <div className="bg-white/[0.02] p-6 rounded-3xl border border-white/5">
                                    <CalendarPicker
                                        selectedDate={selectedDate}
                                        onDateChange={setSelectedDate}
                                        minDate={(() => {
                                             const d = new Date();
                                             if (!isAdmin) {
                                                 d.setDate(d.getDate() + 1);
                                             }
                                             d.setHours(0, 0, 0, 0);
                                             return d;
                                        })()}
                                        maxDate={(() => {
                                            const d = new Date();
                                            d.setDate(d.getDate() + 90);
                                            return d;
                                        })()}
                                    />
                                </div>
                            </div>

                            <div className="lg:col-span-5">
                                <label className="block text-[11px] uppercase tracking-[0.3em] font-bold text-[#2D9E49] mb-8">
                                    {selectedDate ? `Slots Available — ${formatDate(selectedDate)}` : 'Select Date to See Slots'}
                                </label>

                                {selectedDate ? (
                                    isLoadingAvailability ? (
                                        <div className="flex flex-col items-center justify-center py-24 bg-white/[0.02] rounded-3xl border border-white/5">
                                            <Loader2 className="w-10 h-10 animate-spin text-[#2D9E49] mb-6" />
                                            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/20">Syncing Simulators...</span>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-4">
                                            {Object.keys(availability).length > 0 ? (
                                                Object.keys(availability).sort().map(time => {
                                                    const isAvailable = availability[time];
                                                    const isSelected = selectedTime === time;
                                                    return (
                                                        <button
                                                            key={time}
                                                            disabled={!isAvailable}
                                                            onClick={() => setSelectedTime(time)}
                                                            className={`p-5 rounded-2xl text-center transition-all border ${isSelected
                                                                ? 'bg-[#2D9E49] border-[#2D9E49] text-white shadow-2xl shadow-[#2D9E49]/20'
                                                                : !isAvailable
                                                                    ? 'bg-transparent border-white/5 text-white/10 cursor-not-allowed'
                                                                    : 'bg-white/[0.02] border-white/10 text-white/80 hover:border-[#2D9E49]/50'
                                                                }`}
                                                        >
                                                            <div className="font-bold text-base tracking-tight">{time}</div>
                                                            <div className={`text-[9px] font-bold uppercase mt-1.5 ${isAvailable ? 'text-[#2D9E49]/70' : 'text-white/10'}`}>
                                                                {isAvailable ? 'Free' : 'Occupied'}
                                                            </div>
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                <div className="col-span-2 py-16 text-center bg-white/[0.02] rounded-3xl border border-white/5">
                                                    <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em]">No Available Slots</p>
                                                </div>
                                            )}
                                        </div>
                                    )
                                ) : (
                                    <div className="py-32 flex flex-col items-center justify-center opacity-10 border-2 border-dashed border-white/10 rounded-3xl">
                                        <Calendar className="w-12 h-12 mb-6" />
                                        <p className="text-[11px] font-bold uppercase tracking-[0.3em]">Pick a Date</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end pt-12 border-t border-white/5">
                            <button
                                disabled={!selectedTime}
                                onClick={() => setStep(3)}
                                className="px-16 py-6 bg-[#D42428] hover:bg-[#B71F23] text-white font-bold rounded-2xl flex items-center justify-center gap-3 group transition-all disabled:opacity-20 text-sm uppercase tracking-[0.2em]"
                            >
                                Continue to Details <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="max-w-xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-500">
                        <button onClick={() => setStep(2)} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-[0.2em]">
                            <ArrowLeft className="w-4 h-4" /> Change Time
                        </button>

                        <div className="bg-[#111111] rounded-3xl border border-white/5 p-10 shadow-2xl">
                            <h3 className="text-2xl font-bold uppercase text-white mb-10 border-b border-white/5 pb-6">Organizer Details</h3>
                            <div className="space-y-8">
                                <div className="space-y-3">
                                    <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] font-bold text-white/30">
                                        <User className="w-3.5 h-3.5" /> Contact Name
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-[#2D9E49] transition-all outline-none text-sm"
                                        placeholder="Full Name"
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-3">
                                        <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] font-bold text-white/30">
                                            <Mail className="w-3.5 h-3.5" /> Email Address
                                        </label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            readOnly={!!currentUser}
                                            className="w-full bg-white/[0.01] border border-white/5 rounded-2xl px-6 py-5 text-white/40 cursor-not-allowed text-sm font-medium"
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] font-bold text-white/30">
                                            <Phone className="w-3.5 h-3.5" /> Phone Number
                                        </label>
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-[#2D9E49] transition-all outline-none text-sm"
                                            placeholder="+1 (555) 000-0000"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] font-bold text-white/30">
                                        Party Notes & Requests
                                    </label>
                                    <textarea
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        rows={3}
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-[#2D9E49] transition-all outline-none resize-none text-sm"
                                        placeholder="Add any specific details for your event..."
                                    />
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => setStep(4)}
                            className="w-full bg-[#D42428] hover:bg-[#B71F23] text-white font-bold py-6 rounded-2xl flex items-center justify-center gap-3 group transition-all text-sm uppercase tracking-[0.2em] shadow-2xl shadow-[#D42428]/20"
                        >
                            Review Booking <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                )}

                {step === 4 && (
                    <div className="max-w-xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-500">
                        <button onClick={() => setStep(3)} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-[0.2em]">
                            <ArrowLeft className="w-4 h-4" /> Edit Info
                        </button>

                        <div className="bg-[#111111] rounded-3xl border border-white/5 overflow-hidden shadow-2xl relative">
                            <div className="bg-[#D42428]/5 px-10 py-8 border-b border-[#D42428]/10 flex items-center justify-between">
                                <h3 className="font-display font-bold uppercase tracking-tight text-xl">Event Overview</h3>
                                <div className="px-4 py-2 bg-[#D42428]/20 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] text-[#D42428] border border-[#D42428]/30">Reservation Phase</div>
                            </div>

                            <div className="p-10 space-y-10">
                                <div className="grid grid-cols-2 gap-10">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/20 mb-2">Event Date</p>
                                        <p className="text-base font-bold text-white">{selectedDate ? formatDate(selectedDate) : '-'}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/20 mb-2">Start Time</p>
                                        <p className="text-base font-bold text-white">{selectedTime}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/20 mb-2">Duration</p>
                                        <p className="text-base font-bold text-white">{duration} Hours</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/20 mb-2">Facility Access</p>
                                        <p className="text-base font-bold text-white">Full Venue (10 Sims)</p>
                                    </div>
                                </div>

                                <div className="pt-10 border-t border-white/5 space-y-6">
                                    <div className="flex justify-between items-center px-2">
                                        <span className="text-[11px] font-bold text-white/40 uppercase tracking-[0.3em]">Facility Rental Total</span>
                                        <span className="text-xl font-bold font-display">{formatCurrency(PARTY_PRICES[duration])}</span>
                                    </div>

                                    {/* Payment Amount Selector */}
                                    <div className="space-y-4 pt-6 border-t border-white/5">
                                        <label className="block text-[11px] font-bold text-white/40 uppercase tracking-[0.3em] mb-2 px-2">Payment Amount</label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <button
                                                onClick={() => setPaymentAmountType('deposit')}
                                                className={`p-5 rounded-2xl border text-left transition-all ${paymentAmountType === 'deposit'
                                                    ? 'bg-[#D42428]/10 border-[#D42428] text-white'
                                                    : 'bg-white/[0.02] border-white/10 text-white/40 hover:border-[#D42428]/30'
                                                    }`}
                                            >
                                                <div className="text-[10px] font-bold uppercase tracking-widest mb-1">Pay 50% Deposit</div>
                                                <div className="text-2xl font-bold text-[#D42428]">{formatCurrency(PARTY_PRICES[duration] * 0.5)}</div>
                                                <div className="text-xs mt-1">Pay remainder at venue</div>
                                            </button>

                                            <button
                                                onClick={() => setPaymentAmountType('full')}
                                                className={`p-5 rounded-2xl border text-left transition-all ${paymentAmountType === 'full'
                                                    ? 'bg-[#2D9E49]/10 border-[#2D9E49] text-white'
                                                    : 'bg-white/[0.02] border-white/10 text-white/40 hover:border-[#2D9E49]/30'
                                                    }`}
                                            >
                                                <div className="text-[10px] font-bold uppercase tracking-widest mb-1">Pay in Full</div>
                                                <div className="text-2xl font-bold text-[#2D9E49]">{formatCurrency(PARTY_PRICES[duration])}</div>
                                                <div className="text-xs mt-1">All settled up front</div>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Payment Method Selector */}
                                    <div className="space-y-4 pt-6">
                                        <label className="block text-[11px] font-bold text-white/40 uppercase tracking-[0.3em] mb-2 px-2">Select Payment Method</label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Stripe Option */}
                                            <button
                                                onClick={() => setPaymentMethod('stripe')}
                                                className={`p-5 rounded-2xl border text-left transition-all flex items-center gap-4 ${paymentMethod === 'stripe'
                                                    ? 'bg-[#635BFF]/10 border-[#635BFF] text-white'
                                                    : 'bg-white/[0.02] border-white/10 text-white/40 hover:border-[#635BFF]/30'
                                                    }`}
                                            >
                                                <CreditCard className={`w-6 h-6 ${paymentMethod === 'stripe' ? 'text-[#635BFF]' : 'text-white/20'}`} />
                                                <div>
                                                    <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5">Stripe</div>
                                                    <div className="text-sm font-bold">Credit Card / G-Pay</div>
                                                </div>
                                            </button>

                                            {/* PayPal Option */}
                                            <button
                                                onClick={() => setPaymentMethod('paypal')}
                                                disabled={!bookingConfig.paypalClientId}
                                                className={`p-5 rounded-2xl border text-left transition-all flex items-center gap-4 ${paymentMethod === 'paypal'
                                                    ? 'bg-[#003087]/10 border-[#003087] text-white'
                                                    : !bookingConfig.paypalClientId
                                                        ? 'bg-transparent border-white/5 opacity-50 cursor-not-allowed'
                                                        : 'bg-white/[0.02] border-white/10 text-white/40 hover:border-[#003087]/30'
                                                    }`}
                                            >
                                                <div className={`w-6 h-6 flex items-center justify-center font-bold text-lg italic ${paymentMethod === 'paypal' ? 'text-[#003087]' : 'text-white/20'}`}>P</div>
                                                <div>
                                                    <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5">PayPal</div>
                                                    <div className="text-sm font-bold">Pay via Account</div>
                                                </div>
                                            </button>

                                            {/* Admin Only Option */}
                                            {isAdmin && (
                                                <button
                                                    onClick={() => setPaymentMethod('venue')}
                                                    className={`p-5 rounded-2xl border text-left transition-all flex items-center gap-4 md:col-span-2 ${paymentMethod === 'venue'
                                                        ? 'bg-[#2D9E49]/10 border-[#2D9E49] text-white'
                                                        : 'bg-white/[0.02] border-white/10 text-white/40 hover:border-[#2D9E49]/30'
                                                        }`}
                                                >
                                                    <Users className={`w-6 h-6 ${paymentMethod === 'venue' ? 'text-[#2D9E49]' : 'text-white/20'}`} />
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5 text-[#2D9E49]">Admin Only</div>
                                                                <div className="text-sm font-bold">Pay at Venue</div>
                                                            </div>
                                                            <div className="px-3 py-1 bg-[#2D9E49]/20 rounded-full text-[9px] font-bold uppercase tracking-widest text-[#2D9E49] border border-[#2D9E49]/30">Manual Booking</div>
                                                        </div>
                                                    </div>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className={`flex justify-between items-center p-7 rounded-3xl border shadow-inner transition-all ${paymentMethod === 'venue'
                                        ? 'bg-[#2D9E49]/5 border-[#2D9E49]/10'
                                        : paymentAmountType === 'full'
                                            ? 'bg-[#2D9E49]/5 border-[#2D9E49]/10'
                                            : 'bg-[#D42428]/5 border-[#D42428]/10'
                                        }`}>
                                        <div className="flex items-center gap-4">
                                            <div className={`w-3 h-3 rounded-full animate-pulse shadow-lg ${paymentMethod === 'venue' || paymentAmountType === 'full' ? 'bg-[#2D9E49]' : 'bg-[#D42428]'}`} />
                                            <span className={`text-[11px] font-bold uppercase tracking-[0.3em] ${paymentMethod === 'venue' || paymentAmountType === 'full' ? 'text-[#2D9E49]' : 'text-[#D42428]'}`}>
                                                {paymentMethod === 'venue' ? 'Due at Venue' : paymentAmountType === 'full' ? 'Total Amount Due' : '50% Deposit Due Now'}
                                            </span>
                                        </div>
                                        <span className={`text-3xl font-display font-bold ${paymentMethod === 'venue' || paymentAmountType === 'full' ? 'text-[#2D9E49]' : 'text-[#D42428]'}`}>
                                            {formatCurrency(paymentMethod === 'venue' ? PARTY_PRICES[duration] : (paymentAmountType === 'full' ? PARTY_PRICES[duration] : PARTY_PRICES[duration] * 0.5))}
                                        </span>
                                    </div>
                                </div>

                                {paymentMethod === 'paypal' ? (
                                    <div className="mt-6 px-10 pb-10">
                                        <PayPalCheckout
                                            amount={paymentAmountType === 'full' ? PARTY_PRICES[duration] : PARTY_PRICES[duration] * 0.5}
                                            onSuccess={handlePayPalSuccess}
                                            onError={(err) => setError('PayPal Error: ' + err)}
                                            metadata={{ isParty: true, type: 'facility_takeover' }}
                                        />
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleCheckout}
                                        disabled={isSubmitting}
                                        className={`w-full font-bold py-7 rounded-2xl flex items-center justify-center gap-4 transition-all disabled:opacity-50 text-base uppercase tracking-[0.2em] shadow-2xl group ${paymentMethod === 'venue'
                                            ? 'bg-[#2D9E49] hover:bg-[#258a3f] shadow-[#2D9E49]/20'
                                            : 'bg-[#D42428] hover:bg-[#B71F23] shadow-[#D42428]/20'
                                            }`}
                                    >
                                        {isSubmitting ? (
                                            <><Loader2 className="w-6 h-6 animate-spin" /> Finalizing Connection...</>
                                        ) : (
                                            <>
                                                {paymentMethod === 'venue' ? (
                                                    <><CheckCircle className="w-6 h-6 group-hover:scale-110 transition-transform" /> Confirm Venue Booking</>
                                                ) : (
                                                    <><CreditCard className="w-6 h-6 group-hover:scale-110 transition-transform" /> Secure This Session</>
                                                )}
                                            </>
                                        )}
                                    </button>
                                )}

                                <p className="text-[10px] text-center text-white/20 font-bold uppercase tracking-[0.2em] px-12 leading-relaxed">
                                    Remainder to be paid on arrival. Cancellation policy applies.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default PartyBookingPage;
