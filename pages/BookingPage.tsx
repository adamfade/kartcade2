import React, { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
    Calendar, Clock, Users, Phone, Mail, ArrowRight, ArrowLeft,
    CheckCircle, CreditCard, Wallet, Info, AlertTriangle,
    Gauge, Monitor, Plane, Zap, Loader2, Shield, Gift, ArrowUpRight, Trophy
} from 'lucide-react';
import siteConfig from '../config/site';
import { bookingConfig, bookingApi, isApiConfigured } from '../config/booking';
import { useAuth } from '../contexts/AuthContext';
import { getEquipmentTypeFromStation } from '../config/membership';
import PayPalCheckout from '../components/PayPalCheckout';
import CalendarPicker from '../components/CalendarPicker';
import { db } from '../config/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// Station Types Configuration
const stationTypes = [
    {
        id: 'karts',
        name: 'Racing Karts',
        price: 30,
        units: 4,
        icon: <Gauge className="w-8 h-8" />,
        description: 'Perfect for kids 5+, teens, and adults under 6\'3"',
        ageReq: '5+',
        color: '#2D9E49'
    },
    {
        id: 'rigs',
        name: 'Full-Size Rigs',
        price: 40,
        units: 4,
        icon: <Monitor className="w-8 h-8" />,
        description: 'Professional direct-drive simulators for adults',
        ageReq: '10+',
        color: '#FFFFFF'
    },
    {
        id: 'motion',
        name: 'Motion Simulator',
        price: 50,
        units: 1,
        icon: <Zap className="w-8 h-8" />,
        description: 'Triple-screen with motion platform - the ultimate experience',
        ageReq: '14+',
        color: '#D42428'
    },
    {
        id: 'flight',
        name: 'Flight Simulator',
        price: 40,
        units: 1,
        icon: <Plane className="w-8 h-8" />,
        description: 'HOTAS setup for Star Wars Squadrons and more',
        ageReq: 'All ages',
        color: '#2D9E49'
    }
];

// Generate time slots
const generateTimeSlots = (date?: Date | null) => {
    const slots: string[] = [];
    const hours = date ? bookingConfig.hoursByDay[date.getDay()] : [bookingConfig.openHour, bookingConfig.closeHour];
    if (!hours) return slots; // closed
    for (let hour = hours[0]; hour < hours[1]; hour++) {
        slots.push(`${hour}:00`);
    }
    return slots;
};

// NOTE: Demo/simulation mode removed - availability now ALWAYS comes from real API
// This prevents cross-device sync issues caused by random fallback data

// Format date for display
const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
};

// Format date for API (YYYY-MM-DD)
// Format date for API (YYYY-MM-DD) in Oregon Time
const formatDateForApi = (date: Date) => {
    // strict conversion to Oregon time to prevent UTC rollover
    return date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
};

// Generate next 30 days
const generateDates = () => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < bookingConfig.maxAdvanceDays; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        dates.push(date);
    }
    return dates;
};

// Email validation helper
const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Phone validation helper (at least 10 digits)
const isValidPhone = (phone: string): boolean => {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 10;
};

// Equipment cart type for multi-booking
type EquipmentCart = {
    [key: string]: number; // stationId -> quantity
};

