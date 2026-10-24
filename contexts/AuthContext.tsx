
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
    User,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import { auth, db, googleProvider } from '../config/firebase';
import { UserCredits, BonusCredits, UserMembership, UserMembershipsMap, DEFAULT_CREDITS, DEFAULT_BONUS_CREDITS, DEFAULT_MEMBERSHIPS } from '../config/membership';
import { bookingConfig } from '../config/booking';

// Types
interface UserProfile {
    uid: string;
    email: string;
    name: string;
    phone?: string;
    photoURL?: string; // Parent profile photo URL
    role?: 'admin' | 'user';
    waiverAccepted: boolean;
    rulesAccepted: boolean;
    waiverAcceptedAt?: Date;
    createdAt?: Date;
    // Driver Details
    favDiscipline?: string;
    favTrack?: string;
    favCar?: string;
    favRig?: string;
    settings?: string;
    // Junior Drivers (for parents to add minors to their account)
    juniorDrivers?: Array<{
        name: string;
        photoURL?: string; // Junior driver photo URL
    }>;
    juniorPromptDismissed?: boolean; // dashboard "Racing with kids?" prompt answered
    // Credits and Membership
    credits: UserCredits;
    bonusCredits: BonusCredits;
    memberships: UserMembershipsMap;
    // Beat the Pro Credits
    btpCredits?: number;
    lastBtpUsedAt?: Date | null;
    // Fastest Lap
    isPro?: boolean;
    competitionWins?: { daily: number; weekly: number; monthly: number; total: number };
}

interface AuthContextType {
    currentUser: User | null;
    userProfile: UserProfile | null;
    loading: boolean;
    isAdmin: boolean;
    signUp: (
        email: string,
        password: string,
        name: string,
        phone: string,
        driverDetails?: {
            favDiscipline?: string;
            favTrack?: string;
            favCar?: string;
            favRig?: string;
            settings?: string;
        }
    ) => Promise<User>;
    login: (email: string, password: string) => Promise<void>;
    loginWithGoogle: () => Promise<{ isNewUser: boolean, user: User }>;
    updateProfile: (data: Partial<UserProfile>) => Promise<void>;
    logout: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    // Credits functions
    useCredits: (equipmentType: 'kart' | 'rig' | 'motion' | 'btp', amount: number) => Promise<boolean>;
    addCredits: (equipmentType: 'kart' | 'rig' | 'motion' | 'btp', amount: number, target?: 'membership' | 'bonus') => Promise<void>;
    getCredits: (equipmentType: 'kart' | 'rig' | 'motion' | 'btp') => number;
    hasEnoughCredits: (equipmentType: 'kart' | 'rig' | 'motion' | 'btp', amount: number) => boolean;
    // BTP Credits
    getBtpCredits: () => number;
    hasBtpCooldown: () => { active: boolean; availableAt?: Date };
    useBtpCredit: () => Promise<boolean>;
    addBtpCredit: (amount?: number) => Promise<void>;
    refreshUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    // Check if current user is admin - via Firestore role OR predefined admin email
    const isAdmin = userProfile?.role === 'admin' ||
        (currentUser?.email && bookingConfig.adminEmails?.includes(currentUser.email)) ||
        false;

