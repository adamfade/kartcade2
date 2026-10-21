import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Mail, Lock, User, Phone, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const SignUpPage: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const partyId = searchParams.get('party'); // Detect /signup?party=ABC123
    const { signUp, loginWithGoogle, currentUser, userProfile } = useAuth();

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
        favDiscipline: '',
        favTrack: '',
        favCar: '',
        favRig: '',
        settings: '',
    });
    const [acceptRules, setAcceptRules] = useState(false);
    const [acceptWaiver, setAcceptWaiver] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [modalAcceptRules, setModalAcceptRules] = useState(false);
    const [modalAcceptWaiver, setModalAcceptWaiver] = useState(false);

    // Auto-join for already logged-in users
    React.useEffect(() => {
        if (currentUser && partyId) {
            console.log("[SIGNUP] Existing user detected with party ID, auto-joining...");
            handlePartyGuestRegistration(partyId, currentUser.uid, userProfile?.name || currentUser.displayName || '', currentUser.email || '')
                .then((result) => {
                    if (result.success) {
                        navigate('/dashboard', { state: { message: result.alreadyRegistered ? 'Welcome back! You are already in this party.' : 'You have successfully joined the party!' } });
                    } else {
                        setError(result.error || 'Failed to join party.');
                    }
                });
        }
    }, [currentUser, partyId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Validation
        if (!acceptRules || !acceptWaiver) {
            setError('You must accept the Rules and Waiver to create an account.');
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        if (formData.password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        try {
            setLoading(true);
            const user = await signUp(
                formData.email,
                formData.password,
                formData.name,
                formData.phone,
                {
                    favDiscipline: formData.favDiscipline,
                    favTrack: formData.favTrack,
                    favCar: formData.favCar,
                    favRig: formData.favRig,
                    settings: formData.settings
                }
            );

            // Handle Party Guest Registration
            if (partyId && user) {
                const regResult = await handlePartyGuestRegistration(partyId, user.uid, formData.name, formData.email);
                if (!regResult.success) {
                    // If party join fails but signup succeeded, we go to dashboard but show the error
                    navigate('/dashboard', { state: { error: `Signup successful, but: ${regResult.error}` } });
                    return;
                }
            }

            // Email sign up collects data inline, so go straight to dashboard
            navigate('/dashboard', { state: { message: partyId ? 'Welcome to the party!' : 'Profile created successfully!' } });
        } catch (err: any) {
            if (err.code === 'auth/email-already-in-use') {
                setError('An account with this email already exists.');
            } else if (err.code === 'auth/invalid-email') {
                setError('Please enter a valid email address.');
            } else {
                setError('Failed to create account. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleClick = () => {
        // Open modal to accept rules/waiver
        setShowModal(true);
        setModalAcceptRules(false);
        setModalAcceptWaiver(false);
    };

    const handleModalContinue = async () => {
        if (!modalAcceptRules || !modalAcceptWaiver) {
            return;
        }

        try {
            setLoading(true);
            setShowModal(false);
            const { isNewUser, user } = await loginWithGoogle();

            if (partyId && user) {
                const regResult = await handlePartyGuestRegistration(partyId, user.uid, user.displayName || '', user.email || '');
                if (!regResult.success) {
                    navigate('/dashboard', { state: { error: `Login successful, but: ${regResult.error}` } });
                    return;
                }
            }

            if (isNewUser) {
                navigate('/onboarding', { state: { message: partyId ? 'Welcome to the party!' : '' } });
            } else {
                navigate('/dashboard', { state: { message: partyId ? 'Joined the party!' : '' } });
            }
        } catch (err: any) {
            setError('Failed to sign in with Google. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Helper: Register guest for a party
    const handlePartyGuestRegistration = async (pid: string, uid: string, name?: string, email?: string) => {
        try {
            const { doc, runTransaction, arrayUnion } = await import('firebase/firestore');
            const { db } = await import('../config/firebase');

            const partyRef = doc(db, 'parties', pid);
            const userRef = doc(db, 'users', uid);

            await runTransaction(db, async (transaction) => {
                const partySnap = await transaction.get(partyRef);
                if (!partySnap.exists()) {
                    throw new Error('Party session not found.');
                }

                const partyData = partySnap.data();

                // 2. Check if party is full
                const currentGuestCount = partyData.registeredGuests?.length || 0;
                const maxGuests = partyData.maxGuests || 40;
                if (currentGuestCount >= maxGuests) {
                    throw new Error('This party has reached its maximum guest capacity.');
                }

                // 3. Check if guest is already registered
                const isAlreadyRegistered = partyData.registeredGuests?.some((g: any) => g.uid === uid || (email && g.email === email));
                if (isAlreadyRegistered) {
                    console.log('User already registered for this party, skipping linking.');
                    throw { alreadyRegistered: true }; // Use throw to exit transaction and pass data back
                }

                const guestObj = {
                    uid,
                    name: name || 'Unknown Guest',
                    email: email || '',
                    registeredAt: new Date().toISOString()
                };

                // 4. Atomic Updates
                transaction.update(partyRef, {
                    registeredGuests: arrayUnion(guestObj),
                    updatedAt: new Date()
                });
                transaction.update(userRef, {
                    'partyInfo.attendingParties': arrayUnion(pid)
                });
            });

            console.log(`Successfully registered guest ${uid} for party ${pid}`);
            return { success: true };
        } catch (err: any) {
            if (err.alreadyRegistered) {
                return { success: true, alreadyRegistered: true };
            }
            console.error('Failed to link party guest:', err);
            return { success: false, error: err.message };
        }
    };

    const handleAcceptAll = () => {
        setModalAcceptRules(true);
        setModalAcceptWaiver(true);
    };

    return (
        <div className="relative bg-[#0A0A0A] min-h-screen pt-20 md:pt-24 pb-12">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden opacity-10">
                <div className="absolute top-0 left-1/4 w-32 h-full bg-gradient-to-b from-[#2D9E49] to-transparent transform -skew-x-12"></div>
                <div className="absolute top-0 left-1/3 w-16 h-full bg-gradient-to-b from-white to-transparent transform -skew-x-12"></div>
                <div className="absolute top-0 left-[40%] w-32 h-full bg-gradient-to-b from-[#D42428] to-transparent transform -skew-x-12"></div>
            </div>

            {/* Modal Overlay */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/10 max-w-md w-full relative animate-in fade-in zoom-in duration-200">
                        {/* Close Button */}
                        <button
                            onClick={() => setShowModal(false)}
                            className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
                        >
                            <X className="w-6 h-6" />
                        </button>

                        {/* Modal Header */}
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-[#2D9E49]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-8 h-8 text-[#2D9E49]" />
                            </div>
                            <h2 className="font-display text-xl md:text-2xl font-bold uppercase text-white mb-2">
                                Accept Terms
                            </h2>
                            <p className="text-white/60 text-sm">
                                Please review and accept our rules and waiver before continuing
                            </p>
                        </div>

                        {/* Accept All Button */}
                        <button
                            onClick={handleAcceptAll}
                            className="w-full py-3 mb-6 bg-[#2D9E49]/20 border border-[#2D9E49]/30 text-[#2D9E49] rounded-lg font-display uppercase tracking-widest font-bold text-xs hover:bg-[#2D9E49]/30 transition-colors"
                        >
                            Accept All
                        </button>

                        {/* Checkboxes */}
                        <div className="space-y-4 mb-6">
                            {/* Rules Checkbox */}
                            <label className="flex items-start gap-3 cursor-pointer group p-3 bg-black/20 rounded-lg hover:bg-black/30 transition-colors">
                                <div className="relative mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={modalAcceptRules}
                                        onChange={(e) => setModalAcceptRules(e.target.checked)}
                                        className="sr-only"
                                    />
                                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${modalAcceptRules
                                        ? 'bg-[#2D9E49] border-[#2D9E49]'
                                        : 'border-white/30 group-hover:border-white/50'
                                        }`}>
                                        {modalAcceptRules && <CheckCircle className="w-4 h-4 text-white" />}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-white font-medium">Rules & Guidelines</span>
                                    <p className="text-white/50 text-xs mt-1">
                                        I have read and agree to the{' '}
                                        <Link to="/rules" target="_blank" className="text-[#2D9E49] hover:underline">
                                            Kartcade Rules
                                        </Link>
                                    </p>
                                </div>
                            </label>

                            {/* Waiver Checkbox */}
                            <label className="flex items-start gap-3 cursor-pointer group p-3 bg-black/20 rounded-lg hover:bg-black/30 transition-colors">
                                <div className="relative mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={modalAcceptWaiver}
                                        onChange={(e) => setModalAcceptWaiver(e.target.checked)}
                                        className="sr-only"
                                    />
                                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${modalAcceptWaiver
                                        ? 'bg-[#2D9E49] border-[#2D9E49]'
                                        : 'border-white/30 group-hover:border-white/50'
                                        }`}>
                                        {modalAcceptWaiver && <CheckCircle className="w-4 h-4 text-white" />}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-white font-medium">Waiver of Liability</span>
                                    <p className="text-white/50 text-xs mt-1">
                                        I have read and agree to the{' '}
                                        <Link to="/waiver" target="_blank" className="text-[#2D9E49] hover:underline">
                                            Waiver of Liability
                                        </Link>
                                    </p>
                                </div>
                            </label>
                        </div>

                        {/* Continue Button */}
                        <button
                            onClick={handleModalContinue}
                            disabled={!modalAcceptRules || !modalAcceptWaiver || loading}
                            className="w-full py-4 bg-white text-[#0A0A0A] rounded-full font-display uppercase tracking-widest font-bold text-sm flex items-center justify-center gap-3 hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                'Signing In...'
                            ) : (
                                <>
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                    Continue with Google
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            <div className="container mx-auto px-4 md:px-6 lg:px-12 relative z-10">
                <div className="max-w-md mx-auto">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <span className="font-mono text-[#2D9E49] tracking-widest uppercase text-xs md:text-sm mb-4 block">
                            Join Kartcade
                        </span>
                        <h1 className="font-display text-3xl md:text-4xl font-bold uppercase text-white mb-2">
                            Create Your<br />
                            <span className="text-[#D42428]">Driver Profile</span>
                        </h1>
                        {partyId && (
                            <div className="mb-6 p-4 bg-[#2D9E49]/10 border border-[#2D9E49]/30 rounded-lg flex items-center gap-3 animate-pulse">
                                <CheckCircle className="w-5 h-5 text-[#2D9E49]" />
                                <p className="text-[#2D9E49] text-xs font-bold uppercase tracking-widest">Registering for Party Invite</p>
                            </div>
                        )}

                        <p className="text-white/60 font-sans text-sm">
                            Sign up to book sessions and join the racing community
                        </p>
                    </div>

                    {/* Form Card */}
                    <div className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/10">
                        {/* Error Message */}
                        {error && (
                            <div className="mb-6 p-4 bg-[#D42428]/10 border border-[#D42428]/30 rounded-lg flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-[#D42428] flex-shrink-0 mt-0.5" />
                                <p className="text-[#D42428] text-sm">{error}</p>
                            </div>
                        )}

                        {/* Google Sign In */}
                        <button
                            type="button"
                            onClick={handleGoogleClick}
                            disabled={loading}
                            className="w-full py-4 px-6 bg-white text-[#0A0A0A] rounded-full font-display uppercase tracking-widest font-bold text-sm flex items-center justify-center gap-3 hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Continue with Google
                        </button>

                        {/* Divider */}
                        <div className="flex items-center gap-4 mb-6">
                            <div className="flex-1 h-px bg-white/10"></div>
                            <span className="text-white/40 text-xs uppercase tracking-widest">or</span>
                            <div className="flex-1 h-px bg-white/10"></div>
                        </div>

                        {/* Email Form */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Name */}
                            <div>
                                <label className="block text-white/60 text-sm mb-2">Full Name</label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                    <input
                                        type="text"
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        required
                                        className="w-full pl-12 pr-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                        placeholder="John Doe"
                                    />
                                </div>
                            </div>

                            {/* Email */}
                            <div>
                                <label className="block text-white/60 text-sm mb-2">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                    <input
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        required
                                        className="w-full pl-12 pr-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                        placeholder="you@email.com"
                                    />
                                </div>
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="block text-white/60 text-sm mb-2">Phone (Optional)</label>
                                <div className="relative">
                                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleChange}
                                        className="w-full pl-12 pr-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                        placeholder="+1 (555) 123-4567"
                                    />
                                </div>
                            </div>

                            {/* Driver Details Section */}
                            <div className="pt-4 pb-2">
                                <h3 className="text-white font-display text-lg uppercase mb-4 flex items-center gap-2">
                                    <span className="w-1 h-6 bg-[#2D9E49]"></span>
                                    Driver Details
                                    <span className="text-xs font-sans text-white/40 normal-case ml-2">(Help us set up your rig!)</span>
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Fav Discipline */}
                                    <div>
                                        <label className="block text-white/60 text-sm mb-2">Favorite Discipline</label>
                                        <input
                                            type="text"
                                            name="favDiscipline"
                                            value={formData.favDiscipline}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                            placeholder="e.g. Formula, GT3, Rally..."
                                        />
                                    </div>

                                    {/* Fav Track */}
                                    <div>
                                        <label className="block text-white/60 text-sm mb-2">Favorite Track</label>
                                        <input
                                            type="text"
                                            name="favTrack"
                                            value={formData.favTrack}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                            placeholder="e.g. Spa, Nordschleife..."
                                        />
                                    </div>

                                    {/* Fav Car */}
                                    <div>
                                        <label className="block text-white/60 text-sm mb-2">Favorite Car</label>
                                        <input
                                            type="text"
                                            name="favCar"
                                            value={formData.favCar}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                            placeholder="e.g. Porsche 911 GT3..."
                                        />
                                    </div>

                                    {/* Fav Rig */}
                                    <div>
                                        <label className="block text-white/60 text-sm mb-2">Preferred Rig</label>
                                        <input
                                            type="text"
                                            name="favRig"
                                            value={formData.favRig}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                            placeholder="e.g. Motion, Static..."
                                        />
                                    </div>
                                </div>

                                {/* Settings Note */}
                                <div className="mt-4">
                                    <label className="block text-white/60 text-sm mb-2">Force Feedback / Settings Notes</label>
                                    <input
                                        type="text"
                                        name="settings"
                                        value={formData.settings}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                        placeholder="e.g. Strong FFB, Left Foot Braking..."
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label className="block text-white/60 text-sm mb-2">Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        name="password"
                                        value={formData.password}
                                        onChange={handleChange}
                                        required
                                        className="w-full pl-12 pr-12 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                                    >
                                        {showPassword ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                            </div>

                            {/* Confirm Password */}
                            <div>
                                <label className="block text-white/60 text-sm mb-2">Confirm Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        name="confirmPassword"
                                        value={formData.confirmPassword}
                                        onChange={handleChange}
                                        required
                                        className="w-full pl-12 pr-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>

                            {/* Rules Checkbox */}
                            <div className="pt-4">
                                <label className="flex items-start gap-3 cursor-pointer group">
                                    <div className="relative mt-0.5">
                                        <input
                                            type="checkbox"
                                            checked={acceptRules}
                                            onChange={(e) => setAcceptRules(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${acceptRules
                                            ? 'bg-[#2D9E49] border-[#2D9E49]'
                                            : 'border-white/30 group-hover:border-white/50'
                                            }`}>
                                            {acceptRules && <CheckCircle className="w-3 h-3 text-white" />}
                                        </div>
                                    </div>
                                    <span className="text-white/70 text-sm">
                                        I have read and agree to the{' '}
                                        <Link to="/rules" target="_blank" className="text-[#2D9E49] hover:underline">
                                            Rules & Guidelines
                                        </Link>
                                    </span>
                                </label>
                            </div>

                            {/* Waiver Checkbox */}
                            <div>
                                <label className="flex items-start gap-3 cursor-pointer group">
                                    <div className="relative mt-0.5">
                                        <input
                                            type="checkbox"
                                            checked={acceptWaiver}
                                            onChange={(e) => setAcceptWaiver(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${acceptWaiver
                                            ? 'bg-[#2D9E49] border-[#2D9E49]'
                                            : 'border-white/30 group-hover:border-white/50'
                                            }`}>
                                            {acceptWaiver && <CheckCircle className="w-3 h-3 text-white" />}
                                        </div>
                                    </div>
                                    <span className="text-white/70 text-sm">
                                        I have read and agree to the{' '}
                                        <Link to="/waiver" target="_blank" className="text-[#2D9E49] hover:underline">
                                            Waiver of Liability
                                        </Link>
                                    </span>
                                </label>
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full mt-6 py-4 bg-[#D42428] text-white rounded-full font-display uppercase tracking-widest font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#b91f22] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Creating Account...' : (
                                    <>
                                        Create Driver Profile
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Login Link */}
                        <p className="text-center text-white/60 text-sm mt-6">
                            Already have an account?{' '}
                            <Link to="/login" className="text-[#2D9E49] hover:underline">
                                Sign In
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SignUpPage;