const BookingPage: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isLiveMode, setIsLiveMode] = useState(isApiConfigured());
    const { currentUser, userProfile, isAdmin, getCredits, useCredits, hasEnoughCredits, getBtpCredits, hasBtpCooldown, useBtpCredit } = useAuth();

    // Booking state
    const [searchParams] = useSearchParams();

    // Booking state - Initialize from URL params if available
    const [step, setStep] = useState(() => {
        const hasStation = searchParams.get('station');
        const hasDate = searchParams.get('date');
        const hasTime = searchParams.get('time');

        if (hasStation && hasDate && hasTime) return 3;
        if (hasStation && hasDate) return 2;
        return 1;
    });

    const [selectedStation, setSelectedStation] = useState<string | null>(searchParams.get('station') || null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(() => {
        const d = searchParams.get('date');
        // Handle timezone issues by treating date as local YYYY-MM-DD
        if (d) {
            const parts = d.split('-');
            const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            // Option B: Silently clear Mon (1) or Tue (2) dates from URL params
            // (we are closed Mon/Tue so pre-filled closed dates should not load)
            const day = date.getDay();
            if (day === 1 || day === 2) return null;
            return date;
        }
        return null;
    });
    const [selectedTime, setSelectedTime] = useState<string | null>(searchParams.get('time') || null);

    // SECURITY FIX: Default to 'deposit' instead of 'venue' to prevent accidental unpaid bookings.
    // 'venue' is restricted to Admins only, so it should never be the default state.
    const [paymentMethod, setPaymentMethod] = useState<'now' | 'venue' | 'deposit' | 'credits' | 'paypal' | 'btp_credit'>('deposit');

    const [availability, setAvailability] = useState<{ [key: string]: { booked: number; available: number; total: number } }>({});
    const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [loadingStripe, setLoadingStripe] = useState(false);

    // Multi-booking state
    const [equipmentCart, setEquipmentCart] = useState<EquipmentCart>({
        karts: 0,
        rigs: 0,
        motion: 0,
        flight: 0
    });
    const [duration, setDuration] = useState(0.5); // 0.5, 1, 1.5, 2, 2.5, 3 hours
    const [formErrors, setFormErrors] = useState<{ email?: string; phone?: string }>({});

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        notes: ''
    });

    // Anyone can browse availability; a driver profile is required to book.
    // The selection survives the trip through login or sign-up.
    const navigate = useNavigate();
    const PENDING_KEY = 'kartcade.pendingBooking';
    useEffect(() => {
        if (!currentUser) return;
        try {
            const raw = sessionStorage.getItem(PENDING_KEY);
            if (!raw) return;
            sessionStorage.removeItem(PENDING_KEY);
            const p = JSON.parse(raw);
            if (p.cart) setEquipmentCart(p.cart);
            if (p.duration) setDuration(p.duration);
            if (p.station) setSelectedStation(p.station);
            if (p.date) { const [y, m, d] = p.date.split('-').map(Number); setSelectedDate(new Date(y, m - 1, d)); }
            if (p.time) setSelectedTime(p.time);
            if (p.date && p.time) setStep(3);
        } catch { /* storage unavailable: start fresh */ }
    }, [currentUser]);

    const continueToDetails = () => {
        if (!selectedDate || !selectedTime) return;
        if (currentUser) { setStep(3); return; }
        try {
            sessionStorage.setItem(PENDING_KEY, JSON.stringify({
                cart: equipmentCart, duration, station: selectedStation,
                date: formatDateForApi(selectedDate), time: selectedTime,
            }));
        } catch { /* ignore */ }
        navigate('/login', { state: { from: '/book', reason: 'booking' } });
    };

    const hasAnyEquipment = () => {
        return Object.values(equipmentCart).some(qty => qty > 0);
    };

    // Cart helper: get total items (drivers)
    const getTotalDrivers = () => {
        return Object.values(equipmentCart).reduce((sum, qty) => sum + qty, 0);
    };

    // Get equipment type for credits - UPDATED for multi-booking "Cart"
    const cartEntries = Object.entries(equipmentCart).filter(([_, qty]) => qty > 0);
    const isSingleTypeCart = cartEntries.length === 1;
    const firstEquipId = cartEntries[0]?.[0];
    const equipmentType = firstEquipId ? getEquipmentTypeFromStation(firstEquipId) : null;
    const totalCartDrivers = getTotalDrivers();
    const availableCredits = equipmentType ? getCredits(equipmentType) : 0;
    const canUseCredits = equipmentType && isSingleTypeCart && hasEnoughCredits(equipmentType, totalCartDrivers * duration);

    // BTP credit availability (needs 30min duration, credit in wallet, no active cooldown)
    const btpBalance = getBtpCredits();
    const btpCooldown = hasBtpCooldown();
    const canUseBtpCredit = !isAdmin && btpBalance > 0 && duration === 0.5;

    // Auto-fill user details if logged in (but NOT for admins, so they can enter customer data)
    useEffect(() => {
        if (userProfile && currentUser && !isAdmin) {
            setFormData(prev => ({
                ...prev,
                name: userProfile.name || '',
                email: currentUser.email || '',
                phone: userProfile.phone || ''
            }));
        }
    }, [userProfile, currentUser, isAdmin]);

    // Dates for calendar
    const dates = generateDates();
    const timeSlots = generateTimeSlots(selectedDate);

    // Get first equipment type in cart for availability
    const getFirstCartEquipment = (): string | null => {
        for (const station of stationTypes) {
            if ((equipmentCart[station.id] || 0) > 0) {
                return station.id;
            }
        }
        return selectedStation; // Fallback for legacy mode
    };

    // Load availability when date/equipment/duration changes
    useEffect(() => {
        if (selectedDate && (hasAnyEquipment() || selectedStation)) {
            loadAvailability();
        }
    }, [selectedDate, equipmentCart, selectedStation, duration]);

    // Fetch availability from API - ROBUST VERSION (No Demo Fallback)
    const loadAvailability = async () => {
        const equipmentId = getFirstCartEquipment();
        if (!selectedDate || !equipmentId) return;

        setIsLoadingAvailability(true);
        setError(null);
        setAvailability({}); // Clear old data while loading

        const dateStr = formatDateForApi(selectedDate);

        try {
            const response = await bookingApi.getAvailability(dateStr, equipmentId, duration);

            if (response && response.availability) {
                setAvailability(response.availability);
            } else {
                // API returned but no availability data - show empty state
                console.warn('API returned no availability data');
                setError('No availability data found. Please try again or contact support.');
            }
        } catch (err: any) {
            // API completely failed after retries
            console.error('Availability fetch failed:', err);
            setError(err.message || 'Failed to load availability. Please refresh the page.');
            setAvailability({}); // Ensure no stale data
        } finally {
            setIsLoadingAvailability(false);
        }
    };

    // Calculate available units for selected time
    const getAvailableUnits = (time: string) => {
        const slot = availability[time];
        if (slot) {
            return slot.available;
        }
        // Availability loaded but this hour isn't in it: outside opening hours.
        if (Object.keys(availability).length > 0) return 0;
        // Fallback to station max
        const station = stationTypes.find(s => s.id === selectedStation);
        return station?.units || 1;
    };

    // Get station info
    const selectedStationData = stationTypes.find(s => s.id === selectedStation);

    useGSAP(() => {
        gsap.fromTo(".booking-step",
            { opacity: 0, y: 20 },
            { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }
        );
    }, [step]);

    // Auto-scroll to top when step changes
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [step]);

    const handleSubmit = async () => {
        if (!selectedDate || !selectedTime || !hasAnyEquipment()) return;

        // NEW: If Deposit selected, open the "Choose Method" modal instead of submitting immediately
        if (paymentMethod === 'deposit') {
            setShowPaymentModal(true);
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            // If paying with credits, deduct them first
            if (paymentMethod === 'credits' && equipmentType) {
                const totalCreditsNeeded = getTotalDrivers() * duration;
                const creditsUsed = await useCredits(equipmentType, totalCreditsNeeded);
                if (!creditsUsed) {
                    setError('Failed to use credits. Please try again or choose a different payment method.');
                    setIsSubmitting(false);
                    return;
                }
            }

            // If paying with BTP credit, deduct it
            if (paymentMethod === 'btp_credit') {
                const btpUsed = await useBtpCredit();
                if (!btpUsed) {
                    setError('Failed to use BTP credit. Cooldown might be active.');
                    setIsSubmitting(false);
                    return;
                }
            }

            // Construct notes with credit info AND driver specs
            let finalNotes = formData.notes;

            // Add credit info if applicable
            if (paymentMethod === 'btp_credit') {
                finalNotes += ` [Paid with 1 BTP Credit]`;
            } else if (paymentMethod === 'credits') {
                finalNotes += ` [Paid with ${getTotalDrivers() * duration} credit(s)]`;
            }

            // Add Driver Tech Specs (for Adam's reference)
            if (userProfile) {
                const specs: string[] = [];
                if (userProfile.favCar) specs.push(`Car: ${userProfile.favCar}`);
                if (userProfile.favTrack) specs.push(`Track: ${userProfile.favTrack}`);
                if (userProfile.favRig) specs.push(`Rig: ${userProfile.favRig}`);
                if (userProfile.settings) specs.push(`Settings: ${userProfile.settings}`);

                if (specs.length > 0) {
                    finalNotes += ` \n[DRIVER SPECS: ${specs.join(' | ')}]`;
                }
            }

            const result = await bookingApi.createBooking({
                date: formatDateForApi(selectedDate),
                time: selectedTime,
                station: `${getCartSummary()} (${duration}h)`,
                drivers: getTotalDrivers(),
                name: formData.name,
                email: formData.email,
                phone: formData.phone,
                paymentMethod: paymentMethod === 'credits' ? 'credits' : paymentMethod,
                notes: finalNotes
            });

            if (result.success) {
                setBookingId(result.bookingId);
                setIsComplete(true);

                // CRM: Log booking to Firebase (safe — won't affect booking)
                try {
                    const equipmentBreakdown: Record<string, number> = {};
                    stationTypes.forEach(s => {
                        const qty = equipmentCart[s.id] || 0;
                        if (qty > 0) equipmentBreakdown[s.id] = qty;
                    });
                    await addDoc(collection(db, 'transactions_log'), {
                        userId: currentUser?.uid || '',
                        email: formData.email,
                        name: formData.name,
                        phone: formData.phone,
                        type: 'booking',
                        station: `${getCartSummary()} (${duration}h)`,
                        equipment: equipmentBreakdown,
                        drivers: getTotalDrivers(),
                        duration,
                        creditsCharged: getTotalDrivers() * duration,
                        date: formatDateForApi(selectedDate),
                        time: selectedTime,
                        calculatedPrice: calculateTotal(),
                        paymentMethod: paymentMethod === 'credits' ? 'credits' : paymentMethod,
                        bookingId: result.bookingId || '',
                        status: 'confirmed',
                        createdAt: serverTimestamp()
                    });
                    console.log('[CRM] Booking logged for', formData.email);
                } catch (logErr) {
                    console.error('[CRM] Failed to log booking (non-critical):', logErr);
                }
            } else {
                setError(result.error || 'Failed to create booking');
            }
        } catch (err) {
            setError('Network error. Please try again.');
        }

        setIsSubmitting(false);
    };

    // Handle Stripe Deposit (Redirect to Checkout)
    const handleStripeDeposit = async () => {
        if (!currentUser) return alert('Please login to pay');

        setLoadingStripe(true);
        try {
            const depositAmount = Math.round(calculateTotal() / 2) * 100; // 50% in cents, rounded to whole dollar

            const response = await fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.uid,
                    userEmail: currentUser.email,
                    amount: depositAmount, // Custom Amount
                    mode: 'payment',
                    productName: `50% Deposit: ${getCartSummary()} (${formatDate(selectedDate!)} - ${duration}hr)`,
                    // Pass booking details for Webhook Fulfillment
                    bookingDetails: {
                        station: `${getCartSummary()} (${duration}h)`,
                        date: formatDateForApi(selectedDate!),
                        time: selectedTime,
                        drivers: getTotalDrivers(),
                        duration: duration,
                        name: formData.name,
                        email: formData.email,
                        phone: formData.phone,
                        notes: formData.notes,
                        stationEquipment: equipmentCart
                    }
                })
            });

            const data = await response.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                alert('Stripe Error: ' + data.error);
                setLoadingStripe(false);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to Stripe');
            setLoadingStripe(false);
        }
    };

    const handlePayPalSuccess = async (details: any) => {
        console.log('PayPal Success:', details);
        setIsSubmitting(true);
        setError(null);

        try {
            // Construct notes with PayPal info
            let finalNotes = formData.notes;
            const isDeposit = paymentMethod === 'deposit';
            finalNotes += isDeposit
                ? ` [PAID 50% DEPOSIT via PayPal: ${details.id}]`
                : ` [Paid via PayPal: ${details.id}]`;

            // Add Driver Tech Specs
            if (userProfile) {
                const specs: string[] = [];
                if (userProfile.favCar) specs.push(`Car: ${userProfile.favCar}`);
                if (userProfile.favTrack) specs.push(`Track: ${userProfile.favTrack}`);
                if (userProfile.favRig) specs.push(`Rig: ${userProfile.favRig}`);
                if (userProfile.settings) specs.push(`Settings: ${userProfile.settings}`);

                if (specs.length > 0) {
                    finalNotes += ` \n[DRIVER SPECS: ${specs.join(' | ')}]`;
                }
            }
            const result = await bookingApi.createBooking({
                date: formatDateForApi(selectedDate!),
                time: selectedTime!,
                station: `${getCartSummary()} (${duration}h)`,
                drivers: getTotalDrivers(),
                name: formData.name,
                email: formData.email,
                phone: formData.phone,
                paymentMethod: isDeposit ? 'paypal_deposit' : 'paypal',
                notes: finalNotes
            });

            if (result.success) {
                setBookingId(result.bookingId);
                setIsComplete(true);

                // CRM: Log PayPal booking to Firebase (safe — won't affect booking)
                try {
                    const equipmentBreakdown: Record<string, number> = {};
                    stationTypes.forEach(s => {
                        const qty = equipmentCart[s.id] || 0;
                        if (qty > 0) equipmentBreakdown[s.id] = qty;
                    });
                    await addDoc(collection(db, 'transactions_log'), {
                        userId: currentUser?.uid || '',
                        email: formData.email,
                        name: formData.name,
                        phone: formData.phone,
                        type: 'booking',
                        station: `${getCartSummary()} (${duration}h)`,
                        equipment: equipmentBreakdown,
                        drivers: getTotalDrivers(),
                        duration,
                        creditsCharged: getTotalDrivers() * duration,
                        date: formatDateForApi(selectedDate!),
                        time: selectedTime!,
                        calculatedPrice: calculateTotal(),
                        paymentMethod: isDeposit ? 'paypal_deposit' : 'paypal',
                        bookingId: result.bookingId || '',
                        status: 'confirmed',
                        createdAt: serverTimestamp()
                    });
                    console.log('[CRM] PayPal booking logged for', formData.email);
                } catch (logErr) {
                    console.error('[CRM] Failed to log PayPal booking (non-critical):', logErr);
                }
            } else {
                setError(result.error || 'Booking created, but failed to save details. Please contact us.');
            }
        } catch (err) {
            setError('Payment successful, but booking failed to save. Please contact us with your Transaction ID: ' + details.id);
        }
        setIsSubmitting(false);
    };

    // Calculate total - UPDATED for multi-booking
    const calculateTotal = () => {
        // If using legacy single-station mode
        if (selectedStation && !hasAnyEquipment()) {
            if (!selectedStationData) return 0;
            return selectedStationData.price * getTotalDrivers() * duration;
        }
        // Multi-equipment mode
        let total = 0;
        stationTypes.forEach(station => {
            const qty = equipmentCart[station.id] || 0;
            total += station.price * qty * duration;
        });
        return total;
    };

    // Cart helper: get cart summary text
    const getCartSummary = () => {
        const items: string[] = [];
        stationTypes.forEach(station => {
            const qty = equipmentCart[station.id] || 0;
            if (qty > 0) {
                const shortName = station.id === 'karts' ? 'Karts' :
                    station.id === 'rigs' ? 'Rigs' :
                        station.id === 'motion' ? 'Motion' : 'Flight';
                items.push(`${shortName}:${qty}`);
            }
        });
        return items.length > 0 ? items.join(', ') : 'None selected';
    };

    // Update cart quantity
    const updateCartQuantity = (stationId: string, delta: number) => {
        const station = stationTypes.find(s => s.id === stationId);
        if (!station) return;
        const current = equipmentCart[stationId] || 0;
        const newQty = Math.max(0, Math.min(station.units, current + delta));
        setEquipmentCart(prev => ({ ...prev, [stationId]: newQty }));
    };

    return (
        <div ref={containerRef} className="bg-[#0A0A0A] text-white min-h-screen">
            {/* Hero Section */}
            <section className="relative pt-28 pb-8 px-6 md:px-12 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-[#D42428]/10 to-transparent"></div>

                <div className="max-w-4xl mx-auto relative z-10 text-center">
                    <span className="block text-[#2D9E49] text-xs font-bold uppercase tracking-widest mb-4">
                        Reserve Your Session
                    </span>
                    <h1 className="font-display text-4xl md:text-6xl font-bold uppercase leading-none mb-4">
                        Book <span className="text-[#D42428]">Now</span>
                    </h1>

                    {/* Mode Indicator */}
                    {!isLiveMode && (
                        <div className="inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 px-4 py-2 rounded-full text-sm mb-4">
                            <AlertTriangle className="w-4 h-4" />
                            Demo Mode - API not configured
                        </div>
                    )}

                    {/* Admin Mode Indicator */}
                    {isAdmin && (
                        <div className="inline-flex items-center gap-2 bg-[#D42428]/10 border border-[#D42428]/30 text-[#D42428] px-4 py-2 rounded-full text-sm mb-4 ml-2">
                            <Shield className="w-4 h-4" />
                            Admin Mode - Pay at Venue enabled
                        </div>
                    )}

                    {/* Progress Steps */}
                    <div className="flex items-center justify-center gap-1 sm:gap-2 mt-8">
                        {[1, 2, 3, 4].map((s) => (
                            <div key={s} className="flex items-center">
                                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-all ${step >= s
                                    ? 'bg-[#2D9E49] text-white'
                                    : 'bg-white/10 text-white/40'
                                    }`}>
                                    {step > s ? <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" /> : s}
                                </div>
                                {s < 4 && (
                                    <div className={`w-6 sm:w-12 md:w-20 h-1 mx-0.5 sm:mx-1 transition-all ${step > s ? 'bg-[#2D9E49]' : 'bg-white/10'
                                        }`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-center gap-2 sm:gap-4 md:gap-12 mt-3 text-[10px] sm:text-xs text-white/40 uppercase tracking-wider">
                        <span className={step >= 1 ? 'text-white' : ''}>Equipment</span>
                        <span className={step >= 2 ? 'text-white' : ''}>Date/Time</span>
                        <span className={step >= 3 ? 'text-white' : ''}>Details</span>
                        <span className={step >= 4 ? 'text-white' : ''}>Confirm</span>
                    </div>
                </div>
            </section>

            {/* Booking Steps */}
            <section className="py-8 px-6 md:px-12">
                <div className="max-w-4xl mx-auto">

                    {/* Error Display */}
                    {error && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 flex items-center gap-3">
                            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Success Screen */}
                    {isComplete ? (
                        <div className="booking-step text-center py-16">
                            <div className="w-24 h-24 bg-[#2D9E49] rounded-full flex items-center justify-center mx-auto mb-8">
                                <CheckCircle className="w-12 h-12 text-white" />
                            </div>
                            <h2 className="font-display text-4xl font-bold uppercase mb-4">Booking Confirmed!</h2>
                            <p className="text-white/60 text-lg mb-2">
                                Your booking ID: <span className="text-[#2D9E49] font-bold">{bookingId}</span>
                            </p>
                            <p className="text-white/40 text-sm mb-8">
                                {isLiveMode ? 'Check your email for confirmation details.' : 'Demo mode - no email sent'}
                            </p>

                            <div className="bg-[#141414] border border-white/10 rounded-2xl p-8 max-w-md mx-auto mb-8">
                                <div className="space-y-4 text-left">
                                    <div className="flex justify-between">
                                        <span className="text-white/50">Station</span>
                                        <span className="font-medium">{selectedStationData?.name}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-white/50">Date</span>
                                        <span className="font-medium">{selectedDate && formatDate(selectedDate)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-white/50">Time</span>
                                        <span className="font-medium">{selectedTime}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-white/50">Drivers</span>
                                        <span className="font-medium">{getTotalDrivers()}</span>
                                    </div>
                                    <div className="flex justify-between border-t border-white/10 pt-4">
                                        <span className="text-white/50">Total</span>
                                        <span className="font-bold text-[#2D9E49] text-xl">${calculateTotal()}</span>
                                    </div>
                                </div>
                            </div>

                            <p className="text-white/40 text-sm mb-8">
                                {paymentMethod === 'venue' && 'Payment will be collected at the venue.'}
                                {paymentMethod === 'now' && 'You\'ll receive a payment link shortly.'}
                                {paymentMethod === 'deposit' && 'Deposit of $' + Math.round(calculateTotal() / 2) + ' will be charged.'}
                            </p>

                            <Link
                                to="/"
                                className="inline-flex items-center gap-3 px-10 py-4 bg-white text-black rounded-full font-bold uppercase tracking-widest hover:bg-white/90 transition-colors"
                            >
                                Back to Home
                            </Link>
                        </div>
                    ) : (
                        <>
                            {/* Step 1: Select Equipment & Duration */}
                            {step === 1 && (
                                <div className="booking-step">
                                    <h2 className="font-display text-2xl font-bold uppercase mb-8 text-center">
                                        Select Equipment & Duration
                                    </h2>

                                    {/* Equipment Selection */}
                                    <div className="space-y-4 mb-8">
                                        {stationTypes.map((station) => {
                                            const qty = equipmentCart[station.id] || 0;
                                            return (
                                                <div
                                                    key={station.id}
                                                    className={`p-4 sm:p-6 rounded-2xl border transition-all ${qty > 0
                                                        ? 'border-[#2D9E49] bg-[#2D9E49]/10'
                                                        : 'border-white/10 bg-[#141414]'
                                                        }`}
                                                >
                                                    {/* Mobile: Stack vertically, Desktop: Horizontal */}
                                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                                        {/* Header Row - Always horizontal */}
                                                        <div className="flex items-center gap-3 sm:gap-4 flex-1">
                                                            <div className="flex-shrink-0" style={{ color: station.color }}>{station.icon}</div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center justify-between gap-2 mb-1">
                                                                    <h3 className="font-display text-base sm:text-lg font-bold uppercase truncate">{station.name}</h3>
                                                                    <span className="text-[#2D9E49] font-bold text-sm sm:text-base flex-shrink-0">${station.price}/hr</span>
                                                                </div>
                                                                <p className="text-white/50 text-xs sm:text-sm line-clamp-2">{station.description}</p>
                                                                <div className="flex items-center gap-2 mt-1 text-xs text-white/40">
                                                                    <span>Max: {station.units}</span>
                                                                    <span>•</span>
                                                                    <span>Ages {station.ageReq}</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Quantity Controls - Full width on mobile */}
                                                        <div className="flex items-center justify-center gap-4 sm:gap-3 pt-3 sm:pt-0 border-t sm:border-0 border-white/10">
                                                            <button
                                                                onClick={() => updateCartQuantity(station.id, -1)}
                                                                disabled={qty === 0}
                                                                className="w-12 h-12 sm:w-10 sm:h-10 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                                            >
                                                                <span className="text-2xl sm:text-xl font-bold">−</span>
                                                            </button>
                                                            <span className="w-12 text-center text-2xl sm:text-xl font-bold">{qty}</span>
                                                            <button
                                                                onClick={() => updateCartQuantity(station.id, 1)}
                                                                disabled={qty >= station.units}
                                                                className="w-12 h-12 sm:w-10 sm:h-10 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                                            >
                                                                <span className="text-2xl sm:text-xl font-bold">+</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Duration Selector */}
                                    <div className="mb-8">
                                        <label className="block text-xs uppercase tracking-widest text-white/40 mb-4">
                                            <Clock className="w-4 h-4 inline mr-2" />
                                            Session Duration
                                        </label>
                                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                                            {[
                                                { value: 0.5, label: '30 min' },
                                                { value: 1, label: '1 hr' },
                                                { value: 1.5, label: '1h 30m' },
                                                { value: 2, label: '2 hrs' },
                                                { value: 2.5, label: '2h 30m' },
                                                { value: 3, label: '3 hrs' },
                                            ].map(({ value, label }) => (
                                                <button
                                                    key={value}
                                                    onClick={() => setDuration(value)}
                                                    className={`py-3 rounded-xl text-center text-sm font-bold transition-all ${duration === value
                                                        ? 'bg-[#2D9E49] text-white'
                                                        : 'bg-[#141414] border border-white/10 hover:border-white/30'
                                                        }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Cart Summary */}
                                    {hasAnyEquipment() && (
                                        <div className="bg-[#141414] border border-white/10 rounded-2xl p-6 mb-8">
                                            <h3 className="text-xs uppercase tracking-widest text-white/40 mb-4">Your Selection</h3>
                                            <div className="space-y-2 mb-4">
                                                {stationTypes.map((station) => {
                                                    const qty = equipmentCart[station.id] || 0;
                                                    if (qty === 0) return null;
                                                    return (
                                                        <div key={station.id} className="flex justify-between text-sm">
                                                            <span>{qty}x {station.name}</span>
                                                            <span className="text-white/60">${station.price * qty * duration}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="flex justify-between border-t border-white/10 pt-4">
                                                <span className="font-bold">Total ({duration}hr session)</span>
                                                <span className="text-[#2D9E49] font-bold text-xl">${calculateTotal()}</span>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-end mt-8">
                                        <button
                                            onClick={() => hasAnyEquipment() && setStep(2)}
                                            disabled={!hasAnyEquipment()}
                                            className="flex items-center gap-3 px-10 py-4 bg-[#D42428] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#B91C1C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {currentUser ? 'Continue' : 'Sign in to book'} <ArrowRight className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Step 2: Select Date & Time */}
                            {step === 2 && (
                                <div className="booking-step">
                                    <button onClick={() => setStep(1)} className="flex items-center gap-2 text-white/50 hover:text-white mb-6">
                                        <ArrowLeft className="w-4 h-4" /> Back to stations
                                    </button>

                                    <h2 className="font-display text-2xl font-bold uppercase mb-8 text-center">
                                        Select Date & Time
                                    </h2>

                                    {/* Date Picker */}
                                    <div className="mb-8">
                                        <label className="block text-xs uppercase tracking-widest text-white/40 mb-4">
                                            <Calendar className="w-4 h-4 inline mr-2" />
                                            Select Date
                                        </label>
                                        <CalendarPicker
                                            selectedDate={selectedDate}
                                            onDateChange={(date) => {
                                                setSelectedDate(date);
                                                setSelectedTime(null);
                                            }}
                                            minDate={(() => {
                                                const min = new Date();
                                                if (!isAdmin) {
                                                    // On weekends (Sat=6, Sun=0): no lead time, same-day booking allowed
                                                    // On weekdays (Wed/Thu/Fri): keep standard 8h notice
                                                    const todayDay = min.getDay();
                                                    const isWeekend = todayDay === 0 || todayDay === 6;
                                                    if (!isWeekend) {
                                                        min.setHours(min.getHours() + bookingConfig.minAdvanceHours);
                                                    }
                                                }
                                                return min;
                                            })()}
                                            maxDate={(() => {
                                                const max = new Date();
                                                max.setDate(max.getDate() + bookingConfig.maxAdvanceDays);
                                                return max;
                                            })()}
                                            filterDate={(date) => {
                                                // Block Mondays (1) and Tuesdays (2) — closed days
                                                const day = date.getDay();
                                                return day !== 1 && day !== 2;
                                            }}
                                        />
                                    </div>

                                    {/* Time Slots */}
                                    {selectedDate && (
                                        <div className="mb-8">
                                            <label className="block text-xs uppercase tracking-widest text-white/40 mb-4">
                                                <Clock className="w-4 h-4 inline mr-2" />
                                                Available Time Slots - {formatDate(selectedDate)}
                                            </label>

                                            {isLoadingAvailability ? (
                                                <div className="flex items-center justify-center py-12">
                                                    <Loader2 className="w-8 h-8 animate-spin text-[#2D9E49]" />
                                                    <span className="ml-3 text-white/50">Loading availability...</span>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
                                                    {timeSlots.map((time) => {
                                                        const available = getAvailableUnits(time);
                                                        const isSelected = selectedTime === time;

                                                        // Check if cart quantity exceeds available for THIS equipment type
                                                        // For now, we get availability for first cart equipment only
                                                        const firstEquipment = getFirstCartEquipment();
                                                        const requestedQty = firstEquipment ? (equipmentCart[firstEquipment] || 0) : 0;
                                                        const exceedsCapacity = requestedQty > available;

                                                        // Check if time is in the past (Oregon Time)
                                                        // FIX: old toLocaleString+new Date() hack re-parses in browser's
                                                        // local timezone, giving wrong hours for non-Oregon users (caused Gary bug).
                                                        // Now using toLocaleDateString (same as formatDateForApi) + Intl.DateTimeFormat.
                                                        const oregonDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
                                                        const selectedDateStr = selectedDate ? formatDateForApi(selectedDate) : '';
                                                        const isToday = selectedDateStr === oregonDateStr;

                                                        const slotHour = parseInt(time.split(':')[0]);
                                                        const oregonHour = parseInt(new Intl.DateTimeFormat('en-US', {
                                                            timeZone: 'America/Los_Angeles',
                                                            hour: 'numeric',
                                                            hour12: false
                                                        }).format(new Date()));
                                                        const isPast = isToday && slotHour <= oregonHour;

                                                        // Disable if: no slots, past time, OR requested more than available
                                                        const isDisabled = available <= 0 || isPast || exceedsCapacity;

                                                        // Status text
                                                        let statusText = 'Available';
                                                        let statusColor = 'text-[#2D9E49]';
                                                        if (isPast) {
                                                            statusText = 'PASSED';
                                                            statusColor = 'text-white/20';
                                                        } else if (available <= 0) {
                                                            statusText = 'FULL';
                                                            statusColor = 'text-[#D42428]';
                                                        } else if (exceedsCapacity) {
                                                            statusText = `Only ${available} left`;
                                                            statusColor = 'text-[#D42428]';
                                                        }

                                                        return (
                                                            <button
                                                                key={time}
                                                                onClick={() => {
                                                                    if (!isDisabled) {
                                                                        setSelectedTime(time);
                                                                    }
                                                                }}
                                                                disabled={isDisabled}
                                                                className={`p-4 rounded-xl text-center transition-all ${isSelected
                                                                    ? 'bg-[#2D9E49] text-white'
                                                                    : isDisabled
                                                                        ? 'bg-[#1a1a1a] text-white/20 cursor-not-allowed border border-transparent'
                                                                        : 'bg-[#141414] border border-white/10 hover:border-[#2D9E49]/50'
                                                                    }`}
                                                            >
                                                                <div className="font-bold">{time}</div>
                                                                <div className={`text-xs mt-1 ${statusColor}`}>
                                                                    {statusText}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Cart Summary (replaces old Drivers selector) */}
                                    {selectedTime && (
                                        <div className="bg-[#141414] border border-white/10 rounded-xl p-4 mb-8">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">Your Selection</div>
                                                    <div className="text-sm text-white/80">{getCartSummary()} • {duration}hr</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-2xl font-bold text-[#2D9E49]">${calculateTotal()}</div>
                                                    <div className="text-xs text-white/40">{getTotalDrivers()} driver{getTotalDrivers() > 1 ? 's' : ''}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-between mt-8">
                                        <button
                                            onClick={() => setStep(1)}
                                            className="flex items-center gap-2 px-6 py-4 border border-white/20 text-white rounded-full font-bold uppercase tracking-widest hover:bg-white/5 transition-colors"
                                        >
                                            <ArrowLeft className="w-5 h-5" /> Back
                                        </button>
                                        <button
                                            onClick={continueToDetails}
                                            disabled={!selectedDate || !selectedTime}
                                            className="flex items-center gap-3 px-10 py-4 bg-[#D42428] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#B91C1C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Continue <ArrowRight className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Step 3: Your Details */}
                            {step === 3 && (
                                <div className="booking-step">
                                    <button onClick={() => setStep(2)} className="flex items-center gap-2 text-white/50 hover:text-white mb-6">
                                        <ArrowLeft className="w-4 h-4" /> Back to time selection
                                    </button>

                                    <h2 className="font-display text-2xl font-bold uppercase mb-6 text-center">
                                        Your Details
                                    </h2>

                                    {/* Warning: logged-in but phone missing from profile */}
                                    {currentUser && !isAdmin && !userProfile?.phone && (
                                        <div className="max-w-lg mx-auto mb-6 flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                                            <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                                            <div className="text-sm">
                                                <p className="font-bold text-yellow-300 mb-1">Phone number required to complete booking</p>
                                                <p className="text-yellow-400/80">Your profile doesn't have a phone number yet. Please enter it below, or <Link to="/dashboard" className="underline hover:text-yellow-200">update your profile</Link> first.</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Info: logged-in, details pre-filled */}
                                    {currentUser && !isAdmin && userProfile?.phone && (
                                        <div className="max-w-lg mx-auto mb-6 flex items-start gap-3 p-3 bg-[#2D9E49]/10 border border-[#2D9E49]/20 rounded-xl">
                                            <CheckCircle className="w-4 h-4 text-[#2D9E49] flex-shrink-0 mt-0.5" />
                                            <p className="text-xs text-[#2D9E49]/80">Your details have been pre-filled from your driver profile. Review and update if needed.</p>
                                        </div>
                                    )}
                                    <div className="max-w-lg mx-auto space-y-6">
                                        <div>
                                            <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Full Name *</label>
                                            <input
                                                type="text"
                                                required
                                                value={formData.name}
                                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-4 text-white focus:border-[#2D9E49] focus:outline-none transition-colors"
                                                placeholder="Enter your full name"
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Email *</label>
                                                <input
                                                    type="email"
                                                    required
                                                    value={formData.email}
                                                    onChange={(e) => {
                                                        setFormData({ ...formData, email: e.target.value });
                                                        if (formErrors.email && isValidEmail(e.target.value)) {
                                                            setFormErrors(prev => ({ ...prev, email: undefined }));
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        if (formData.email && !isValidEmail(formData.email)) {
                                                            setFormErrors(prev => ({ ...prev, email: 'Please enter a valid email address' }));
                                                        }
                                                    }}
                                                    className={`w-full bg-[#141414] border rounded-xl px-4 py-4 text-white focus:outline-none transition-colors ${formErrors.email ? 'border-red-500 focus:border-red-500' : 'border-white/10 focus:border-[#2D9E49]'}`}
                                                    placeholder="john@email.com"
                                                />
                                                {formErrors.email && (
                                                    <p className="text-red-500 text-xs mt-1">{formErrors.email}</p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Phone *</label>
                                                <input
                                                    type="tel"
                                                    required
                                                    value={formData.phone}
                                                    onChange={(e) => {
                                                        setFormData({ ...formData, phone: e.target.value });
                                                        if (formErrors.phone && isValidPhone(e.target.value)) {
                                                            setFormErrors(prev => ({ ...prev, phone: undefined }));
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        if (formData.phone && !isValidPhone(formData.phone)) {
                                                            setFormErrors(prev => ({ ...prev, phone: 'Please enter a valid phone number (10+ digits)' }));
                                                        }
                                                    }}
                                                    className={`w-full bg-[#141414] border rounded-xl px-4 py-4 text-white focus:outline-none transition-colors ${formErrors.phone
                                                        ? 'border-red-500 focus:border-red-500'
                                                        : (currentUser && !isAdmin && !userProfile?.phone)
                                                            ? 'border-yellow-500/50 focus:border-yellow-400'
                                                            : 'border-white/10 focus:border-[#2D9E49]'
                                                        }`}
                                                    placeholder="Enter your phone number"
                                                />
                                                {formErrors.phone && (
                                                    <p className="text-red-500 text-xs mt-1">{formErrors.phone}</p>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Special Requests</label>
                                            <textarea
                                                rows={3}
                                                value={formData.notes}
                                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                                className="w-full bg-[#141414] border border-white/10 rounded-xl px-4 py-4 text-white focus:border-[#2D9E49] focus:outline-none transition-colors resize-none"
                                                placeholder="Any special requests, ages of drivers, games you'd like to play..."
                                            />
                                        </div>

                                        <div className="flex items-start gap-3 p-4 bg-[#2D9E49]/10 border border-[#2D9E49]/30 rounded-xl">
                                            <Info className="w-5 h-5 text-[#2D9E49] flex-shrink-0 mt-0.5" />
                                            <div className="text-sm text-white/80">
                                                <p className="font-bold text-white mb-1">Tip for Groups</p>
                                                For the best experience, we recommend all drivers create a profile before arriving so we can set up their rigs with their preferences.
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-3 sm:justify-between mt-8">
                                        <button
                                            onClick={() => setStep(2)}
                                            className="flex items-center justify-center gap-2 px-6 py-3 sm:py-4 border border-white/20 text-white rounded-full font-bold uppercase tracking-widest hover:bg-white/5 transition-colors order-2 sm:order-1"
                                        >
                                            <ArrowLeft className="w-5 h-5" /> Back
                                        </button>
                                        <button
                                            onClick={() => {
                                                const errors: { email?: string; phone?: string } = {};
                                                if (!isValidEmail(formData.email)) errors.email = 'Please enter a valid email address';
                                                if (!isValidPhone(formData.phone)) errors.phone = 'Please enter a valid phone number (10+ digits)';
                                                if (Object.keys(errors).length > 0) {
                                                    setFormErrors(errors);
                                                    return;
                                                }
                                                setStep(4);
                                            }}
                                            disabled={!formData.name || !formData.email || !formData.phone}
                                            className="flex items-center justify-center gap-3 px-10 py-3 sm:py-4 bg-[#D42428] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#B91C1C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed order-1 sm:order-2"
                                        >
                                            Continue <ArrowRight className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Step 4: Confirm & Pay */}
                            {step === 4 && (
                                <div className="booking-step">
                                    <button onClick={() => setStep(3)} className="flex items-center gap-2 text-white/50 hover:text-white mb-6">
                                        <ArrowLeft className="w-4 h-4" /> Back to details
                                    </button>

                                    <h2 className="font-display text-2xl font-bold uppercase mb-8 text-center">
                                        Confirm Booking
                                    </h2>

                                    <div className="max-w-lg mx-auto">
                                        {/* Booking Summary */}
                                        <div className="bg-[#141414] border border-white/10 rounded-2xl p-6 mb-8">
                                            <h3 className="font-display text-lg font-bold uppercase mb-4 text-[#2D9E49]">Booking Summary</h3>

                                            <div className="space-y-3">
                                                {/* Equipment list */}
                                                <div>
                                                    <span className="text-white/50 text-sm">Equipment</span>
                                                    <div className="mt-1 space-y-1">
                                                        {stationTypes.map((station) => {
                                                            const qty = equipmentCart[station.id] || 0;
                                                            if (qty === 0) return null;
                                                            return (
                                                                <div key={station.id} className="flex justify-between text-sm">
                                                                    <span>{qty}× {station.name}</span>
                                                                    <span className="text-white/60">${station.price * qty}/hr</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-white/50">Date</span>
                                                    <span className="font-medium">{selectedDate && formatDate(selectedDate)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-white/50">Time</span>
                                                    <span className="font-medium">{selectedTime} ({duration} hour{duration > 1 ? 's' : ''})</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-white/50">Total Drivers</span>
                                                    <span className="font-medium">{getTotalDrivers()}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-white/50">Customer</span>
                                                    <span className="font-medium">{formData.name}</span>
                                                </div>
                                                <div className="flex justify-between border-t border-white/10 pt-3 mt-3">
                                                    <span className="font-bold">Total</span>
                                                    <span className="font-bold text-[#2D9E49] text-xl">${calculateTotal()}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Payment Options */}
                                        <div className="mb-8">
                                            <h3 className="font-display text-lg font-bold uppercase mb-4">Payment Option</h3>

                                            <div className="space-y-3">
                                                {/* Use Credits - Only if user has enough */}
                                                {canUseCredits && (
                                                    <button
                                                        onClick={() => setPaymentMethod('credits')}
                                                        className={`w-full p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${paymentMethod === 'credits'
                                                            ? 'border-yellow-500 bg-yellow-500/10'
                                                            : 'border-yellow-500/30 hover:border-yellow-500/50 bg-yellow-500/5'
                                                            }`}
                                                    >
                                                        <Zap className="w-6 h-6 text-yellow-500" />
                                                        <div className="flex-1">
                                                            <div className="font-bold flex items-center gap-2 text-yellow-400">
                                                                Use {getTotalDrivers() * duration} Credit{(getTotalDrivers() * duration) > 1 ? 's' : ''}
                                                                <span className="text-[10px] bg-yellow-500 text-black px-2 py-0.5 rounded-full uppercase font-bold">
                                                                    50% OFF
                                                                </span>
                                                            </div>
                                                            <div className="text-sm text-white/50">
                                                                You have {availableCredits} {equipmentType} credit{availableCredits !== 1 ? 's' : ''} available
                                                            </div>
                                                        </div>
                                                        <div className="text-yellow-400 font-bold">FREE</div>
                                                    </button>
                                                )}

                                                {/* Show credits info if not enough OR mixed cart */}
                                                {equipmentType && availableCredits > 0 && !canUseCredits && (
                                                    <div className="p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 flex items-center gap-4">
                                                        <Zap className="w-6 h-6 text-yellow-500/50" />
                                                        <div className="flex-1">
                                                            <div className="font-bold text-white/50">
                                                                {!isSingleTypeCart ? 'Mixed Equipment' : 'Not enough credits'}
                                                            </div>
                                                            <div className="text-sm text-white/40">
                                                                {!isSingleTypeCart
                                                                    ? 'Credits apply to one equipment type at a time. Please book separately to use credits.'
                                                                    : `You have ${availableCredits} but need ${getTotalDrivers() * duration} credits`
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* BTP Credit Option — only shown for 30-min slots */}
                                                {!isAdmin && btpBalance > 0 && duration === 0.5 && (
                                                    <button
                                                        onClick={() => !btpCooldown.active && setPaymentMethod('btp_credit')}
                                                        disabled={btpCooldown.active}
                                                        className={`w-full p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${paymentMethod === 'btp_credit'
                                                            ? 'border-[#FFD700] bg-[#FFD700]/10'
                                                            : btpCooldown.active
                                                                ? 'border-[#FFD700]/20 opacity-50 cursor-not-allowed'
                                                                : 'border-[#FFD700]/30 hover:border-[#FFD700]/60 bg-[#FFD700]/5'
                                                            }`}
                                                    >
                                                        <Trophy className="w-6 h-6 text-[#FFD700]" />
                                                        <div className="flex-1">
                                                            <div className="font-bold text-[#FFD700] flex items-center gap-2">
                                                                Beat the Pro Credit
                                                                <span className="text-[10px] bg-[#FFD700] text-black px-2 py-0.5 rounded-full uppercase font-bold">BTP</span>
                                                            </div>
                                                            <div className="text-sm text-white/50">
                                                                {btpCooldown.active && btpCooldown.availableAt
                                                                    ? `Cooldown active — available at ${btpCooldown.availableAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                                                    : `${btpBalance} credit${btpBalance !== 1 ? 's' : ''} in wallet · 30-min BTP session`
                                                                }
                                                            </div>
                                                        </div>
                                                        <div className="text-[#FFD700] font-bold">FREE</div>
                                                    </button>
                                                )}

                                                {/* Show BTP hint if user has credits but selected wrong duration */}
                                                {!isAdmin && btpBalance > 0 && duration !== 0.5 && (
                                                    <div className="p-3 rounded-xl border border-[#FFD700]/20 bg-[#FFD700]/5 flex items-center gap-3">
                                                        <Trophy className="w-5 h-5 text-[#FFD700]/50 flex-shrink-0" />
                                                        <p className="text-xs text-white/40">You have {btpBalance} BTP credit{btpBalance !== 1 ? 's' : ''}. Select a 30-min duration to use it.</p>
                                                    </div>
                                                )}

                                                {/* Pay at Venue - Admin Only */}
                                                {isAdmin && (
                                                    <button
                                                        onClick={() => setPaymentMethod('venue')}
                                                        className={`w-full p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${paymentMethod === 'venue'
                                                            ? 'border-[#2D9E49] bg-[#2D9E49]/10'
                                                            : 'border-white/10 hover:border-white/30'
                                                            }`}
                                                    >
                                                        <Wallet className="w-6 h-6 text-[#2D9E49]" />
                                                        <div className="flex-1">
                                                            <div className="font-bold flex items-center gap-2">
                                                                Pay at Venue
                                                                <span className="text-[10px] bg-[#D42428] text-white px-2 py-0.5 rounded-full uppercase">
                                                                    Admin
                                                                </span>
                                                            </div>
                                                            <div className="text-sm text-white/50">Pay ${calculateTotal()} when you arrive</div>
                                                        </div>
                                                    </button>
                                                )}

                                                {/* Deposit Option */}
                                                <button
                                                    onClick={() => setPaymentMethod('deposit')}
                                                    className={`w-full p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${paymentMethod === 'deposit'
                                                        ? 'border-[#D42428] bg-[#D42428]/10'
                                                        : 'border-white/10 hover:border-white/30'
                                                        }`}
                                                >
                                                    <CreditCard className="w-6 h-6 text-[#D42428]" />
                                                    <div className="flex-1">
                                                        <div className="font-bold flex items-center gap-2">
                                                            Pay Deposit
                                                            <span className="text-[10px] bg-[#D42428] text-white px-2 py-0.5 rounded-full uppercase">
                                                                Popular
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-white/50">Pay ${Math.round(calculateTotal() / 2)} now, rest at venue</div>
                                                    </div>
                                                </button>

                                                {/* PayPal */}
                                                <button
                                                    onClick={() => setPaymentMethod('paypal')}
                                                    disabled={!bookingConfig.paypalClientId}
                                                    className={`w-full p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${paymentMethod === 'paypal'
                                                        ? 'bg-[#003087]/10 border-[#003087]'
                                                        : !bookingConfig.paypalClientId
                                                            ? 'border-white/10 opacity-50 cursor-not-allowed'
                                                            : 'border-white/10 hover:border-[#003087]/50'
                                                        }`}
                                                >
                                                    <div className="w-6 h-6 flex items-center justify-center">
                                                        <span className="font-bold text-[#003087] text-lg italic">P</span>
                                                    </div>
                                                    <div>
                                                        <div className="font-bold flex items-center gap-2">
                                                            PayPal
                                                            {!bookingConfig.paypalClientId && (
                                                                <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full uppercase">
                                                                    Not Configured
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-white/50">Pay securely with PayPal</div>
                                                    </div>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Submit or PayPal */}
                                        {paymentMethod === 'paypal' ? (
                                            <div className="mt-8">
                                                <PayPalCheckout
                                                    amount={calculateTotal()}
                                                    onSuccess={handlePayPalSuccess}
                                                    onError={(err) => setError('PayPal Error: ' + err)}
                                                />
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={handleSubmit}
                                                    disabled={isSubmitting}
                                                    className="w-full py-4 bg-[#D42428] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#B91C1C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    {isSubmitting ? (
                                                        <>
                                                            <Loader2 className="w-5 h-5 animate-spin" />
                                                            Processing...
                                                        </>
                                                    ) : (
                                                        <>
                                                            {paymentMethod === 'deposit'
                                                                ? `Pay Deposit ($${Math.round(calculateTotal() / 2)})`
                                                                : 'Confirm Booking'} <ArrowRight className="w-5 h-5" />
                                                        </>
                                                    )}
                                                </button>

                                                {/* Payment Selection Modal */}
                                                {showPaymentModal && (
                                                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                                                        <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-md p-6 relative">
                                                            <button
                                                                onClick={() => setShowPaymentModal(false)}
                                                                className="absolute top-4 right-4 text-white/50 hover:text-white"
                                                            >
                                                                ✕
                                                            </button>

                                                            <h3 className="font-display text-xl font-bold uppercase mb-6 text-center">
                                                                Choose Payment Method
                                                            </h3>

                                                            <div className="space-y-4">
                                                                {/* Option A: Stripe */}
                                                                {/* Stripe Payment Option */}
                                                                <button
                                                                    onClick={handleStripeDeposit}
                                                                    disabled={loadingStripe}
                                                                    className="w-full p-4 bg-[#635BFF] text-white rounded-xl font-bold hover:bg-[#5851E3] transition-colors flex items-center justify-center gap-3"
                                                                >
                                                                    {loadingStripe ? <Loader2 className="animate-spin" /> : <CreditCard />}
                                                                    Pay with Card / G-Pay
                                                                </button>

                                                                <div className="text-center text-xs text-white/30 uppercase tracking-widest">
                                                                    - or -
                                                                </div>

                                                                {/* Option B: PayPal */}
                                                                <div className="relative z-0">
                                                                    <PayPalCheckout
                                                                        amount={Math.round(calculateTotal() / 2)}
                                                                        onSuccess={(details) => {
                                                                            setShowPaymentModal(false);
                                                                            handlePayPalSuccess(details);
                                                                        }}
                                                                        onError={(err) => setError('PayPal Error: ' + err)}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="mt-6 text-center">
                                                    <div className="text-white/40 text-xs leading-relaxed max-w-md mx-auto">
                                                        <p className="font-bold text-white/60 mb-1 pointer-events-none">Cancellation Policy</p>
                                                        <ul className="space-y-1">
                                                            <li>• No refunds for cancellations within 48 hours of booking.</li>
                                                            <li>• 50% account credit for cancellations less than 1 week in advance.</li>
                                                            <li>• Full refund for cancellations more than 1 week in advance.</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </section >

            {/* Quick Contact */}
            < section className="py-12 px-6 md:px-12 bg-[#141414]" >
                <div className="max-w-4xl mx-auto text-center">
                    <p className="text-white/50 mb-4">Need help or have questions?</p>
                    <a
                        href={`mailto:${siteConfig.email}`}
                        className="inline-flex items-center gap-3 text-[#2D9E49] hover:underline font-bold"
                    >
                        <Mail className="w-5 h-5" /> {siteConfig.email}
                    </a>
                </div>
            </section >
        </div >
    );
};

export default BookingPage;