    // Create user profile in Firestore - Returns true if new user created
    const createUserProfile = async (
        user: User,
        additionalData: {
            name: string;
            phone?: string;
        }
    ): Promise<boolean> => {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            const profileData = {
                uid: user.uid,
                email: user.email || '',
                name: additionalData.name || user.displayName || '',
                phone: additionalData.phone || '',
                waiverAccepted: false, // Will be set in Onboarding
                rulesAccepted: false,  // Will be set in Onboarding
                createdAt: serverTimestamp(),
                // Initialize with empty credits and no membership
                credits: DEFAULT_CREDITS,
                bonusCredits: DEFAULT_BONUS_CREDITS,
                memberships: DEFAULT_MEMBERSHIPS,
            };

            await setDoc(userRef, profileData);
            return true; // New user created
        }
        return false; // User already existed
    };

    // Fetch user profile from Firestore
    const fetchUserProfile = async (uid: string) => {
        const userRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            // Ensure credits and membership fields exist (for existing users)
            const profile: UserProfile = {
                ...data,
                credits: data.credits || DEFAULT_CREDITS,
                bonusCredits: data.bonusCredits || DEFAULT_BONUS_CREDITS,
                memberships: data.memberships || DEFAULT_MEMBERSHIPS,
            } as UserProfile;
            setUserProfile(profile);
        }
    };

    // Refresh user profile (useful after actions like using credits)
    const refreshUserProfile = async () => {
        if (currentUser) {
            await fetchUserProfile(currentUser.uid);
        }
    };

    // Get credits for a specific equipment type (combines membership + non-expired bonus)
    const getCredits = (equipmentType: 'kart' | 'rig' | 'motion' | 'btp'): number => {
        if (equipmentType === 'btp') return getBtpCredits();
        const membershipCredits = userProfile?.credits?.[equipmentType] || 0;
        const bonusAmount = userProfile?.bonusCredits?.[equipmentType] || 0;
        const expiryKey = `${equipmentType}ExpiresAt` as keyof BonusCredits;
        const expiresAt = userProfile?.bonusCredits?.[expiryKey];

        // Check if bonus credits have expired
        let validBonus = 0;
        if (bonusAmount > 0 && expiresAt) {
            const expiryDate = expiresAt instanceof Date ? expiresAt : (expiresAt as any)?.toDate?.() || new Date(expiresAt as any);
            if (expiryDate > new Date()) {
                validBonus = bonusAmount;
            }
        }

        return membershipCredits + validBonus;
    };

    // Check if user has enough credits
    const hasEnoughCredits = (equipmentType: 'kart' | 'rig' | 'motion' | 'btp', amount: number): boolean => {
        return getCredits(equipmentType) >= amount;
    };

    // Helper: get valid (non-expired) bonus credits for a type
    const getValidBonusCredits = (equipmentType: 'kart' | 'rig' | 'motion' | 'btp'): number => {
        const bonusAmount = userProfile?.bonusCredits?.[equipmentType] || 0;
        if (bonusAmount <= 0) return 0;
        const expiryKey = `${equipmentType}ExpiresAt` as keyof BonusCredits;
        const expiresAt = userProfile?.bonusCredits?.[expiryKey];
        if (!expiresAt) return 0;
        const expiryDate = expiresAt instanceof Date ? expiresAt : (expiresAt as any)?.toDate?.() || new Date(expiresAt as any);
        return expiryDate > new Date() ? bonusAmount : 0;
    };

    // Use credits for a booking (deducts from bonus first, then membership)
    const useCredits = async (equipmentType: 'kart' | 'rig' | 'motion' | 'btp', amount: number): Promise<boolean> => {
        if (!currentUser || !userProfile) return false;

        const totalAvailable = getCredits(equipmentType);
        if (totalAvailable < amount) return false;

        if (equipmentType === 'btp') {
            // For BTP, use the dedicated function or simple increment
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, {
                btpCredits: increment(-amount),
                lastBtpUsedAt: new Date()
            });
            await refreshUserProfile();
            return true;
        }

        const validBonus = getValidBonusCredits(equipmentType);
        const membershipCredits = userProfile?.credits?.[equipmentType] || 0;

        // FIFO: deduct from bonus first (they expire sooner), then membership
        const fromBonus = Math.min(validBonus, amount);
        const fromMembership = amount - fromBonus;

        const userRef = doc(db, 'users', currentUser.uid);

        // Single atomic updateDoc call — both fields update or neither does
        const updates: Record<string, any> = {};
        if (fromBonus > 0) {
            updates[`bonusCredits.${equipmentType}`] = increment(-fromBonus);
        }
        if (fromMembership > 0) {
            updates[`credits.${equipmentType}`] = increment(-fromMembership);
        }

        await updateDoc(userRef, updates);
        await refreshUserProfile();

        return true;
    };

    // Add credits (called by cancel refunds or webhook)
    // target: 'membership' = monthly credits (set by webhook), 'bonus' = refund credits (with 30-day expiry)
    const addCredits = async (equipmentType: 'kart' | 'rig' | 'motion' | 'btp', amount: number, target: 'membership' | 'bonus' = 'bonus'): Promise<void> => {
        if (!currentUser) throw new Error('Not authenticated');

        const userRef = doc(db, 'users', currentUser.uid);

        if (equipmentType === 'btp') {
            await updateDoc(userRef, {
                btpCredits: increment(amount)
            });
            await refreshUserProfile();
            return;
        }

        if (target === 'bonus') {
            // Refund / promo credits → add to bonusCredits with 30-day expiry
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);

            await updateDoc(userRef, {
                [`bonusCredits.${equipmentType}`]: increment(amount),
                [`bonusCredits.${equipmentType}ExpiresAt`]: expiresAt
            });
        } else {
            // Membership credits → atomic increment
            await updateDoc(userRef, {
                [`credits.${equipmentType}`]: increment(amount)
            });
        }

        await refreshUserProfile();
    };

    // ── BTP Credit Helpers ─────────────────────────────────────────────────
    const BTP_COOLDOWN_HOURS = 15;

    const getBtpCredits = (): number => {
        return userProfile?.btpCredits || 0;
    };

    const hasBtpCooldown = (): { active: boolean; availableAt?: Date } => {
        const raw = userProfile?.lastBtpUsedAt;
        if (!raw) return { active: false };
        const lastUsed = raw instanceof Date ? raw : (raw as any)?.toDate?.() || new Date(raw as any);
        const availableAt = new Date(lastUsed.getTime() + BTP_COOLDOWN_HOURS * 60 * 60 * 1000);
        if (new Date() < availableAt) return { active: true, availableAt };
        return { active: false };
    };

    const useBtpCredit = async (): Promise<boolean> => {
        if (!currentUser || !userProfile) return false;
        if (getBtpCredits() <= 0) return false;
        const cooldown = hasBtpCooldown();
        if (cooldown.active) return false;

        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
            btpCredits: increment(-1),
            lastBtpUsedAt: new Date()
        });
        await refreshUserProfile();
        return true;
    };

    const addBtpCredit = async (amount: number = 1): Promise<void> => {
        if (!currentUser) throw new Error('Not authenticated');
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
            btpCredits: increment(amount)
        });
        await refreshUserProfile();
    };

    // Sign up with email/password
    const signUp = async (
        email: string,
        password: string,
        name: string,
        phone: string,
        driverDetails?: {
            favDiscipline?: string;
            favTrack?: string;
            favCar?: string;
            favRig?: string;
            settings?: string;
        }
    ) => {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        // For email signup, we might still want to capture details inline or redirect. 
        // For consistency, let's keep the details here IF passed, but normally we'd redirect too.
        // Actually, let's keep email signup as is (all in one), but Google as two-step.

        const userRef = doc(db, 'users', user.uid);
        const profileData = {
            uid: user.uid,
            email: user.email || '',
            name: name,
            phone: phone,
            ...driverDetails,
            waiverAccepted: true, // Email form has checkbox
            rulesAccepted: true,  // Email form has checkbox
            waiverAcceptedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            credits: DEFAULT_CREDITS,
            bonusCredits: DEFAULT_BONUS_CREDITS,
            memberships: DEFAULT_MEMBERSHIPS,
        };
        await setDoc(userRef, profileData);

        await fetchUserProfile(user.uid);
        return user;
    };

    // Login with email/password
    const login = async (email: string, password: string) => {
        await signInWithEmailAndPassword(auth, email, password);
    };

    // Login with Google - Returns isNewUser
    const loginWithGoogle = async (): Promise<{ isNewUser: boolean, user: User }> => {
        const { user } = await signInWithPopup(auth, googleProvider);
        const isNewUser = await createUserProfile(user, { name: user.displayName || '' });
        await fetchUserProfile(user.uid);
        return { isNewUser, user };
    };

    // Update profile
    const updateProfile = async (data: Partial<UserProfile>) => {
        if (!currentUser) return;
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, data);
        await refreshUserProfile();
    };

    // Logout
    const logout = async () => {
        await signOut(auth);
        setUserProfile(null);
    };

    // Reset password
    const resetPassword = async (email: string) => {
        await sendPasswordResetEmail(auth, email);
    };

    // Listen for auth state changes
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            if (user) {
                await fetchUserProfile(user.uid);
            } else {
                setUserProfile(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const value: AuthContextType = {
        currentUser,
        userProfile,
        loading,
        isAdmin,
        signUp,
        login,
        loginWithGoogle,
        updateProfile,
        logout,
        resetPassword,
        // Credits functions
        useCredits,
        addCredits,
        getCredits,
        hasEnoughCredits,
        // BTP Credits
        getBtpCredits,
        hasBtpCooldown,
        useBtpCredit,
        addBtpCredit,
        refreshUserProfile,
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
