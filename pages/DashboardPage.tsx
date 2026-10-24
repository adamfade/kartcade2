import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import PayPalCheckout from '../components/PayPalCheckout';
import { User, CreditCard, Calendar, Clock, LogOut, ArrowRight, Zap, X, AlertCircle, Gauge, Monitor, Rocket, Edit2, Save, DollarSign, Camera, Trash2, Users, RefreshCw, Database, Download, CheckCircle, XCircle, ChevronDown, ChevronUp, Trophy, Medal, Award } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bookingApi } from '../config/booking';
import { getMembershipById } from '../config/membership';
import { getPaymentStatus, formatCurrency } from '../utils/paymentStatus';
import { uploadProfilePhoto, deleteProfilePhoto, validatePhotoFile } from '../utils/profilePhoto';
import CustomersTable from '../components/admin/CustomersTable';
import { JuniorDriversPrompt, JuniorDriversCard } from '../components/JuniorDrivers';
import { crmService, CustomerAnalytics } from '../services/crm';
import { exportCustomersToCSV } from '../utils/csvExport';
import { db } from '../config/firebase';
import { NORMALIZED_GAMES, NORMALIZED_TRACKS, NORMALIZED_CARS } from '../config/leaderboard';
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    serverTimestamp,
    onSnapshot,
    orderBy,
    doc,
    getDoc,
    updateDoc,
    deleteField,
    documentId
} from 'firebase/firestore';

interface Booking {
    id: string;
    date: string;
    time: string;
    station: string;
    drivers: number;
    name: string;
    email: string;
    phone?: string;
    paymentMethod?: string;
    status: string;
}

const DashboardPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser, userProfile, logout, isAdmin, getCredits, updateProfile, refreshUserProfile, getBtpCredits, hasBtpCooldown, addBtpCredit } = useAuth();

    const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
    const [loadingBookings, setLoadingBookings] = useState(true);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const location = useLocation();
    const [successMessage, setSuccessMessage] = useState<string | null>(location.state?.message || null);
    const [error, setError] = useState<string | null>(location.state?.error || '');
    // BTP purchase modal
    const [showBtpModal, setShowBtpModal] = useState(false);
    const [btpPurchasing, setBtpPurchasing] = useState(false);
    const [btpSuccess, setBtpSuccess] = useState(false);

    // Clear navigation state to prevent repeated alerts
    useEffect(() => {
        if (location.state?.message || location.state?.error) {
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    // Lock body scroll when BTP modal is open to prevent background scrolling
    useEffect(() => {
        if (showBtpModal) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [showBtpModal]);

    // Edit Profile State
    const [showEditModal, setShowEditModal] = useState(false);
    const [editFormData, setEditFormData] = useState({
        favDiscipline: '',
        favTrack: '',
        favCar: '',
        favRig: '',
        settings: '',
        phone: '', // Add phone field
    });
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    // Junior Drivers State
    const [juniorDrivers, setJuniorDrivers] = useState<Array<{ name: string; photoURL?: string }>>([]);
    const [newJuniorName, setNewJuniorName] = useState('');

    // Photo Upload State
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [uploadingJuniorIndex, setUploadingJuniorIndex] = useState<number | null>(null);
    const parentPhotoInputRef = React.useRef<HTMLInputElement>(null);

    // ADMIN: Dashboard state for ALL bookings
    const [adminTodayBookings, setAdminTodayBookings] = useState<Booking[]>([]);
    const [adminUpcomingBookings, setAdminUpcomingBookings] = useState<Booking[]>([]);
    const [adminPastBookings, setAdminPastBookings] = useState<Booking[]>([]);
    const [adminStats, setAdminStats] = useState({ todayCount: 0, upcomingCount: 0, pastCount: 0 });

    // UI State for Photo Preview (Optimistic Updates)
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);

    // Sync photoPreview with userProfile when it changes (initial load or background refresh)
    useEffect(() => {
        setPhotoPreview(userProfile?.photoURL || null);
    }, [userProfile?.photoURL]);
    const [adminLoading, setAdminLoading] = useState(false);
    const [adminTab, setAdminTab] = useState<'today' | 'upcoming' | 'past'>('today');
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    // CRM State
    const [adminView, setAdminView] = useState<'bookings' | 'customers' | 'parties'>('bookings');
    const [crmCustomers, setCrmCustomers] = useState<CustomerAnalytics[]>([]);
    const [crmLoading, setCrmLoading] = useState(false);

    const loadCRMData = async () => {
        setCrmLoading(true);
        try {
            const data = await crmService.getAllCustomers();
            setCrmCustomers(data);
        } catch (err) {
            console.error('CRM fetch failed:', err);
        } finally {
            setCrmLoading(false);
        }
    };
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
    const [syncCount, setSyncCount] = useState(0);

    // Admin Party State
    const [adminParties, setAdminParties] = useState<any[]>([]);
    const [adminPartiesLoading, setAdminPartiesLoading] = useState(false);
    const [adminPartyTab, setAdminPartyTab] = useState<'active' | 'archive'>('active');

    //  Lap Times State 
    const SUPER_ADMIN_EMAILS = ['adamjames9@gmail.com'];
    const isSuperAdmin = !!(currentUser?.email && SUPER_ADMIN_EMAILS.includes(currentUser.email));
    const [myLapTimes, setMyLapTimes] = useState<any[]>([]);
    const [adminLapTimes, setAdminLapTimes] = useState<any[]>([]);
    const [adminLapSubTab, setAdminLapSubTab] = useState<'pending' | 'competitions' | 'credits'>('pending');

    const [lapCompetitions, setLapCompetitions] = useState<any[]>([]);
    const [lapTimeForm, setLapTimeForm] = useState({
        equipment: 'karts',
        game: '',
        track: '',
        car: '',
        lapTime: '',
        challengeId: null as string | null,
        referenceTimeMs: null as number | null
    });
    const lapFormRef = React.useRef<HTMLDivElement>(null);

    // Handle ?submit=daily query param for automatic pre-fill from Leaderboard
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get('submit') === 'daily' && lapCompetitions.length > 0) {
            const d = new Date();
            const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

            const daily = lapCompetitions.find((c: any) =>
                c.type === 'daily' &&
                c.status === 'active' &&
                c.startDate <= todayStr &&
                c.endDate >= todayStr
            );

            if (daily) {
                setLapTimeForm({
                    equipment: daily.equipment,
                    game: daily.game,
                    track: daily.track,
                    car: daily.car,
                    lapTime: '',
                    challengeId: daily.id,
                    referenceTimeMs: daily.referenceTimeMs
                });

                // Clear the query param so it doesn't happen again on refresh
                navigate('/dashboard', { replace: true });

                // Scroll to form after a short delay for state to settle
                setTimeout(() => {
                    lapFormRef.current?.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            }
        }
    }, [location.search, lapCompetitions, navigate]);

    const [lapTimeSubmitting, setLapTimeSubmitting] = useState(false);
    const [lapTimeError, setLapTimeError] = useState('');
    const [lapTimeSuccess, setLapTimeSuccess] = useState(false);
    const [editingCarId, setEditingCarId] = useState<string | null>(null);
    const [editingCarValue, setEditingCarValue] = useState('');
    const [newComp, setNewComp] = useState({ type: 'daily', equipment: 'karts', game: '', track: '', car: '', referenceTime: '', setByName: userProfile?.name || 'Admin', startDate: '', endDate: '' });
    const [compSubmitting, setCompSubmitting] = useState(false);
    // Give Credits (super-admin only)
    const [creditSearch, setCreditSearch] = useState('');
    const [creditSearchResults, setCreditSearchResults] = useState<any[]>([]);
    const [creditSearching, setCreditSearching] = useState(false);
    const [selectedCreditUser, setSelectedCreditUser] = useState<any>(null);
    const [creditEquipment, setCreditEquipment] = useState<'karts' | 'rigs' | 'motion' | 'flight' | 'btp'>('karts');
    const [creditAmount, setCreditAmount] = useState('');
    const [creditApplying, setCreditApplying] = useState(false);
    const [creditApplyMsg, setCreditApplyMsg] = useState('');

    // Party Hosting State
    const [hostedParties, setHostedParties] = useState<any[]>([]);
    const [loadingParties, setLoadingParties] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Party Attending State
    const [attendingParties, setAttendingParties] = useState<any[]>([]);
    const [loadingAttendingParties, setLoadingAttendingParties] = useState(false);
    const [expandedPartyId, setExpandedPartyId] = useState<string | null>(null);

    // Equipment prices for sync calculation
    const EQUIPMENT_PRICES: Record<string, number> = { karts: 30, rigs: 40, motion: 50, flight: 40 };

    // Sync existing admin bookings to Firebase CRM
    const syncBookingsToFirebase = async () => {
        setSyncStatus('syncing');
        setSyncCount(0);
        try {
            // Combine all admin bookings
            const allBookings: Booking[] = [...adminTodayBookings, ...adminUpcomingBookings, ...adminPastBookings];
            if (allBookings.length === 0) {
                setSyncStatus('done');
                return;
            }

            // Map existing transactions for updates/skips
            const existingSnapshot = await getDocs(collection(db, 'transactions_log'));
            const existingMap = new Map(
                existingSnapshot.docs.map(doc => {
                    const d = doc.data();
                    const key = `${d.date}_${d.time}_${d.email}`.toLowerCase();
                    return [key, { id: doc.id, status: d.status }];
                })
            );

            let synced = 0;
            for (const booking of allBookings) {
                const key = `${booking.date}_${booking.time}_${booking.email}`.toLowerCase();
                const sheetStatus = booking.status === 'cancelled' ? 'cancelled' : 'confirmed';
                const existing = existingMap.get(key);

                if (existing) {
                    // Update if status changed (e.e. now cancelled in sheet)
                    if (existing.status !== sheetStatus) {
                        await updateDoc(doc(db, 'transactions_log', existing.id), {
                            status: sheetStatus,
                            updatedAt: serverTimestamp()
                        });
                        synced++;
                    }
                    continue;
                }

                // Parse station string: "Rigs:2, Karts:1 (1h)"
                const equipment: Record<string, number> = {};
                let duration = 1;
                const durationMatch = booking.station.match(/\((\d+)h\)/);
                if (durationMatch) duration = parseInt(durationMatch[1]);
                const patterns = booking.station.match(/(\w+):(\d+)/g);
                if (patterns) {
                    patterns.forEach(p => {
                        const [type, qty] = p.split(':');
                        const k = type.toLowerCase();
                        if (EQUIPMENT_PRICES[k]) equipment[k] = parseInt(qty);
                    });
                }

                // Calculate price
                let price = 0;
                for (const [type, qty] of Object.entries(equipment)) {
                    price += (EQUIPMENT_PRICES[type] || 0) * qty * duration;
                }

                await addDoc(collection(db, 'transactions_log'), {
                    userId: '',
                    email: booking.email,
                    name: booking.name,
                    phone: booking.phone || '',
                    type: 'booking',
                    station: booking.station,
                    equipment,
                    drivers: booking.drivers,
                    duration,
                    date: booking.date,
                    time: booking.time,
                    calculatedPrice: price,
                    paymentMethod: booking.paymentMethod || 'unknown',
                    bookingId: booking.id,
                    status: sheetStatus,
                    syncedFromSheet: true,
                    createdAt: serverTimestamp()
                });
                synced++;
                setSyncCount(synced);
            }

            setSyncStatus('done');
            // Refresh CRM data after sync
            const updatedCustomers = await crmService.getAllCustomers();
            setCrmCustomers(updatedCustomers);
        } catch (err) {
            console.error('[CRM Sync] Error:', err);
            setSyncStatus('error');
        }
    };

    // CRM Actions
    const handleExportCRM = () => {
        if (crmCustomers.length === 0) {
            window.alert('No customer data to export. Please sync or wait for loading.');
            return;
        }
        exportCustomersToCSV(crmCustomers);
    };

    // Get ALL active memberships from user profile
    const activeMemberships = [
        userProfile?.memberships?.kart?.active ? { ...userProfile.memberships.kart, equipmentType: 'kart' as const } : null,
        userProfile?.memberships?.rig?.active ? { ...userProfile.memberships.rig, equipmentType: 'rig' as const } : null,
        userProfile?.memberships?.motion?.active ? { ...userProfile.memberships.motion, equipmentType: 'motion' as const } : null,
        userProfile?.memberships?.btp?.active ? { ...userProfile.memberships.btp, equipmentType: 'btp' as const } : null,
    ].filter(Boolean);

    // Primary membership for display (first active one found)
    const membership = activeMemberships.length > 0 ? activeMemberships[0] : null;
    const membershipTier = membership ? getMembershipById(membership.tier) : null;

    // Get credits for each equipment type
    const kartCredits = getCredits('kart');
    const rigCredits = getCredits('rig');
    const motionCredits = getCredits('motion');
    const totalCredits = kartCredits + rigCredits + motionCredits;

    // Calculate days until next billing
    const getDaysUntilBilling = () => {
        if (!membership?.nextBillingDate) return null;
        const nextBilling = new Date(membership.nextBillingDate);
        const now = new Date();
        const diffTime = nextBilling.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    };

    // Fetch user's bookings
    useEffect(() => {
        const fetchBookings = async () => {
            if (!currentUser?.email) return;

            try {
                setLoadingBookings(true);
                const response = await bookingApi.getUserBookings(currentUser.email);
                if (response.success) {
                    setUpcomingBookings(response.bookings || []);
                }
            } catch (error) {
                console.error('Failed to fetch bookings:', error);
            } finally {
                setLoadingBookings(false);
            }
        };

        fetchBookings();
    }, [currentUser?.email]);

    // Populate edit form when profile loads or modal opens
    useEffect(() => {
        if (userProfile) {
            setEditFormData({
                favDiscipline: userProfile.favDiscipline || '',
                favTrack: userProfile.favTrack || '',
                favCar: userProfile.favCar || '',
                favRig: userProfile.favRig || '',
                settings: userProfile.settings || '',
                phone: userProfile.phone || '',
            });
            // Handle junior drivers - support both old format (with age) and new format (without age)
            const juniors = userProfile.juniorDrivers || [];
            setJuniorDrivers(juniors);
        }
    }, [userProfile, showEditModal]);

    // ADMIN: Fetch ALL bookings with auto-refresh (every 30 seconds)
    useEffect(() => {
        if (!isAdmin) return;

        const fetchAllBookings = async () => {
            try {
                setAdminLoading(true);
                const response = await bookingApi.getAllBookings();
                if (response.success) {
                    setAdminTodayBookings(response.today || []);
                    setAdminUpcomingBookings(response.upcoming || []);
                    setAdminPastBookings(response.past || []);
                    setAdminStats(response.stats || { todayCount: 0, upcomingCount: 0, pastCount: 0 });
                    setLastRefresh(new Date());
                }
            } catch (error) {
                console.error('Failed to fetch admin bookings:', error);
            } finally {
                setAdminLoading(false);
            }
        };

        fetchAllBookings(); // Initial fetch
        const interval = setInterval(fetchAllBookings, 30000); // Refresh every 30 seconds

        return () => clearInterval(interval);
    }, [isAdmin]);

    // ADMIN: Fetch ALL parties (LIVE REAL-TIME LISTENER)
    useEffect(() => {
        if (!isAdmin) return;

        setAdminPartiesLoading(true);
        const q = query(collection(db, 'parties'), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const parties = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAdminParties(parties);
            setAdminPartiesLoading(false);
        }, (err) => {
            console.error('Failed to listen to admin parties:', err);
            setAdminPartiesLoading(false);
        });

        return () => unsubscribe();
    }, [isAdmin]);

    // Fetch Hosted Parties (LIVE REAL-TIME LISTENER)
    useEffect(() => {
        if (!currentUser?.uid) {
            setHostedParties([]);
            return;
        }

        setLoadingParties(true);
        const q = query(collection(db, 'parties'), where('hostUserId', '==', currentUser.uid));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const parties = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Sort by date locally
            parties.sort((a: any, b: any) => {
                const dateA = new Date(a.bookingDate).getTime();
                const dateB = new Date(b.bookingDate).getTime();
                return dateA - dateB;
            });

            setHostedParties(parties);
            setLoadingParties(false);
        }, (err) => {
            console.error('Failed to listen to hosted parties:', err);
            setLoadingParties(false);
        });

        return () => unsubscribe();
    }, [currentUser?.uid]);

    // Fetch Attending Parties (LIVE REAL-TIME LISTENER)
    useEffect(() => {
        if (!currentUser?.uid) {
            setAttendingParties([]);
            return;
        }

        setLoadingAttendingParties(true);

        const userRef = doc(db, 'users', currentUser.uid);
        let unsubscribeParties: (() => void) | null = null;

        const unsubscribeUser = onSnapshot(userRef, (userSnap) => {
            if (!userSnap.exists()) {
                setAttendingParties([]);
                setLoadingAttendingParties(false);
                return;
            }

            const data = userSnap.data();
            const attendingIds = data.partyInfo?.attendingParties || [];

            // Cleanup previous parties listener if it exists
            if (unsubscribeParties) {
                unsubscribeParties();
                unsubscribeParties = null;
            }

            if (attendingIds.length === 0) {
                setAttendingParties([]);
                setLoadingAttendingParties(false);
                return;
            }

            // Setup a real-time listener for the actual parties
            const partiesRef = collection(db, 'parties');
            const q = query(partiesRef, where(documentId(), 'in', attendingIds));

            unsubscribeParties = onSnapshot(q, (partySnap) => {
                const parties = partySnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Sort by date locally
                parties.sort((a: any, b: any) => {
                    const dateA = new Date(a.bookingDate).getTime();
                    const dateB = new Date(b.bookingDate).getTime();
                    return dateA - dateB;
                });

                setAttendingParties(parties);
                setLoadingAttendingParties(false);
            }, (err) => {
                console.error('Failed to listen to attending parties:', err);
                setLoadingAttendingParties(false);
            });

        }, (err) => {
            console.error('Failed to listen to user attending info:', err);
            setLoadingAttendingParties(false);
        });

        return () => {
            unsubscribeUser();
            if (unsubscribeParties) unsubscribeParties();
        };
    }, [currentUser?.uid]);

    //  Lap Times Live Listeners 
    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'lap_times'), where('userId', '==', currentUser.uid));
        const unsub = onSnapshot(q, (snap) => {
            const times = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort locally to avoid needing a composite index for now
            times.sort((a: any, b: any) => (b.submittedAt?.toMillis?.() || 0) - (a.submittedAt?.toMillis?.() || 0));
            setMyLapTimes(times);
        }, (err) => {
            console.error('[LapTimes History] Listener error:', err);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    useEffect(() => {
        if (!isAdmin) return;
        const q = query(collection(db, 'lap_times'), orderBy('submittedAt', 'desc'));
        const unsub = onSnapshot(q, (snap) => setAdminLapTimes(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => { });
        return () => unsub();
    }, [isAdmin]);

    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'competitions'));
        const unsub = onSnapshot(q, (snap) => {
            const comps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort locally by createdAt desc
            comps.sort((a: any, b: any) => {
                const dateA = a.createdAt?.toMillis?.() || 0;
                const dateB = b.createdAt?.toMillis?.() || 0;
                return dateB - dateA;
            });
            setLapCompetitions(comps);
        }, (err) => {
            console.error('[Competitions] Listener error:', err);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    const isPastParty = (party: any) => {
        if (!party.bookingDate || !party.bookingTime) return false;
        try {
            // Parse date "YYYY-MM-DD" and time "HH:MM" locally to avoid UTC shifts
            const [y, m, d] = party.bookingDate.split('-').map(Number);
            const [hrs, mins] = (party.bookingTime || "00:00").split(':').map(Number);
            const duration = parseInt(party.duration) || 1;

            // Create local date object
            const bookingEnd = new Date(y, m - 1, d, hrs + duration, mins);
            return new Date() > bookingEnd;
        } catch (e) {
            return false;
        }
    };

    const handleCopyInvite = (pid: string) => {
        const link = `${window.location.origin}/signup?party=${pid}`;
        navigator.clipboard.writeText(link);
        setCopiedId(pid);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleAdminCancelParty = async (partyId: string, party: any) => {
        if (!window.confirm('Are you sure you want to mark this party as CANCELED in the app? This will only update the app dashboard (Firestore), it will NOT trigger another cancellation in Google Sheets. Use this to fix desynced/legacy data.')) return;

        try {
            await updateDoc(doc(db, 'parties', partyId), {
                status: 'cancelled',
                updatedAt: new Date().toISOString()
            });

            //  LEDGER SYNC: Update main transactions_log so CRM reflects the manual cancellation
            try {
                const txRef = collection(db, 'transactions_log');
                // Try bookingId first
                if (party.bookingId) {
                    const q = query(txRef, where('bookingId', '==', party.bookingId));
                    const txSnapshot = await getDocs(q);
                    if (!txSnapshot.empty) {
                        const txPromises = txSnapshot.docs.map(txDoc =>
                            updateDoc(doc(db, 'transactions_log', txDoc.id), {
                                status: 'cancelled',
                                cancelledAt: serverTimestamp()
                            })
                        );
                        await Promise.all(txPromises);
                    }
                } else if (party.hostEmail) {
                    // Fallback to email + date
                    const q2 = query(txRef,
                        where('email', '==', party.hostEmail),
                        where('date', '==', party.bookingDate)
                    );
                    const txSnapshot2 = await getDocs(q2);
                    if (!txSnapshot2.empty) {
                        const txPromises2 = txSnapshot2.docs.map(txDoc =>
                            updateDoc(doc(db, 'transactions_log', txDoc.id), {
                                status: 'cancelled',
                                cancelledAt: serverTimestamp()
                            })
                        );
                        await Promise.all(txPromises2);
                    }
                }
            } catch (ledgerErr) {
                console.error('[CRM] Manual ledger sync failed:', ledgerErr);
            }

            window.alert('Party marked as cancelled in Firestore.');
        } catch (err) {
            console.error('Failed to update party status:', err);
            window.alert('Failed to update status.');
        }
    };

    const handleExportGuests = (party: any) => {
        if (!party.registeredGuests || party.registeredGuests.length === 0) {
            setError('No guests registered yet.');
            return;
        }

        const headers = ['Name', 'Email', 'Registered At'];
        const csvRows = [headers.join(',')];

        party.registeredGuests.forEach((guest: any) => {
            const row = [
                `"${guest.name}"`,
                `"${guest.email}"`,
                `"${guest.registeredAt}"`
            ];
            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `guests_${party.bookingDate}_${party.hostName.replace(/\s+/g, '_')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Prevent body scroll when modal is open
    useEffect(() => {
        if (showEditModal) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [showEditModal]);

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/');
        } catch (error) {
            console.error('Failed to logout:', error);
        }
    };

    const handleCancelBooking = (bookingId: string) => {
        // Redirect to cancel page to handle refunds/credits logic
        navigate(`/cancel?id=${bookingId}`);
    };

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveError('');

        try {
            // Sanitize juniorDrivers to remove undefined values which Firestore rejects
            const sanitizedJuniors = juniorDrivers.map(driver => {
                const cleanDriver: any = { name: driver.name };
                if (driver.photoURL) cleanDriver.photoURL = driver.photoURL;
                return cleanDriver;
            });

            await updateProfile({ ...editFormData, juniorDrivers: sanitizedJuniors });
            setShowEditModal(false);
        } catch (err) {
            console.error(err);
            setSaveError('Failed to update profile: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddJuniorDriver = () => {
        if (newJuniorName.trim()) {
            setJuniorDrivers([...juniorDrivers, {
                name: newJuniorName.trim()
            }]);
            setNewJuniorName('');
        }
    };

    const handleRemoveJuniorDriver = (index: number) => {
        setJuniorDrivers(juniorDrivers.filter((_, i) => i !== index));
    };

    // Photo Upload/Delete Handlers
    const handleParentPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;

        const error = validatePhotoFile(file);
        if (error) {
            setSaveError(error);
            return;
        }

        setUploadingPhoto(true);
        setSaveError('');
        try {
            await uploadProfilePhoto(currentUser.uid, file);

            //  SUCCESS: Show alert immediately
            window.alert('Profile photo updated successfully!');

            try {
                await refreshUserProfile(); // Force UI update
            } catch (refreshErr) {
                console.warn('Photo uploaded but UI refresh failed:', refreshErr);
                // Swallow this error so user knows upload worked
            }
        } catch (err) {
            console.error('Upload failed:', err);
            setSaveError('Failed to upload photo. Please try again.');
        } finally {
            setUploadingPhoto(false);
            if (parentPhotoInputRef.current) parentPhotoInputRef.current.value = '';
        }
    };

    const handleParentPhotoDelete = async () => {
        if (!currentUser) return;
        setUploadingPhoto(true);
        try {
            await deleteProfilePhoto(currentUser.uid);

            //  SUCCESS: Show alert immediately
            window.alert('Profile photo removed.');

            //  OPTIMISTIC UPDATE: Clear local preview immediately
            setPhotoPreview(null);

            await refreshUserProfile(); // Force UI update
        } catch (err) {
            setSaveError('Failed to delete photo.');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleJuniorPhotoUpload = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;

        const error = validatePhotoFile(file);
        if (error) {
            setSaveError(error);
            return;
        }

        setUploadingJuniorIndex(index);
        setSaveError('');
        try {
            const downloadURL = await uploadProfilePhoto(currentUser.uid, file, index);

            // Update local state immediately so user sees it
            const updatedJuniors = [...juniorDrivers];
            updatedJuniors[index] = { ...updatedJuniors[index], photoURL: downloadURL };
            setJuniorDrivers(updatedJuniors);

            await refreshUserProfile(); // Sync global state
        } catch (err) {
            setSaveError('Failed to upload photo.');
        } finally {
            setUploadingJuniorIndex(null);
        }
    };

    const handleJuniorPhotoDelete = async (index: number) => {
        if (!currentUser) return;
        setUploadingJuniorIndex(index);
        try {
            await deleteProfilePhoto(currentUser.uid, index);

            // Update local state immediately so user sees it
            const updatedJuniors = [...juniorDrivers];
            updatedJuniors[index] = { ...updatedJuniors[index], photoURL: undefined };
            setJuniorDrivers(updatedJuniors);

            await refreshUserProfile(); // Sync global state
        } catch (err) {
            setSaveError('Failed to delete photo.');
        } finally {
            setUploadingJuniorIndex(null);
        }
    };

    // Format date for display
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    // Format time for display
    const formatTime = (timeStr: string) => {
        if (!timeStr) return 'Time TBD';
        const parts = timeStr.split(':');
        const hours = parts[0] || '12';
        const minutes = parts[1] || '00';
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    };

    // Filter bookings
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Include today in upcoming

    const upcomingList = upcomingBookings.filter(b => {
        const bookingDate = new Date(b.date);
        // Correct timezone offset issue by treating the YYYY-MM-DD as local
        const localDate = new Date(bookingDate.valueOf() + bookingDate.getTimezoneOffset() * 60000);
        return localDate >= now;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const historyList = upcomingBookings.filter(b => {
        const bookingDate = new Date(b.date);
        const localDate = new Date(bookingDate.valueOf() + bookingDate.getTimezoneOffset() * 60000);
        return localDate < now;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Get station color
    const getStationColor = (station: string) => {
        const colors: { [key: string]: string } = {
            'Racing Karts': '#2D9E49',
            'Full-Size Rigs': '#FFFFFF',
            'Motion Simulator': '#D42428',
            'Flight Simulator': '#2D9E49'
        };
        return colors[station] || '#2D9E49';
    };

    //  Lap Time Helpers 
    const lapTimeToMs = (t: string): number => {
        // Supports MM:SS.cc  (e.g. 02:35.33 = 2m 35s 330ms)
        const match = t.match(/^(\d{1,2}):(\d{2})\.(\d{1,2})$/);
        if (!match) return 0;
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        const cs = parseInt(match[3].padEnd(2, '0'), 10); // centiseconds  ms
        return mins * 60000 + secs * 1000 + cs * 10;
    };

    const handleSubmitLapTime = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser || !userProfile) return;
        const ms = lapTimeToMs(lapTimeForm.lapTime);
        if (ms === 0) { setLapTimeError('Invalid format. Type 6 digits e.g. 023533  02:35.33'); return; }
        setLapTimeSubmitting(true); setLapTimeError('');
        try {
            await addDoc(collection(db, 'lap_times'), {
                userId: currentUser.uid,
                driverName: userProfile.name || 'Unknown',
                photoURL: userProfile.photoURL || '',
                equipment: lapTimeForm.equipment,
                game: lapTimeForm.game.trim(),
                track: lapTimeForm.track.trim(),
                car: lapTimeForm.car.trim(),
                lapTime: lapTimeForm.lapTime.trim(),
                lapTimeMs: ms,
                status: 'pending',
                isPro: userProfile?.isPro || false,
                challengeId: lapTimeForm.challengeId || null,
                referenceTimeMs: lapTimeForm.referenceTimeMs || null,
                submittedAt: serverTimestamp(),
                reviewedAt: null
            });
            setLapTimeSuccess(true);
            setLapTimeForm({
                equipment: 'karts',
                game: '',
                track: '',
                car: '',
                lapTime: '',
                challengeId: null,
                referenceTimeMs: null
            });
            setTimeout(() => setLapTimeSuccess(false), 4000);
        } catch (err) {
            console.error('[LapTime] Submit error:', err);
            setLapTimeError('Failed to submit. Check console for details.');
        }
        finally { setLapTimeSubmitting(false); }
    };

    const handleApproveLapTime = async (id: string, carOverride?: string) => {
        try {
            const lapDoc = await getDoc(doc(db, 'lap_times', id));
            if (!lapDoc.exists()) return;
            const lap = lapDoc.data();

            const data: any = { status: 'approved', reviewedAt: serverTimestamp() };
            if (carOverride !== undefined) data.car = carOverride;
            await updateDoc(doc(db, 'lap_times', id), data);

            // Reward Logic: If it's a challenge and they beat the time
            if (lap.challengeId && lap.referenceTimeMs && lap.lapTimeMs <= lap.referenceTimeMs) {
                const userDoc = await getDoc(doc(db, 'users', lap.userId));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    const credits = userData.credits || { kart: 0, rig: 0, motion: 0, flight: 0 };

                    // Determine reward based on competition type (we need to fetch the competition to be 100% sure, or just infer from equipment)
                    // Let's assume the competition type is linked to the common reward structure
                    // Actually, a better way is to fetch the competition
                    const compDoc = await getDoc(doc(db, 'competitions', lap.challengeId));
                    if (compDoc.exists()) {
                        const comp = compDoc.data();
                        const reward = comp.creditReward || 1;
                        const eqKey = lap.equipment === 'karts' ? 'kart' : lap.equipment === 'rigs' ? 'rig' : lap.equipment === 'motion' ? 'motion' : 'flight';

                        await updateDoc(doc(db, 'users', lap.userId), {
                            [`credits.${eqKey}`]: (credits[eqKey] || 0) + reward
                        });

                        // Log the reward transaction
                        await addDoc(collection(db, 'transactions_log'), {
                            userId: lap.userId,
                            email: userData.email,
                            name: userData.name,
                            type: 'reward',
                            station: `Challenge Reward (${comp.type})`,
                            equipment: { [lap.equipment]: reward },
                            date: new Date().toISOString().split('T')[0],
                            time: new Date().toTimeString().split(' ')[0],
                            calculatedPrice: 0,
                            status: 'confirmed',
                            createdAt: serverTimestamp()
                        });
                    }
                }
            }

            setEditingCarId(null);
        } catch (err) {
            console.error('[Approve] Reward failed:', err);
        }
    };

    const handleRejectLapTime = async (id: string) => {
        await updateDoc(doc(db, 'lap_times', id), { status: 'rejected', reviewedAt: serverTimestamp() });
    };

    const handleCreateCompetition = async (e: React.FormEvent) => {
        e.preventDefault();
        const ms = lapTimeToMs(newComp.referenceTime);
        if (ms === 0) { alert('Invalid reference time format. Use MM:SS.cc (e.g. 02:35.33)'); return; }
        setCompSubmitting(true);
        try {
            await addDoc(collection(db, 'competitions'), {
                ...newComp,
                setByName: newComp.setByName || userProfile?.name || 'Admin',
                referenceTimeMs: ms,
                creditReward: newComp.type === 'daily' ? 1 : newComp.type === 'weekly' ? 3 : 5,
                status: 'active',
                winnerId: null,
                winnerName: null,
                createdAt: serverTimestamp()
            });
            setNewComp({ type: 'daily', equipment: 'karts', game: '', track: '', car: '', referenceTime: '', setByName: userProfile?.name || 'Admin', startDate: '', endDate: '' });
        } catch { alert('Failed to create competition.'); }
        finally { setCompSubmitting(false); }
    };

    const handleDeleteCompetition = async (id: string) => {
        if (!window.confirm('Archive this competition? It will no longer appear on the leaderboard.')) return;
        try {
            await updateDoc(doc(db, 'competitions', id), { status: 'archived' });
        } catch { alert('Failed to archive competition.'); }
    };

    const handleSearchCredits = async () => {
        if (!creditSearch.trim()) return;
        setCreditSearching(true); setCreditApplyMsg('');
        try {
            const snap = await getDocs(query(collection(db, 'users'), where('email', '==', creditSearch.trim().toLowerCase())));
            if (!snap.empty) { setCreditSearchResults(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }
            else {
                const snap2 = await getDocs(query(collection(db, 'users'), where('name', '==', creditSearch.trim())));
                setCreditSearchResults(snap2.docs.map(d => ({ id: d.id, ...d.data() })));
            }
        } catch { setCreditApplyMsg('Search failed.'); }
        finally { setCreditSearching(false); }
    };

    const handleApplyCredits = async () => {
        if (!selectedCreditUser || !creditAmount) return;
        const amount = parseFloat(creditAmount);
        if (isNaN(amount) || amount <= 0) { setCreditApplyMsg('Invalid amount.'); return; }
        setCreditApplying(true);
        try {
            const userSnap = await getDoc(doc(db, 'users', selectedCreditUser.id));
            const ud = userSnap.data() || {};
            
            if (creditEquipment === 'btp') {
                const current = ud.btpCredits || 0;
                await updateDoc(doc(db, 'users', selectedCreditUser.id), {
                    btpCredits: current + amount
                });
            } else {
                const current = ud.bonusCredits?.[creditEquipment] || 0;
                const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 30);
                await updateDoc(doc(db, 'users', selectedCreditUser.id), {
                    [`bonusCredits.${creditEquipment}`]: current + amount,
                    [`bonusCredits.${creditEquipment}ExpiresAt`]: expiresAt.toISOString()
                });
            }

            // Log the transaction for admin oversight (Adam's Option 1)
            await addDoc(collection(db, 'transactions_log'), {
                userId: selectedCreditUser.id,
                email: selectedCreditUser.email,
                name: selectedCreditUser.name || 'Unknown',
                type: 'admin_adjustment',
                adjustmentType: 'add',
                amount: amount,
                equipment: creditEquipment,
                adminEmail: currentUser?.email || 'Unknown Admin',
                date: new Date().toISOString().split('T')[0],
                time: new Date().toTimeString().split(' ')[0],
                status: 'confirmed',
                createdAt: serverTimestamp()
            });

            setCreditApplyMsg(` Added ${amount} credit(s) to ${selectedCreditUser.name || selectedCreditUser.email}`);
            setCreditAmount(''); setSelectedCreditUser(null); setCreditSearch(''); setCreditSearchResults([]);
        } catch { setCreditApplyMsg(' Failed to apply credits.'); }
        finally { setCreditApplying(false); }
    };

    const handleTogglePro = async (user: any) => {
        if (!user?.id) return;
        const newVal = !user.isPro;
        try {
            // Update User Profile
            await updateDoc(doc(db, 'users', user.id), { isPro: newVal });

            // Propagate to all existing lap times
            const q = query(collection(db, 'lap_times'), where('userId', '==', user.id));
            const snap = await getDocs(q);
            const batchPromises = snap.docs.map(d => updateDoc(doc(db, 'lap_times', d.id), { isPro: newVal }));
            await Promise.all(batchPromises);

            setSelectedCreditUser({ ...user, isPro: newVal });
            setCreditApplyMsg(` ${user.name || user.email} is now ${newVal ? ' PRO' : 'a regular user'}. All records updated.`);
        } catch (err) {
            console.error('Pro toggle failed:', err);
            setCreditApplyMsg(' Failed to update Pro status.');
        }
    };

    return (
        <div className="relative bg-[#0A0A0A] min-h-screen pt-20 md:pt-24 pb-12 px-2 sm:px-4">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden opacity-10">
                <div className="absolute top-0 left-1/4 w-32 h-full bg-gradient-to-b from-[#2D9E49] to-transparent transform -skew-x-12"></div>
                <div className="absolute top-0 left-1/3 w-16 h-full bg-gradient-to-b from-white to-transparent transform -skew-x-12"></div>
                <div className="absolute top-0 left-[40%] w-32 h-full bg-gradient-to-b from-[#D42428] to-transparent transform -skew-x-12"></div>
            </div>

            <div className="container mx-auto px-4 md:px-6 lg:px-12 relative z-10">
                <JuniorDriversPrompt />
                {/* Status Messages */}
                {successMessage && (
                    <div className="mb-6 p-4 bg-[#2D9E49]/10 border border-[#2D9E49]/30 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center gap-3 text-[#2D9E49]">
                            <CheckCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm font-medium">{successMessage}</p>
                        </div>
                        <button onClick={() => setSuccessMessage(null)} className="text-[#2D9E49]/60 hover:text-[#2D9E49]">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}
                {error && (
                    <div className="mb-6 p-4 bg-[#D42428]/10 border border-[#D42428]/30 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center gap-3 text-[#D42428]">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                        <button onClick={() => setError(null)} className="text-[#D42428]/60 hover:text-[#D42428]">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
                    <div>
                        <span className="font-mono text-[#2D9E49] tracking-widest uppercase text-xs md:text-sm mb-2 block">
                            Driver Profile
                            {isAdmin && (
                                <span className="ml-2 px-2 py-0.5 bg-[#D42428] text-white text-[10px] rounded-full uppercase">
                                    Admin
                                </span>
                            )}
                        </span>
                        <h1 className="font-display text-3xl md:text-4xl font-bold uppercase text-white">
                            Welcome, <span className="text-[#D42428]">{userProfile?.name || 'Racer'}</span>
                        </h1>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="mt-4 md:mt-0 flex items-center gap-2 text-white/60 hover:text-white transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                    </button>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 p-4 bg-[#D42428]/10 border border-[#D42428]/30 rounded-lg flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-[#D42428] flex-shrink-0 mt-0.5" />
                        <p className="text-[#D42428] text-sm">{error}</p>
                    </div>
                )}

                {/* ADMIN SECTION */}
                {isAdmin && (
                    <div className="mb-8">
                        {/* Admin View Toggle: Bookings vs Customers */}
                        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-3 mb-6">
                            <button
                                onClick={() => setAdminView('bookings')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${adminView === 'bookings'
                                    ? 'bg-[#D42428] text-white'
                                    : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                                    }`}
                            >
                                <Calendar className="w-4 h-4" />
                                Bookings
                            </button>
                            <button
                                onClick={() => {
                                    setAdminView('customers');
                                    // Fetch CRM data on first click
                                    if (crmCustomers.length === 0 && !crmLoading) {
                                        loadCRMData();
                                    }
                                }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${adminView === 'customers'
                                    ? 'bg-[#D42428] text-white'
                                    : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                                    }`}
                            >
                                <Users className="w-4 h-4" />
                                Customers CRM
                            </button>
                            <button
                                onClick={() => setAdminView('parties')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${adminView === 'parties'
                                    ? 'bg-[#D42428] text-white'
                                    : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                                    }`}
                            >
                                <Rocket className="w-4 h-4" />
                                Parties {adminParties.filter(p => !isPastParty(p) && p.status !== 'cancelled').length > 0 && `(${adminParties.filter(p => !isPastParty(p) && p.status !== 'cancelled').length})`}
                            </button>
                            <button
                                onClick={() => setAdminView('laps' as any)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${(adminView as any) === 'laps'
                                    ? 'bg-[#FFD700] text-black'
                                    : 'bg-white/5 text-white/50 hover:text-white hover:bg-white/10'
                                    }`}
                            >
                                <Trophy size={14} className="mr-2" /> Lap Times {adminLapTimes.filter(t => t.status === 'pending').length > 0 && `(${adminLapTimes.filter(t => t.status === 'pending').length} pending)`}
                            </button>
                        </div>

                        {/* Bookings View */}
                        {adminView === 'bookings' && (
                            <div className="bg-[#141414] rounded-2xl border border-[#D42428]/30 overflow-hidden">
                                {/* Admin Header */}
                                <div className="bg-[#D42428]/10 px-6 py-4 border-b border-[#D42428]/20">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Calendar className="w-5 h-5 text-[#D42428]" />
                                            <h2 className="font-display text-lg font-bold text-white uppercase">Admin Booking Dashboard</h2>
                                        </div>
                                        <div className="flex items-center gap-3 text-sm">
                                            {adminLoading && (
                                                <span className="text-white/40 flex items-center gap-2">
                                                    <div className="w-3 h-3 border-2 border-[#D42428] border-t-transparent rounded-full animate-spin"></div>
                                                    Refreshing...
                                                </span>
                                            )}
                                            {lastRefresh && !adminLoading && (
                                                <span className="text-white/40">
                                                    Auto-refresh: {lastRefresh.toLocaleTimeString()}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Admin Tabs */}
                                <div className="flex overflow-x-auto no-scrollbar border-b border-white/10">
                                    <button
                                        onClick={() => setAdminTab('today')}
                                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${adminTab === 'today'
                                            ? 'text-[#D42428] border-b-2 border-[#D42428] bg-[#D42428]/5'
                                            : 'text-white/60 hover:text-white'
                                            }`}
                                    >
                                        Today ({adminStats.todayCount})
                                    </button>
                                    <button
                                        onClick={() => setAdminTab('upcoming')}
                                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${adminTab === 'upcoming'
                                            ? 'text-[#2D9E49] border-b-2 border-[#2D9E49] bg-[#2D9E49]/5'
                                            : 'text-white/60 hover:text-white'
                                            }`}
                                    >
                                        Upcoming ({adminStats.upcomingCount})
                                    </button>
                                    <button
                                        onClick={() => setAdminTab('past')}
                                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${adminTab === 'past'
                                            ? 'text-white/60 border-b-2 border-white/30'
                                            : 'text-white/40 hover:text-white/60'
                                            }`}
                                    >
                                        Past ({adminStats.pastCount})
                                    </button>
                                </div>

                                {/* Admin Booking Table */}
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-black/30">
                                            <tr className="text-left text-white/40 text-xs uppercase">
                                                <th className="px-4 py-3">Time</th>
                                                <th className="px-4 py-3">Date</th>
                                                <th className="px-4 py-3">Station</th>
                                                <th className="px-4 py-3">Customer</th>
                                                <th className="px-4 py-3">Email</th>
                                                <th className="px-4 py-3">Phone</th>
                                                <th className="px-4 py-3">Payment</th>
                                                <th className="px-4 py-3">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {(adminTab === 'today' ? adminTodayBookings :
                                                adminTab === 'upcoming' ? adminUpcomingBookings :
                                                    adminPastBookings
                                            ).map((booking) => (
                                                <tr key={booking.id} className="hover:bg-white/5 transition-colors">
                                                    <td className="px-4 py-3 text-[#D42428] font-medium">{booking.time}</td>
                                                    <td className="px-4 py-3 text-white">{booking.date}</td>
                                                    <td className="px-4 py-3">
                                                        <span
                                                            className="px-2 py-1 rounded text-xs font-medium"
                                                            style={{
                                                                backgroundColor: `${getStationColor(booking.station)}20`,
                                                                color: getStationColor(booking.station)
                                                            }}
                                                        >
                                                            {booking.station}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-white">{booking.name}</td>
                                                    <td className="px-4 py-3 text-white/60">{booking.email}</td>
                                                    <td className="px-4 py-3 text-white/60">{booking.phone || '-'}</td>
                                                    <td className="px-4 py-3">
                                                        {booking.paymentMethod && (() => {
                                                            const paymentStatus = getPaymentStatus(booking.station, booking.paymentMethod);
                                                            return (
                                                                <div className="space-y-1">
                                                                    <div className="text-white/60 capitalize text-xs">{booking.paymentMethod}</div>
                                                                    <div className="text-[10px] font-mono text-white/80">
                                                                        Paid: {formatCurrency(paymentStatus.paid)} | Remaining: {formatCurrency(paymentStatus.remaining)}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-1 rounded text-xs font-medium ${booking.status === 'Confirmed'
                                                            ? 'bg-[#2D9E49]/20 text-[#2D9E49]'
                                                            : booking.status === 'Cancelled'
                                                                ? 'bg-red-500/20 text-red-400'
                                                                : 'bg-yellow-500/20 text-yellow-400'
                                                            }`}>
                                                            {booking.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {(adminTab === 'today' ? adminTodayBookings :
                                                adminTab === 'upcoming' ? adminUpcomingBookings :
                                                    adminPastBookings
                                            ).length === 0 && (
                                                    <tr>
                                                        <td colSpan={8} className="px-4 py-8 text-center text-white/40">
                                                            No {adminTab} bookings found
                                                        </td>
                                                    </tr>
                                                )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Customers CRM View */}
                        {adminView === 'customers' && (
                            <div className="bg-[#141414] rounded-2xl border border-[#D42428]/30 overflow-hidden">
                                <div className="bg-[#D42428]/10 px-6 py-4 border-b border-[#D42428]/20">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Users className="w-5 h-5 text-[#D42428]" />
                                            <h2 className="font-display text-lg font-bold text-white uppercase">Customer Analytics</h2>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {/* Sync Status Indicator */}
                                            {syncStatus !== 'idle' && (
                                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${syncStatus === 'done'
                                                    ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                                    : syncStatus === 'syncing'
                                                        ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                                                        : 'bg-red-500/10 border-red-500/20 text-red-500'
                                                    }`}>
                                                    <div className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'syncing' ? 'animate-pulse bg-yellow-400' : syncStatus === 'done' ? 'bg-green-400' : 'bg-red-500'}`} />
                                                    {syncStatus === 'syncing' ? `Syncing ${syncCount}...` : syncStatus === 'done' ? `Synced ${syncCount} Records` : 'Sync Failed'}
                                                </div>
                                            )}

                                            <button
                                                onClick={syncBookingsToFirebase}
                                                disabled={syncStatus === 'syncing'}
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all border bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-50`}
                                                title="Re-sync data from Google Sheets"
                                            >
                                                <RefreshCw className={`w-3 h-3 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                                                Sync Sheet
                                            </button>

                                            <button
                                                onClick={handleExportCRM}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all bg-[#2D9E49] hover:bg-[#2D9E49]/80 text-white shadow-lg shadow-[#2D9E49]/20"
                                            >
                                                <Download className="w-4 h-4" />
                                                Harvest (CSV)
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <CustomersTable customers={crmCustomers} loading={crmLoading} onRefresh={loadCRMData} />
                                </div>
                            </div>
                        )}

                        {/* Parties Admin View */}
                        {adminView === 'parties' && (
                            <div className="bg-[#141414] rounded-2xl border border-[#D42428]/30 overflow-hidden">
                                <div className="bg-[#D42428]/10 px-6 py-4 border-b border-[#D42428]/20">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-6">
                                            <div className="flex items-center gap-3">
                                                <Rocket className="w-5 h-5 text-[#D42428]" />
                                                <h2 className="font-display text-lg font-bold text-white uppercase">Party Bookings</h2>
                                            </div>

                                            {/* Sub-tabs for Parties */}
                                            <div className="flex items-center bg-black/40 p-1 rounded-lg border border-white/5 overflow-x-auto no-scrollbar">
                                                <button
                                                    onClick={() => setAdminPartyTab('active')}
                                                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${adminPartyTab === 'active'
                                                        ? 'bg-[#D42428] text-white shadow-lg'
                                                        : 'text-white/40 hover:text-white'}`}
                                                >
                                                    Active
                                                </button>
                                                <button
                                                    onClick={() => setAdminPartyTab('archive')}
                                                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${adminPartyTab === 'archive'
                                                        ? 'bg-[#D42428] text-white shadow-lg'
                                                        : 'text-white/40 hover:text-white'}`}
                                                >
                                                    Archive
                                                </button>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setLastRefresh(new Date())}
                                            className="text-white/40 hover:text-white transition-colors"
                                        >
                                            <RefreshCw className={`w-4 h-4 ${adminPartiesLoading ? 'animate-spin' : ''}`} />
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-black/30">
                                            <tr className="text-left text-white/40 text-xs uppercase">
                                                <th className="px-4 py-3">Date/Time</th>
                                                <th className="px-4 py-3">Host</th>
                                                <th className="px-4 py-3">Guests</th>
                                                <th className="px-4 py-3">Revenue</th>
                                                <th className="px-4 py-3">Status</th>
                                                <th className="px-4 py-3">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {adminParties
                                                .filter(party => {
                                                    const isPast = isPastParty(party);
                                                    const isCancelled = party.status === 'cancelled';
                                                    if (adminPartyTab === 'active') {
                                                        return !isPast && !isCancelled;
                                                    } else {
                                                        return isPast || isCancelled;
                                                    }
                                                })
                                                .map((party) => (
                                                    <React.Fragment key={party.id}>
                                                        <tr className="hover:bg-amber-500/5 transition-colors text-white border-l-4 border-amber-500/50">
                                                            <td className="px-4 py-3">
                                                                <div className="font-medium text-amber-500">{party.bookingDate}</div>
                                                                <div className="text-[10px] text-white/40">{party.bookingTime} ({party.duration}h)</div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="font-medium">{party.hostName}</div>
                                                                <div className="text-[10px] text-white/40">{party.hostEmail}</div>
                                                            </td>
                                                            <td
                                                                className="px-4 py-3 cursor-pointer group"
                                                                onClick={() => setExpandedPartyId(expandedPartyId === party.id ? null : party.id)}
                                                            >
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <div className="flex flex-col">
                                                                        <div className="flex items-center gap-1 text-amber-500 group-hover:text-amber-400">
                                                                            <Users className="w-3 h-3" />
                                                                            <span className="font-bold">{party.registeredGuests?.length || 0} / {party.maxGuests}</span>
                                                                            {expandedPartyId === party.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                                                        </div>
                                                                        <div className="w-24 h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
                                                                            <div
                                                                                className="h-full bg-amber-500"
                                                                                style={{ width: `${Math.min(100, ((party.registeredGuests?.length || 0) / (party.maxGuests || 40)) * 100)}%` }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        {party.registeredGuests?.length > 0 && (
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleExportGuests(party);
                                                                                }}
                                                                                className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-colors"
                                                                                title="Export Guest List"
                                                                            >
                                                                                <Download className="w-3.5 h-3.5" />
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleCopyInvite(party.id);
                                                                            }}
                                                                            className={`p-1 rounded transition-colors ${copiedId === party.id ? 'bg-[#2D9E49] text-white' : 'hover:bg-white/10 text-white/40 hover:text-white'}`}
                                                                            title="Copy Invite Link"
                                                                        >
                                                                            {copiedId === party.id ? <CheckCircle className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="text-amber-500 font-bold">${party.totalPrice}</div>
                                                                <div className="text-[10px] text-white/40">Amount Paid: ${party.depositPaid}</div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="flex flex-col gap-1">
                                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest text-center ${party.status === 'confirmed' ? 'bg-[#2D9E49]/20 text-[#2D9E49]' : 'bg-white/10 text-white/40'}`}>
                                                                        {party.status}
                                                                    </span>
                                                                    {party.status === 'confirmed' && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleAdminCancelParty(party.id, party);
                                                                            }}
                                                                            className="flex items-center justify-center gap-1 mt-1 text-[8px] font-bold uppercase tracking-tighter text-[#D42428] hover:text-white hover:bg-[#D42428] transition-all py-0.5 rounded border border-[#D42428]/30"
                                                                            title="Manual Override: Mark as Canceled in App"
                                                                        >
                                                                            <Trash2 className="w-2.5 h-2.5" />
                                                                            Repair Sync
                                                                        </button>
                                                                    )}
                                                                    <span className="bg-amber-500/10 text-amber-500 text-[8px] font-bold uppercase tracking-tighter px-1 py-0.5 rounded border border-amber-500/20 text-center">
                                                                        Party Booking
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-white/40 text-[10px]">
                                                                {party.createdAt?.toDate ? party.createdAt.toDate().toLocaleDateString() : 'Unknown'}
                                                            </td>
                                                        </tr>
                                                        {expandedPartyId === party.id && (
                                                            <tr className="bg-amber-500/5">
                                                                <td colSpan={6} className="px-4 py-4 border-l-4 border-amber-500/20">
                                                                    <div className="flex items-center gap-2 mb-3 text-white/40 text-[10px] uppercase tracking-widest font-bold">
                                                                        <Users className="w-3 h-3 text-amber-500" />
                                                                        Joined Guest Log ({party.registeredGuests?.length || 0})
                                                                    </div>
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                                                        {party.registeredGuests && party.registeredGuests.length > 0 ? (
                                                                            party.registeredGuests.map((guest: any, idx: number) => (
                                                                                <div key={idx} className="flex items-center gap-3 p-2 bg-black/40 rounded-lg border border-white/5">
                                                                                    <div className="w-7 h-7 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-500 text-[10px] font-bold uppercase">
                                                                                        {guest.name ? guest.name.charAt(0) : '?'}
                                                                                    </div>
                                                                                    <div className="min-w-0">
                                                                                        <div className="text-white text-xs font-bold truncate">{guest.name}</div>
                                                                                        <div className="text-white/40 text-[9px] truncate">{guest.email}</div>
                                                                                    </div>
                                                                                </div>
                                                                            ))
                                                                        ) : (
                                                                            <div className="col-span-full py-4 text-center text-white/20 text-xs italic">
                                                                                No guests have registered yet.
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                ))}
                                            {adminParties.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="px-4 py-8 text-center text-white/40">
                                                        No party bookings found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/*  Lap Times Admin View  */}
                        {(adminView as any) === 'laps' && (
                            <div className="bg-[#141414] rounded-2xl border border-[#FFD700]/30 overflow-hidden">
                                <div className="bg-[#FFD700]/10 px-6 py-4 border-b border-[#FFD700]/20">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-display text-lg font-bold text-white uppercase flex items-center "> <Trophy size={18} className="text-[#FFD700] mr-3" /> Lap Time Management</h2>
                                        <div className="flex gap-2">
                                            {(['pending', 'competitions', ...(isSuperAdmin ? ['credits'] : [])] as string[]).map(tab => (
                                                <button key={tab} onClick={() => setAdminLapSubTab(tab as any)}
                                                    className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition-all ${adminLapSubTab === tab ? 'bg-[#FFD700] text-black' : 'bg-white/10 text-white/50 hover:text-white'}`}>
                                                    {tab === 'pending' ? `Pending (${adminLapTimes.filter(t => t.status === 'pending').length})` : tab === 'competitions' ? 'Competitions' : ' Give Credits'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6">
                                    {/* Pending Review */}
                                    {adminLapSubTab === 'pending' && (
                                        <div className="space-y-3">
                                            {adminLapTimes.filter(t => adminLapSubTab === 'pending' ? t.status === 'pending' : true).length === 0 && (
                                                <p className="text-white/30 text-sm text-center py-8">No pending lap times to review.</p>
                                            )}
                                            {adminLapTimes.filter(t => t.status === 'pending').map((lt: any) => (
                                                <div key={lt.id} className="bg-[#0A0A0A] rounded-xl border border-white/10 p-5 space-y-4">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex items-center gap-3">
                                                            {lt.photoURL ? (
                                                                <img src={lt.photoURL} alt={lt.driverName} className="w-12 h-12 rounded-full object-cover border-2 border-white/10" />
                                                            ) : (
                                                                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white/40 text-lg font-bold">
                                                                    {lt.driverName?.charAt(0)}
                                                                </div>
                                                            )}
                                                            <div>
                                                                <div className="font-bold text-base text-white">{lt.driverName}</div>
                                                                <div className="text-white/30 text-[10px] uppercase tracking-wider">
                                                                    Submitted: {lt.submittedAt?.toDate ? new Date(lt.submittedAt.toDate()).toLocaleString() : 'Just now'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-display text-2xl font-bold text-[#FFD700] leading-none mb-1">{lt.lapTime}</div>
                                                            <div className="text-[10px] text-white/40 uppercase tracking-widest">{lt.equipment}</div>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/5">
                                                        <div className="space-y-1">
                                                            <label className="block text-[10px] text-white/30 uppercase tracking-widest font-bold">Game / Sim</label>
                                                            <div className="text-sm text-white/80 font-medium px-3 py-1.5 bg-white/5 rounded-lg border border-white/5">{lt.game}</div>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="block text-[10px] text-white/30 uppercase tracking-widest font-bold">Track</label>
                                                            <div className="text-sm text-white/80 font-medium px-3 py-1.5 bg-white/5 rounded-lg border border-white/5">{lt.track}</div>
                                                        </div>
                                                        <div className="space-y-1 sm:col-span-2">
                                                            <label className="block text-[10px] text-white/30 uppercase tracking-widest font-bold">Car Selection</label>
                                                            <div className="flex gap-2">
                                                                {editingCarId === lt.id ? (
                                                                    <input
                                                                        autoFocus
                                                                        value={editingCarValue}
                                                                        onChange={e => setEditingCarValue(e.target.value)}
                                                                        className="flex-1 bg-black border border-[#FFD700]/40 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#FFD700]"
                                                                        placeholder="Confirm or edit car name..."
                                                                    />
                                                                ) : (
                                                                    <div className="flex-1 text-sm text-white font-medium px-3 py-1.5 bg-[#FFD700]/5 rounded-lg border border-[#FFD700]/20 flex items-center justify-between">
                                                                        <span>{lt.car || 'Not specified'}</span>
                                                                        <button
                                                                            onClick={() => { setEditingCarId(lt.id); setEditingCarValue(lt.car); }}
                                                                            className="text-[#FFD700] hover:text-white text-[10px] font-bold uppercase"
                                                                        >
                                                                            Edit
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-3 pt-2">
                                                        <button
                                                            onClick={() => handleApproveLapTime(lt.id, editingCarId === lt.id ? editingCarValue : undefined)}
                                                            className="flex-1 py-2.5 bg-[#2D9E49] hover:bg-green-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                                                        >
                                                            <CheckCircle size={14} /> Approve Submission
                                                        </button>
                                                        <button
                                                            onClick={() => handleRejectLapTime(lt.id)}
                                                            className="px-6 py-2.5 bg-white/5 hover:bg-[#D42428]/20 text-white/60 hover:text-[#D42428] border border-white/10 hover:border-[#D42428]/40 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                                                        >
                                                            <XCircle size={14} /> Reject
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Competitions */}
                                    {adminLapSubTab === 'competitions' && (
                                        <div className="space-y-8">
                                            {/* Active List */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h3 className="text-xs font-black text-white/40 uppercase tracking-[0.2em]">Active Competitions</h3>
                                                    <div className="h-[1px] flex-1 mx-4 bg-white/5" />
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {lapCompetitions.filter((c: any) => c.status === 'active').length === 0 && (
                                                        <div className="col-span-full py-12 text-center bg-black/40 rounded-2xl border border-dashed border-white/5">
                                                            <Trophy className="w-8 h-8 text-white/10 mx-auto mb-3" />
                                                            <p className="text-white/20 text-sm">No active competitions currently running.</p>
                                                        </div>
                                                    )}
                                                    {lapCompetitions.filter((c: any) => c.status === 'active').map((c: any) => {
                                                        const typeColors: Record<string, string> = { daily: 'text-[#FFD700]', weekly: 'text-[#C0C0C0]', monthly: 'text-[#CD7F32]' };
                                                        const TypeIcon = c.type === 'daily' ? Zap : c.type === 'weekly' ? Medal : Award;

                                                        return (
                                                            <div key={c.id} className="relative group bg-[#0A0A0A] rounded-2xl border border-white/10 p-5 hover:border-[#FFD700]/30 transition-all shadow-xl">
                                                                <div className="flex items-start justify-between mb-4">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={`p-2 rounded-xl bg-white/5 ${typeColors[c.type] || 'text-[#FFD700]'}`}>
                                                                            <TypeIcon size={20} />
                                                                        </div>
                                                                        <div>
                                                                            <span className={`font-black uppercase text-xs tracking-widest ${typeColors[c.type] || 'text-[#FFD700]'}`}>{c.type}</span>
                                                                            <div className="text-[10px] text-white/30 uppercase tracking-widest mt-0.5">{c.startDate}  {c.endDate}</div>
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => handleDeleteCompetition(c.id)}
                                                                        className="p-1.5 text-white/10 hover:text-[#D42428] hover:bg-[#D42428]/10 rounded-lg transition-all"
                                                                        title="Archive Competition"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>

                                                                <div className="space-y-3">
                                                                    <div className="flex items-end justify-between">
                                                                        <div className="text-white/80 font-mono text-xl font-black">{c.referenceTime}</div>
                                                                        <div className="text-[10px] text-white/40 uppercase font-bold px-2 py-0.5 bg-white/5 rounded">Ref by {c.setByName || 'Admin'}</div>
                                                                    </div>

                                                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                                                        <div className="bg-white/[0.03] px-3 py-2 rounded-lg border border-white/5">
                                                                            <div className="text-white/20 uppercase tracking-tighter mb-0.5">Setup</div>
                                                                            <div className="text-white/60 font-medium truncate uppercase">{c.equipment}</div>
                                                                        </div>
                                                                        <div className="bg-white/[0.03] px-3 py-2 rounded-lg border border-white/5">
                                                                            <div className="text-white/20 uppercase tracking-tighter mb-0.5">Game</div>
                                                                            <div className="text-white/60 font-medium truncate uppercase">{c.game}</div>
                                                                        </div>
                                                                        <div className="bg-white/[0.03] px-3 py-2 rounded-lg border border-white/5">
                                                                            <div className="text-white/20 uppercase tracking-tighter mb-0.5">Track</div>
                                                                            <div className="text-white/60 font-medium truncate uppercase">{c.track}</div>
                                                                        </div>
                                                                        <div className="bg-white/[0.03] px-3 py-2 rounded-lg border border-white/5">
                                                                            <div className="text-white/20 uppercase tracking-tighter mb-0.5">Car</div>
                                                                            <div className="text-white/60 font-medium truncate uppercase">{c.car}</div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Create Form */}
                                            <form onSubmit={handleCreateCompetition} className="bg-[#0A0A0A] rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
                                                <div className="bg-white/5 px-6 py-4 flex items-center gap-3 border-b border-white/5">
                                                    <div className="p-2 bg-[#FFD700] rounded-xl text-black">
                                                        <Rocket size={18} />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-xs font-black text-white uppercase tracking-[0.2em]">New Challenge</h3>
                                                        <p className="text-[10px] text-white/30 uppercase mt-0.5 tracking-widest font-bold">Configure and launch a new competition</p>
                                                    </div>
                                                </div>

                                                <div className="p-6 space-y-6">
                                                    {/* Section 1: Rules & Rewards */}
                                                    <div className="grid md:grid-cols-2 gap-6">
                                                        <div className="space-y-4">
                                                            <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-widest font-black">
                                                                <Award size={12} className="text-[#FFD700]" /> 1. Rules & Rewards
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Type</label>
                                                                    <select value={newComp.type} onChange={e => setNewComp({ ...newComp, type: e.target.value })}
                                                                        className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700] transition-colors">
                                                                        <option value="daily">Daily (1 credit)</option>
                                                                        <option value="weekly">Weekly (3 credits)</option>
                                                                        <option value="monthly">Monthly (5 credits)</option>
                                                                    </select>
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Equipment</label>
                                                                    <select value={newComp.equipment} onChange={e => setNewComp({ ...newComp, equipment: e.target.value })}
                                                                        className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700] transition-colors">
                                                                        <option value="karts">Racing Karts</option>
                                                                        <option value="rigs">Full-Size Rigs</option>
                                                                        <option value="motion">Motion Simulator</option>
                                                                        <option value="flight">Flight Simulator</option>
                                                                    </select>
                                                                </div>
                                                                <div className="space-y-1.5 sm:col-span-2">
                                                                    <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Pro / Setter Name</label>
                                                                    <input type="text" value={newComp.setByName} onChange={e => setNewComp({ ...newComp, setByName: e.target.value })}
                                                                        placeholder="e.g. Sarah or Mark Pro"
                                                                        className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700] transition-colors" />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Section 2: Challenge Details */}
                                                        <div className="space-y-4">
                                                            <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-widest font-black">
                                                                <Gauge size={12} className="text-[#FFD700]" /> 2. Challenge Details
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Game / Sim</label>
                                                                    <input required value={newComp.game} onChange={e => setNewComp({ ...newComp, game: e.target.value })}
                                                                        placeholder="e.g. Assetto Corsa" list="game-list"
                                                                        className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700] transition-colors" />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Track</label>
                                                                    <input required value={newComp.track} onChange={e => setNewComp({ ...newComp, track: e.target.value })}
                                                                        placeholder="e.g. Spa"
                                                                        className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700] transition-colors" />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Car</label>
                                                                    <input required value={newComp.car} onChange={e => setNewComp({ ...newComp, car: e.target.value })}
                                                                        placeholder="e.g. Ferrari 488"
                                                                        className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700] transition-colors" />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Ref Time</label>
                                                                    <input required value={newComp.referenceTime}
                                                                        onChange={e => {
                                                                            // MM:SS.cc format  always 6 digits: 2 min + 2 sec + 2 centisec
                                                                            const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                                                                            let formatted = '';
                                                                            if (digits.length === 0) formatted = '';
                                                                            else if (digits.length <= 2) formatted = digits;
                                                                            else if (digits.length <= 4) formatted = `${digits.slice(0, 2)}:${digits.slice(2)}`;
                                                                            else formatted = `${digits.slice(0, 2)}:${digits.slice(2, 4)}.${digits.slice(4)}`;
                                                                            setNewComp({ ...newComp, referenceTime: formatted });
                                                                        }}
                                                                        placeholder="02:35.33"
                                                                        className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700] transition-colors font-mono tracking-tighter" />
                                                                    <p className="text-[9px] text-white/30 mt-1 ml-1 uppercase font-bold">Type 6 digits  023533  02:35.33</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="h-[1px] bg-white/5" />

                                                    {/* Section 3: Timing */}
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-widest font-black">
                                                            <Calendar size={12} className="text-[#FFD700]" /> 3. Competition Schedule
                                                        </div>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                                                            <div className="space-y-1.5">
                                                                <label className="text-[10px] font-bold text-white/30 uppercase ml-1">Start Date</label>
                                                                <input required type="date" value={newComp.startDate} onChange={e => setNewComp({ ...newComp, startDate: e.target.value })}
                                                                    className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FFD700] transition-colors [color-scheme:dark]" />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <label className="text-[10px] font-bold text-white/30 uppercase ml-1">End Date</label>
                                                                <input required type="date" value={newComp.endDate} onChange={e => setNewComp({ ...newComp, endDate: e.target.value })}
                                                                    className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FFD700] transition-colors [color-scheme:dark]" />
                                                            </div>
                                                            <div className="md:col-span-1 md:flex md:items-end">
                                                                <button type="submit" disabled={compSubmitting} className="w-full py-2.5 bg-[#FFD700] text-black font-black uppercase text-xs tracking-widest rounded-xl hover:bg-[#FFD700]/80 transition-all shadow-[0_0_20px_rgba(255,215,0,0.2)] disabled:opacity-50 flex items-center justify-center gap-2">
                                                                    {compSubmitting ? (
                                                                        <>
                                                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                                                            Launching...
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Zap className="w-3 h-3" />
                                                                            Launch Challenge
                                                                        </>
                                                                    )}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </form>
                                        </div>
                                    )}

                                    {/* Give Credits  super admin only */}
                                    {adminLapSubTab === 'credits' && isSuperAdmin && (
                                        <div className="space-y-4">
                                            <p className="text-xs text-white/40">Search a driver by email or name, then add credits to their account.</p>
                                            <div className="flex gap-2">
                                                <input value={creditSearch} onChange={e => setCreditSearch(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleSearchCredits()}
                                                    placeholder="Email or name..." className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700]" />
                                                <button onClick={handleSearchCredits} disabled={creditSearching} className="px-4 py-2 bg-[#FFD700] text-black font-bold rounded-lg text-sm hover:bg-yellow-300 transition-colors disabled:opacity-50">{creditSearching ? '...' : 'Search'}</button>
                                            </div>
                                            {creditSearchResults.length > 0 && (
                                                <div className="space-y-2">
                                                    {creditSearchResults.map(u => (
                                                        <button key={u.id} onClick={() => { setSelectedCreditUser(u); setCreditSearchResults([]); }}
                                                            className={`w-full text-left p-3 rounded-xl border transition-all ${selectedCreditUser?.id === u.id ? 'border-[#FFD700] bg-[#FFD700]/10' : 'border-white/10 bg-[#0A0A0A] hover:border-white/30'}`}>
                                                            <div className="font-bold text-sm">{u.name || 'Unknown'}</div>
                                                            <div className="text-xs text-white/40">{u.email}</div>
                                                            <div className="text-[10px] text-white/30 mt-1 uppercase font-bold tracking-tighter">
                                                                Total Credits:
                                                                Karts: {(u.credits?.kart || 0) + (u.bonusCredits?.karts || 0)} |
                                                                Rigs: {(u.credits?.rig || 0) + (u.bonusCredits?.rigs || 0)} |
                                                                Motion: {(u.credits?.motion || 0) + (u.bonusCredits?.motion || 0)} |
                                                                BTP: {u.btpCredits || 0}
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {selectedCreditUser && (
                                                <div className="bg-[#0A0A0A] rounded-xl border border-[#FFD700]/30 p-4 space-y-3">
                                                    <div className="font-bold text-[#FFD700]">Adding credits to: {selectedCreditUser.name || selectedCreditUser.email}</div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="block text-xs text-white/40 mb-1">Equipment</label>
                                                            <select value={creditEquipment} onChange={e => setCreditEquipment(e.target.value as any)} className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700]">
                                                                <option value="karts">Racing Karts</option>
                                                                <option value="rigs">Full-Size Rigs</option>
                                                                <option value="motion">Motion Simulators</option>
                                                                <option value="flight">Flight Simulators</option>
                                                                <option value="btp">BTP Credits</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs text-white/40 mb-1">Credits to Add</label>
                                                            <input type="number" min="0.5" step="0.5" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} placeholder="e.g. 1, 3, 5" className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FFD700]" />
                                                        </div>
                                                    </div>
                                                    <button onClick={handleApplyCredits} disabled={creditApplying} className="w-full py-2 bg-[#FFD700] text-black font-bold rounded-xl hover:bg-yellow-300 transition-colors text-sm disabled:opacity-50">
                                                        {creditApplying ? 'Applying...' : 'Add Credits'}
                                                    </button>
                                                    {/* Toggle Pro */}
                                                    <div className="border-t border-white/10 pt-3">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold uppercase tracking-widest text-white/60">Pro Status</p>
                                                                <p className="text-[10px] text-white/30">Shows  PRO badge on leaderboard</p>
                                                            </div>
                                                            <button
                                                                onClick={() => handleTogglePro(selectedCreditUser)}
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${selectedCreditUser.isPro ? 'bg-[#FFD700] text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
                                                            >
                                                                {selectedCreditUser.isPro ? ' PRO' : 'Mark as Pro'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {creditApplyMsg && <p className="text-sm text-center">{creditApplyMsg}</p>}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
                    {/* Profile Card */}
                    <div className="bg-[#141414] rounded-2xl p-4 sm:p-6 border border-white/10">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-16 h-16 bg-[#2D9E49]/20 rounded-full overflow-hidden border-2 border-[#2D9E49]/30">
                                {userProfile?.photoURL ? (
                                    <img
                                        src={userProfile.photoURL}
                                        alt={userProfile.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <User className="w-8 h-8 text-[#2D9E49]" />
                                    </div>
                                )}
                            </div>
                            <div>
                                <h2 className="font-display text-lg font-bold text-white uppercase flex items-center gap-2">
                                    {userProfile?.name || 'Driver'}
                                    {userProfile?.isPro && (
                                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#FFD700] text-black">
                                            PRO
                                        </span>
                                    )}
                                </h2>
                                <p className="text-white/60 text-sm">{currentUser?.email}</p>
                            </div>
                        </div>

                        <div className="space-y-3 text-sm border-b border-white/10 pb-4 mb-4">
                            <div className="flex justify-between">
                                <span className="text-white/60">Phone</span>
                                <span className="text-white">{userProfile?.phone || 'Not set'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-white/60">Waiver</span>
                                <span className="text-[#2D9E49] flex items-center gap-1.5"><CheckCircle size={12} /> Accepted</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-white/60">Rules</span>
                                <span className="text-[#2D9E49] flex items-center gap-1.5"><CheckCircle size={12} /> Accepted</span>
                            </div>
                        </div>

                        {/* Competition Wins */}
                        {userProfile?.competitionWins && userProfile.competitionWins.total > 0 && (
                            <div className="mb-6">
                                <h3 className="font-display text-white/50 text-[10px] uppercase tracking-widest mb-3">Championship Wins</h3>
                                <div className="flex gap-2">
                                    {userProfile.competitionWins.daily > 0 && (
                                        <div className="flex-1 bg-[#FFD700]/10 border border-[#FFD700]/20 rounded-xl p-2 text-center group relative cursor-help">
                                            <Trophy size={16} className="text-[#FFD700] mx-auto mb-1" />
                                            <div className="font-bold text-[#FFD700] text-sm">{userProfile.competitionWins.daily}</div>
                                            <div className="text-[9px] text-[#FFD700]/60 uppercase font-black">Daily</div>
                                        </div>
                                    )}
                                    {userProfile.competitionWins.weekly > 0 && (
                                        <div className="flex-1 bg-[#C0C0C0]/10 border border-[#C0C0C0]/20 rounded-xl p-2 text-center group relative cursor-help">
                                            <Medal size={16} className="text-[#C0C0C0] mx-auto mb-1" />
                                            <div className="font-bold text-[#C0C0C0] text-sm">{userProfile.competitionWins.weekly}</div>
                                            <div className="text-[9px] text-[#C0C0C0]/60 uppercase font-black">Weekly</div>
                                        </div>
                                    )}
                                    {userProfile.competitionWins.monthly > 0 && (
                                        <div className="flex-1 bg-[#CD7F32]/10 border border-[#CD7F32]/20 rounded-xl p-2 text-center group relative cursor-help">
                                            <Award size={16} className="text-[#CD7F32] mx-auto mb-1" />
                                            <div className="font-bold text-[#CD7F32] text-sm">{userProfile.competitionWins.monthly}</div>
                                            <div className="text-[9px] text-[#CD7F32]/60 uppercase font-black">Monthly</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Driver Specs */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-display text-white/50 text-xs uppercase tracking-widest">Driver Specs</h3>
                                <button
                                    onClick={() => setShowEditModal(true)}
                                    className="text-[#2D9E49] hover:text-white transition-colors text-xs flex items-center gap-1"
                                >
                                    <Edit2 className="w-3 h-3" /> Edit
                                </button>
                            </div>
                            <div className="space-y-4 text-sm">
                                <div className="grid grid-cols-1 xs:grid-cols-2 gap-4">
                                    <div>
                                        <span className="block text-white/40 text-[10px] uppercase">Fav Car</span>
                                        <span className="text-white truncate block" title={userProfile?.favCar}>{userProfile?.favCar || '-'}</span>
                                    </div>
                                    <div>
                                        <span className="block text-white/40 text-[10px] uppercase">Fav Track</span>
                                        <span className="text-white truncate block" title={userProfile?.favTrack}>{userProfile?.favTrack || '-'}</span>
                                    </div>
                                    <div>
                                        <label className="block text-white/60 text-sm mb-1">Phone</label>
                                        <input
                                            type="text"
                                            value={editFormData.phone}
                                            onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                                            className="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#2D9E49]"
                                            placeholder="555-0123"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-white/60 text-sm mb-1">Favorite Discipline</label>
                                        <span className="text-white truncate block" title={userProfile?.favDiscipline}>{userProfile?.favDiscipline || '-'}</span>
                                    </div>
                                    <div>
                                        <span className="block text-white/40 text-[10px] uppercase">Rig</span>
                                        <span className="text-white truncate block" title={userProfile?.favRig}>{userProfile?.favRig || '-'}</span>
                                    </div>
                                </div>
                                {userProfile?.settings && (
                                    <div className="pt-2">
                                        <span className="block text-white/40 text-[10px] uppercase">Notes</span>
                                        <span className="text-white/80 italic text-xs block">{userProfile.settings}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Membership Card (Relocated for Conversion) */}
                    <div className="bg-[#141414] rounded-2xl p-4 sm:p-6 border border-[#D42428]/30">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-[#D42428]/20 rounded-lg flex items-center justify-center">
                                <CreditCard className="w-6 h-6 text-[#D42428]" />
                            </div>
                            <div>
                                <h2 className="font-display text-lg font-bold text-white uppercase">Membership</h2>
                                <p className="text-white/60 text-sm">
                                    {membership ? membershipTier?.name || 'Active' : 'No active membership'}
                                </p>
                            </div>
                        </div>

                        {membership && membershipTier ? (
                            <div className="space-y-4">
                                <div className="p-4 rounded-xl" style={{ backgroundColor: `${membershipTier.color}20` }}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: membershipTier.color }}></div>
                                        <span className="font-display font-bold text-white uppercase text-sm">{membershipTier.name}</span>
                                    </div>
                                    <div className="text-white/60 text-xs">
                                        {membershipTier.credits} credits/month  ${membershipTier.price}/mo
                                    </div>
                                </div>
                                {getDaysUntilBilling() !== null && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-white/60">Next billing</span>
                                        <span className="text-white">{getDaysUntilBilling()} days</span>
                                    </div>
                                )}
                                <Link to="/membership" className="block text-center text-sm text-[#D42428] hover:underline">
                                    Manage subscription
                                </Link>
                            </div>
                        ) : (
                            <div className="text-center py-4">
                                <p className="text-white/60 text-sm mb-4">Upgrade for 50% off every hour!</p>
                                <Link
                                    to="/membership"
                                    className="inline-flex items-center gap-2 bg-[#D42428] text-white px-6 py-3 rounded-full font-display uppercase tracking-widest font-bold text-xs hover:bg-[#b91f22] transition-colors w-full justify-center"
                                >
                                    View Plans <ArrowRight className="w-4 h-4" />
                                </Link>
                            </div>
                        )}
                    </div>

                    {/* Credits & Quick Booking Card (Relocated) */}
                    <div className="bg-[#141414] rounded-2xl p-4 sm:p-6 border border-[#2D9E49]/30">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                                    <Zap className="w-6 h-6 text-yellow-500" />
                                </div>
                                <div>
                                    <h2 className="font-display text-lg font-bold text-white uppercase">Credits</h2>
                                    <p className="text-white/60 text-sm">Available balance</p>
                                </div>
                            </div>
                            <Link to="/book" className="bg-[#2D9E49] text-white p-2.5 rounded-xl hover:bg-[#2D9E49]/80 transition-all flex items-center justify-center shadow-lg shadow-[#2D9E49]/20">
                                <Calendar className="w-5 h-5" />
                            </Link>
                        </div>

                        {totalCredits > 0 ? (
                            <div className="space-y-3">
                                {kartCredits > 0 && (
                                    <div className="flex items-center justify-between p-3 bg-[#2D9E49]/10 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <Gauge className="w-4 h-4 text-[#2D9E49]" />
                                            <span className="text-white text-sm">Kart Credits</span>
                                        </div>
                                        <span className="font-bold text-[#2D9E49]">{kartCredits} hrs</span>
                                    </div>
                                )}
                                {rigCredits > 0 && (
                                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <Monitor className="w-4 h-4 text-white" />
                                            <span className="text-white text-sm">Rig Credits</span>
                                        </div>
                                        <span className="font-bold text-white">{rigCredits} hrs</span>
                                    </div>
                                )}
                                {motionCredits > 0 && (
                                    <div className="flex items-center justify-between p-3 bg-[#D42428]/10 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <Rocket className="w-4 h-4 text-[#D42428]" />
                                            <span className="text-white text-sm">Motion Credits</span>
                                        </div>
                                        <span className="font-bold text-[#D42428]">{motionCredits} hrs</span>
                                    </div>
                                )}
                                <Link to="/book" className="block w-full py-2.5 bg-[#2D9E49]/10 border border-[#2D9E49]/20 text-[#2D9E49] rounded-xl text-center text-xs font-bold uppercase tracking-widest hover:bg-[#2D9E49]/20 transition-all mt-2">
                                    Book Session
                                </Link>
                            </div>
                        ) : (
                            <div className="text-center py-2">
                                <div className="text-4xl font-bold text-white/20 mb-2">0</div>
                                <p className="text-white/40 text-[10px] uppercase mb-4">No credits available</p>
                                <Link to="/book" className="inline-flex items-center gap-2 bg-[#2D9E49] text-white px-6 py-3 rounded-full font-display uppercase tracking-widest font-bold text-xs hover:bg-[#248a3f] transition-colors w-full justify-center">
                                    Book Now <ArrowRight className="w-3.5 h-3.5" />
                                </Link>
                            </div>
                        )}
                        {/* BTP Credits Row - always visible */}
                        {(() => {
                            const balance = getBtpCredits();
                            const cooldown = hasBtpCooldown();
                            return balance > 0 ? (
                                /* Has credits — compact balance row */
                                <div className="mt-3 p-3 bg-[#FFD700]/10 border border-[#FFD700]/20 rounded-xl">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Trophy className="w-4 h-4 text-[#FFD700]" />
                                            <div>
                                                <div className="text-white text-sm font-bold">BTP Credits</div>
                                                {cooldown.active && cooldown.availableAt ? (
                                                    <div className="text-[10px] text-yellow-400/60">Cooldown until {cooldown.availableAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                                ) : (
                                                    <div className="text-[10px] text-[#FFD700]/50">Ready to use</div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="font-display font-bold text-[#FFD700] text-xl">{balance}</span>
                                            <button onClick={() => setShowBtpModal(true)} className="text-[10px] text-[#FFD700]/50 hover:text-[#FFD700] underline underline-offset-2 transition-colors">
                                                Buy more
                                            </button>
                                        </div>
                                    </div>
                                    {!cooldown.active && (
                                        <Link
                                            to="/beat-the-pro"
                                            className="mt-3 flex items-center justify-center gap-2 w-full py-2 bg-[#FFD700] text-black rounded-lg text-xs font-black uppercase tracking-widest hover:bg-yellow-300 transition-colors"
                                        >
                                            Book My Slot <ArrowRight className="w-3.5 h-3.5" />
                                        </Link>
                                    )}
                                </div>
                            ) : (
                                /* No credits — prominent CTA */
                                <button
                                    onClick={() => setShowBtpModal(true)}
                                    className="mt-3 w-full flex items-center justify-between p-3 bg-[#FFD700]/10 border border-[#FFD700]/30 hover:border-[#FFD700]/60 hover:bg-[#FFD700]/15 rounded-xl transition-all group"
                                >
                                    <div className="flex items-center gap-2">
                                        <Trophy className="w-4 h-4 text-[#FFD700] group-hover:scale-110 transition-transform" />
                                        <div className="text-left">
                                            <div className="text-white text-sm font-bold">Buy +1 BTP Credit</div>
                                            <div className="text-[10px] text-[#FFD700]/50">$15 per credit · 30-min session</div>
                                        </div>
                                    </div>
                                    <ArrowRight className="w-4 h-4 text-[#FFD700]/50 group-hover:text-[#FFD700] group-hover:translate-x-0.5 transition-all" />
                                </button>
                            );
                        })()}
                    </div>

                    {/* BTP Purchase Modal */}
                    {showBtpModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => { if (!btpPurchasing) setShowBtpModal(false); }}>
                            <div className="bg-[#141414] border border-[#FFD700]/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-track-white/5 scrollbar-thumb-[#FFD700]/20" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <Trophy className="w-5 h-5 text-[#FFD700]" />
                                        <h3 className="font-display font-bold text-white uppercase">Beat the Pro Credit</h3>
                                    </div>
                                    <button onClick={() => setShowBtpModal(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
                                </div>

                                {btpSuccess ? (
                                    <div className="text-center py-6">
                                        <div className="w-16 h-16 bg-[#FFD700]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <Trophy className="w-8 h-8 text-[#FFD700]" />
                                        </div>
                                        <p className="text-white font-bold text-lg mb-1">Credit Added!</p>
                                        <p className="text-white/50 text-sm">Your BTP credit is ready to use.</p>
                                        <button onClick={() => { setShowBtpModal(false); setBtpSuccess(false); }} className="mt-4 px-6 py-2 bg-[#FFD700] text-black font-bold rounded-full text-sm">Close</button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="bg-[#FFD700]/5 rounded-xl p-4 mb-4">
                                            <div className="text-3xl font-display font-bold text-[#FFD700] mb-1">$15</div>
                                            <p className="text-white/60 text-sm">1 × Beat the Pro Session Credit</p>
                                            <ul className="mt-3 space-y-1 text-xs text-white/40">
                                                <li>• Redeemable for one 30-min BTP booking</li>
                                                <li>• 24-hour cooldown between uses</li>
                                                <li>• Credits never expire</li>
                                            </ul>
                                        </div>
                                        {/* PayPal Payment — handles $15 BTP credit purchase */}
                                        <div className="mt-2">
                                            <PayPalCheckout
                                                amount={15}
                                                metadata={{ type: 'btp_credit', userId: currentUser?.uid, userEmail: currentUser?.email }}
                                                onSuccess={async (details) => {
                                                    setBtpPurchasing(true);
                                                    try {
                                                        // 1. Add the credit to the user's account
                                                        await addBtpCredit(1);

                                                        // 2. Log to transactions_log for Adam's revenue tracking
                                                        //    Using type: 'btp_credit' (never 'deposit') to avoid confusion
                                                        try {
                                                            await addDoc(collection(db, 'transactions_log'), {
                                                                userId: currentUser?.uid || '',
                                                                email: currentUser?.email || '',
                                                                name: userProfile?.name || currentUser?.displayName || 'Unknown',
                                                                type: 'btp_credit',
                                                                calculatedPrice: 15,
                                                                paymentMethod: 'paypal',
                                                                paypalOrderId: details.id,
                                                                status: 'confirmed',
                                                                creditsAdded: 1,
                                                                createdAt: serverTimestamp(),
                                                            });
                                                        } catch (logErr) {
                                                            // Non-critical — credit is already added, just log the error
                                                            console.error('[CRM] BTP credit log failed (non-critical):', logErr);
                                                        }

                                                        setBtpSuccess(true);
                                                    } catch (err) {
                                                        console.error('[BTP] Credit add failed after payment:', err);
                                                        alert('Payment succeeded but credit add failed. Please contact support with PayPal Order ID: ' + details.id);
                                                    } finally {
                                                        setBtpPurchasing(false);
                                                    }
                                                }}
                                                onError={(err) => {
                                                    console.error('[BTP PayPal] Error:', err);
                                                }}
                                            />
                                        </div>
                                        <p className="text-[10px] text-white/20 text-center mt-3">Secure payment via PayPal · $15 per credit</p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/*  Fastest Lap Submit (Repositioned) */}
                    <div className="bg-[#141414] rounded-2xl p-4 sm:p-6 border border-white/10 md:col-span-3">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-display text-lg font-bold uppercase flex items-center gap-2 text-[#D42428]">
                                <Gauge className="w-5 h-5" /> My Fastest Lap Times
                            </h3>
                            <a href="/leaderboard" className="text-xs text-[#2D9E49] hover:underline flex items-center gap-1">View Full Leaderboard <ArrowRight size={12} /></a>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                            {/* Left Column: Challenges + Submit Form */}
                            <div className="space-y-4">
                                {(() => {
                                    const d = new Date();
                                    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                                    const types = ['daily', 'weekly', 'monthly'];
                                    const activeComps = types.map(t =>
                                        lapCompetitions.find((c: any) =>
                                            c.type === t &&
                                            c.status === 'active' &&
                                            c.startDate <= todayStr &&
                                            c.endDate >= todayStr
                                        )
                                    );

                                    return (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                                            {activeComps.map((comp, idx) => {
                                                const type = types[idx];
                                                const typeColors: Record<string, string> = { daily: 'text-[#FFD700]', weekly: 'text-[#C0C0C0]', monthly: 'text-[#CD7F32]' };
                                                const TypeIcon = type === 'daily' ? Zap : type === 'weekly' ? Medal : Award;

                                                if (!comp) {
                                                    return (
                                                        <div key={type} className="bg-white/5 rounded-xl border border-dashed border-white/10 p-4 text-center flex flex-col items-center justify-center min-h-[160px]">
                                                            <div className={`p-2 rounded-lg bg-white/5 ${typeColors[type]} mb-2 opacity-30`}>
                                                                <TypeIcon size={16} />
                                                            </div>
                                                            <div className={`text-[10px] font-black uppercase tracking-[0.2em] ${typeColors[type]} opacity-40 mb-1`}>
                                                                {type === 'daily' ? 'Beat the Pro' : `${type} Challenge`}
                                                            </div>
                                                            <p className="text-[9px] text-white/20 uppercase tracking-widest font-bold">No active competition</p>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div key={comp.id} className="bg-[#FFD700]/5 border border-[#FFD700]/20 rounded-xl p-4 relative overflow-hidden group flex flex-col justify-between min-h-[160px]">
                                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                                            <TypeIcon size={32} />
                                                        </div>
                                                        <div className="relative z-10 flex flex-col h-full">
                                                            <div className="mb-2">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${typeColors[type] || 'text-[#FFD700]'}`}>
                                                                        {type === 'daily' ? 'Beat the Pro' : `${type} Challenge`}
                                                                    </span>
                                                                    <span className="text-[10px] text-white/40 uppercase font-black tracking-widest">
                                                                        Prize: {comp.creditReward || (type === 'daily' ? '1' : type === 'weekly' ? '3' : '5')} Credits
                                                                    </span>
                                                                </div>
                                                                <div className="font-display text-xl font-black text-white leading-none mb-1">{comp.referenceTime}</div>
                                                                <div className="text-[10px] text-white/30 uppercase tracking-widest font-bold">Beat: {comp.referenceTime} by {comp.setByName}</div>
                                                            </div>

                                                            <div className="mt-auto space-y-2">
                                                                <div className="text-[9px] text-white/40 uppercase font-bold truncate">
                                                                    {comp.equipment} · {comp.track} · {comp.car}
                                                                </div>

                                                                {/* Smart CTA — daily = booking flow, weekly/monthly = lap form */}
                                                                {type === 'daily' ? (() => {
                                                                    const balance = getBtpCredits();
                                                                    const cooldown = hasBtpCooldown();

                                                                    // Check if user already submitted a lap for THIS booking session
                                                                    const getMs = (date: any) => {
                                                                        if (!date) return 0;
                                                                        if (typeof date.toMillis === 'function') return date.toMillis();
                                                                        if (date instanceof Date) return date.getTime();
                                                                        return new Date(date).getTime() || 0;
                                                                    };

                                                                    const bookingStartMs = getMs(userProfile?.lastBtpUsedAt);
                                                                    const alreadySubmitted = myLapTimes.some(lt =>
                                                                        lt.challengeId === comp.id &&
                                                                        getMs(lt.submittedAt) > bookingStartMs
                                                                    );

                                                                    // PRIORITIZE COOLDOWN check (User has a booking secured)
                                                                    if (cooldown.active) {
                                                                        if (alreadySubmitted) return (
                                                                            <div className="space-y-1">
                                                                                <button
                                                                                    disabled
                                                                                    className="w-full py-1.5 bg-white/5 text-white/20 text-[10px] font-black uppercase rounded cursor-not-allowed border border-white/5"
                                                                                >
                                                                                    Lap Already Submitted
                                                                                </button>
                                                                                <p className="text-[9px] text-[#2D9E49] text-center font-bold">Successfully entered for today!</p>
                                                                            </div>
                                                                        );

                                                                        return (
                                                                            <div className="space-y-1">
                                                                                <button
                                                                                    onClick={() => {
                                                                                        setLapTimeForm({
                                                                                            equipment: comp.equipment,
                                                                                            game: comp.game,
                                                                                            track: comp.track,
                                                                                            car: comp.car,
                                                                                            lapTime: '',
                                                                                            challengeId: comp.id,
                                                                                            referenceTimeMs: comp.referenceTimeMs
                                                                                        });
                                                                                        lapFormRef.current?.scrollIntoView({ behavior: 'smooth' });
                                                                                    }}
                                                                                    className="w-full py-1.5 bg-[#FFD700] text-black text-[10px] font-black uppercase rounded hover:bg-yellow-300 transition-colors"
                                                                                >
                                                                                    Submit Your Lap Time
                                                                                </button>
                                                                                <p className="text-[9px] text-white/25 text-center">Session booked — enter time below</p>
                                                                            </div>
                                                                        );
                                                                    }

                                                                    // THEN check balance (No credit, no booking)
                                                                    if (balance <= 0) return (
                                                                        <div className="space-y-1">
                                                                            <Link
                                                                                to="/dashboard"
                                                                                onClick={e => e.stopPropagation()}
                                                                                className="block w-full py-1.5 bg-[#FFD700] text-black text-[10px] font-black uppercase rounded hover:bg-yellow-300 transition-colors text-center"
                                                                            >
                                                                                Buy BTP Credit · $15
                                                                            </Link>
                                                                            <p className="text-[9px] text-white/25 text-center">Needed to book your slot</p>
                                                                        </div>
                                                                    );

                                                                    // OTHERWISE ready to book
                                                                    return (
                                                                        <div className="space-y-1">
                                                                            <Link
                                                                                to="/beat-the-pro"
                                                                                className="block w-full py-1.5 bg-[#FFD700] text-black text-[10px] font-black uppercase rounded hover:bg-yellow-300 transition-colors text-center"
                                                                            >
                                                                                Book Today's Session →
                                                                            </Link>
                                                                            <p className="text-[9px] text-white/25 text-center">{balance} credit ready · 30-min slot</p>
                                                                        </div>
                                                                    );
                                                                })() : (
                                                                    <button
                                                                        onClick={() => {
                                                                            setLapTimeForm({
                                                                                equipment: comp.equipment,
                                                                                game: comp.game,
                                                                                track: comp.track,
                                                                                car: comp.car,
                                                                                lapTime: '',
                                                                                challengeId: comp.id,
                                                                                referenceTimeMs: comp.referenceTimeMs
                                                                            });
                                                                            lapFormRef.current?.scrollIntoView({ behavior: 'smooth' });
                                                                        }}
                                                                        className="w-full py-1.5 bg-[#FFD700] text-black text-[10px] font-black uppercase rounded hover:bg-yellow-300 transition-colors"
                                                                    >
                                                                        Join Challenge
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}

                                <div ref={lapFormRef}>
                                    <form onSubmit={handleSubmitLapTime} className="space-y-3">
                                        <p className="text-xs text-white/40 mb-3">Submit your fastest lap for approval. Adam will verify and publish it to the leaderboard.</p>
                                        {lapTimeForm.challengeId && (
                                            <div className="bg-[#FFD700]/10 border border-[#FFD700]/30 rounded-lg p-2 flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <Trophy size={14} className="text-[#FFD700]" />
                                                    <span className="text-[10px] text-[#FFD700] font-bold uppercase">Active Challenge Mode</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setLapTimeForm({ ...lapTimeForm, challengeId: null, referenceTimeMs: null })}
                                                    className="text-[10px] text-white/40 hover:text-white uppercase font-bold"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs text-white/40 mb-1">Equipment</label>
                                                <select required value={lapTimeForm.equipment}
                                                    disabled={!!lapTimeForm.challengeId}
                                                    onChange={e => setLapTimeForm({ ...lapTimeForm, equipment: e.target.value })}
                                                    className="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#2D9E49] disabled:opacity-50 disabled:cursor-not-allowed">
                                                    <option value="karts">Racing Karts</option>
                                                    <option value="rigs">Full-Size Rigs</option>
                                                    <option value="motion">Motion Simulator</option>
                                                    <option value="flight">Flight Simulator</option>
                                                </select>
                                            </div>
                                            <div className="relative">
                                                <label className="block text-xs text-white/40 mb-1 flex items-center justify-between">
                                                    Game / Sim
                                                    {lapTimeForm.challengeId && <span className="text-[10px] text-[#FFD700] flex items-center gap-1 font-black bg-[#FFD700]/10 px-1.5 py-0.5 rounded-md"><Zap size={10} /> COMPETITION LOCKED</span>}
                                                </label>
                                                <input
                                                    required
                                                    disabled={!!lapTimeForm.challengeId}
                                                    value={lapTimeForm.game}
                                                    onChange={e => setLapTimeForm({ ...lapTimeForm, game: e.target.value })}
                                                    placeholder="Search or type game name..."
                                                    list="game-list"
                                                    className="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#2D9E49] disabled:opacity-50 disabled:cursor-not-allowed"
                                                />
                                                <datalist id="game-list">
                                                    {NORMALIZED_GAMES.map(g => (
                                                        <option key={g} value={g} />
                                                    ))}
                                                </datalist>
                                            </div>
                                            <div className="relative">
                                                <label className="block text-xs text-white/40 mb-1 flex items-center justify-between">
                                                    Track
                                                    {lapTimeForm.challengeId && <span className="text-[10px] text-[#FFD700] flex items-center gap-1 font-black bg-[#FFD700]/10 px-1.5 py-0.5 rounded-md"><Zap size={10} /> LOCKED</span>}
                                                </label>
                                                <input
                                                    required
                                                    disabled={!!lapTimeForm.challengeId}
                                                    value={lapTimeForm.track}
                                                    onChange={e => setLapTimeForm({ ...lapTimeForm, track: e.target.value })}
                                                    placeholder="e.g. Spa Francorchamps"
                                                    className="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#2D9E49] disabled:opacity-50 disabled:cursor-not-allowed"
                                                    list="track-list"
                                                />
                                                <datalist id="track-list">
                                                    {(NORMALIZED_TRACKS[lapTimeForm.game] || []).map(t => (
                                                        <option key={t} value={t} />
                                                    ))}
                                                </datalist>
                                            </div>
                                            <div className="relative">
                                                <label className="block text-xs text-white/40 mb-1 flex items-center justify-between">
                                                    Car / Setup
                                                    {lapTimeForm.challengeId && <span className="text-[10px] text-[#FFD700] flex items-center gap-1 font-black bg-[#FFD700]/10 px-1.5 py-0.5 rounded-md"><Zap size={10} /> LOCKED</span>}
                                                </label>
                                                <input
                                                    required
                                                    disabled={!!lapTimeForm.challengeId}
                                                    value={lapTimeForm.car}
                                                    onChange={e => setLapTimeForm({ ...lapTimeForm, car: e.target.value })}
                                                    placeholder="e.g. Ferrari 488 GT3"
                                                    className="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#2D9E49] disabled:opacity-50 disabled:cursor-not-allowed"
                                                    list="car-list"
                                                />
                                                <datalist id="car-list">
                                                    {(NORMALIZED_CARS['GT3'] || []).map(c => (
                                                        <option key={c} value={c} />
                                                    ))}
                                                </datalist>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/40 mb-1">Lap Time</label>
                                            <input
                                                type="text"
                                                value={lapTimeForm.lapTime}
                                                onChange={e => {
                                                    // MM:SS.cc format  always 6 digits: 2 min + 2 sec + 2 centisec
                                                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                                                    let formatted = '';
                                                    if (digits.length === 0) formatted = '';
                                                    else if (digits.length <= 2) formatted = digits;
                                                    else if (digits.length <= 4) formatted = `${digits.slice(0, 2)}:${digits.slice(2)}`;
                                                    else formatted = `${digits.slice(0, 2)}:${digits.slice(2, 4)}.${digits.slice(4)}`;
                                                    setLapTimeForm({ ...lapTimeForm, lapTime: formatted });
                                                }}
                                                placeholder="02:35.33"
                                                className="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#2D9E49] font-mono tracking-widest"
                                            />
                                            <p className="text-[10px] text-white/30 mt-0.5">Type 6 digits  023533  02:35.33 (MM:SS.cc)</p>
                                        </div>
                                        {lapTimeError && <p className="text-xs text-[#D42428]">{lapTimeError}</p>}
                                        {lapTimeSuccess && <p className="text-xs text-[#2D9E49]"> Submitted! Pending Adam's approval.</p>}
                                        <button type="submit" disabled={lapTimeSubmitting} className="w-full py-2 bg-[#2D9E49] text-white font-bold rounded-xl hover:bg-[#2D9E49]/80 transition-colors text-sm disabled:opacity-50">
                                            {lapTimeSubmitting ? 'Submitting...' : 'Submit Lap Time'}
                                        </button>
                                    </form>
                                </div>
                            </div>

                            {/* Right Column: Submission History */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-1 border-b border-white/5">
                                    <p className="text-[10px] text-white/40 uppercase tracking-widest font-black">Latest Submissions</p>
                                    <p className="text-[10px] text-white/20">{myLapTimes.length} Total</p>
                                </div>

                                {myLapTimes.length === 0 && (
                                    <div className="text-center py-8 bg-[#0A0A0A] rounded-xl border border-dashed border-white/5">
                                        <p className="text-sm text-white/20">No submissions found</p>
                                    </div>
                                )}

                                {/* Top 3 Featured */}
                                <div className="space-y-2">
                                    {myLapTimes.slice(0, 3).map((lt: any) => (
                                        <div key={lt.id} className="bg-gradient-to-r from-[#141414] to-[#0A0A0A] rounded-xl p-4 border border-white/10 hover:border-[#2D9E49]/30 transition-all shadow-lg group">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-[#2D9E49] shadow-[0_0_8px_rgba(45,158,73,0.5)]" />
                                                    <span className="font-mono font-black text-xl text-white tracking-tighter group-hover:text-[#2D9E49] transition-colors">{lt.lapTime}</span>
                                                </div>
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md tracking-tighter shadow-sm blur-[0.3px] group-hover:blur-0 transition-all ${lt.status === 'approved' ? 'bg-[#2D9E49] text-white' :
                                                    lt.status === 'rejected' ? 'bg-[#D42428] text-white' :
                                                        'bg-[#FFD700] text-black'
                                                    }`}>
                                                    {lt.status}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between text-[10px]">
                                                <div className="text-white/60 truncate mr-2 font-medium">
                                                    {lt.track}  {lt.car}
                                                </div>
                                                <div className="text-white/30 whitespace-nowrap tabular-nums">
                                                    {lt.submittedAt?.toDate ? new Date(lt.submittedAt.toDate()).toLocaleDateString() : 'Just now'}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Older History Scrollable */}
                                {myLapTimes.length > 3 && (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold">Past Activity</p>
                                            <div className="h-[1px] flex-1 bg-white/5" />
                                        </div>
                                        <div className="max-h-[180px] overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                                            {myLapTimes.slice(3, 20).map((lt: any) => (
                                                <div key={lt.id} className="bg-[#0A0A0A] rounded-xl p-3 border border-white/5 hover:border-white/10 transition-all flex items-center justify-between opacity-60 hover:opacity-100">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2 mb-0.5">
                                                            <span className="font-mono font-bold text-sm text-white/80">{lt.lapTime}</span>
                                                            <span className={`text-[8px] font-bold uppercase px-1.5 rounded-sm opacity-50 ${lt.status === 'approved' ? 'text-[#2D9E49]' : lt.status === 'rejected' ? 'text-[#D42428]' : 'text-[#FFD700]'}`}>
                                                                {lt.status}
                                                            </span>
                                                        </div>
                                                        <div className="text-[9px] text-white/30 truncate uppercase tracking-tighter">
                                                            {lt.track}  {lt.car}
                                                        </div>
                                                    </div>
                                                    <div className="text-[9px] text-white/20 whitespace-nowrap ml-4">
                                                        {lt.submittedAt?.toDate ? new Date(lt.submittedAt.toDate()).toLocaleDateString() : 'Old'}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>



                        {/* Junior Drivers Card: always visible, with one-step add */}
                        <JuniorDriversCard onEdit={() => setShowEditModal(true)} />
                    </div>

                    {/* Your Hosted Parties */}
                    {hostedParties.length > 0 && (
                        <div className="mt-8 md:col-span-2">
                            <h2 className="font-display text-xl font-bold text-white uppercase mb-4 flex items-center gap-2">
                                <Users className="w-5 h-5 text-[#D42428]" />
                                Your Hosted Parties
                            </h2>
                            <div className="grid gap-6">
                                {hostedParties
                                    .filter(party => {
                                        const isPast = isPastParty(party);
                                        const isCancelled = party.status === 'cancelled';
                                        return !isPast && !isCancelled;
                                    })
                                    .map((party) => (
                                        <div key={party.id} className="bg-[#141414] rounded-2xl p-6 border border-[#D42428]/30">
                                            <div className="flex flex-col lg:flex-row gap-8">
                                                {/* Party Info */}
                                                <div className="flex-1">
                                                    <div className="flex items-start gap-3 mb-4">
                                                        <div className="w-12 h-12 bg-[#D42428]/20 rounded-xl flex items-center justify-center shrink-0">
                                                            <Calendar className="w-6 h-6 text-[#D42428]" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-3 flex-wrap">
                                                                <h3 className="text-white font-display font-bold uppercase text-lg">Facility Takeover</h3>
                                                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shrink-0 ${party.status === 'confirmed' ? 'bg-[#2D9E49]/20 text-[#2D9E49]' : 'bg-white/10 text-white/40'}`}>
                                                                    {party.status}
                                                                </span>
                                                            </div>
                                                            <p className="text-white/60 text-sm mt-1">
                                                                {formatDate(party.bookingDate)} at {formatTime(party.bookingTime)} | {party.duration} Hours
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4 mt-6">
                                                        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
                                                            <div>
                                                                <span className="block text-white/40 text-[10px] uppercase tracking-[0.2em] mb-1">Registration Status</span>
                                                                <div className="flex items-end gap-2 mb-2">
                                                                    <span className="text-2xl font-bold text-white leading-none">{party.registeredGuests?.length || 0}</span>
                                                                    <span className="text-white/40 text-xs mb-0.5">/ {party.maxGuests} Guests</span>
                                                                </div>
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-[#2D9E49] shadow-[0_0_10px_rgba(45,158,73,0.3)] transition-all duration-500"
                                                                        style={{ width: `${Math.min(100, ((party.registeredGuests?.length || 0) / (party.maxGuests || 40)) * 100)}%` }}
                                                                    />
                                                                </div>
                                                                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                                                                    <span className="text-[#2D9E49]">{(party.maxGuests || 40) - (party.registeredGuests?.length || 0)} SEATS LEFT</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="p-4 bg-black/30 rounded-xl border border-white/5">
                                                            <span className="block text-white/40 text-[10px] uppercase tracking-widest mb-1">Amount Paid</span>
                                                            <div className="text-xl font-bold text-green-500">${party.depositPaid}</div>
                                                            <div className="text-[10px] text-white/40 mt-1 uppercase">Stripe / PayPal</div>
                                                        </div>
                                                        <div className="p-4 bg-black/30 rounded-xl border border-white/5">
                                                            <span className="block text-white/40 text-[10px] uppercase tracking-widest mb-1">Remaining</span>
                                                            <div className="text-xl font-bold text-white opacity-60">${party.remainingBalance}</div>
                                                            <div className="text-[10px] text-white/40 mt-1 uppercase italic">Pay at Venue</div>
                                                        </div>
                                                        <div className="p-4 bg-[#D42428]/5 rounded-xl border border-[#D42428]/10">
                                                            <span className="block text-[#D42428] text-[10px] uppercase tracking-widest mb-1 font-bold">Total Bill</span>
                                                            <div className="text-xl font-bold text-white">${party.totalPrice}</div>
                                                            <div className="text-[10px] text-white/40 mt-1 uppercase">{party.duration}hr Full Facility</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Invitation & Management */}
                                                <div className="lg:w-80 space-y-4">
                                                    <div className="p-4 bg-[#2D9E49]/10 rounded-xl border border-[#2D9E49]/20">
                                                        <h4 className="text-[#2D9E49] font-display text-xs font-bold uppercase mb-2">Invite Your Crew</h4>
                                                        <p className="text-white/60 text-[11px] mb-3">Send this link to your guests so they can register and sign the waiver.</p>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <button
                                                                onClick={() => handleCopyInvite(party.id)}
                                                                className={`py-2.5 rounded-lg font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${copiedId === party.id
                                                                    ? 'bg-[#2D9E49] text-white'
                                                                    : 'bg-white/10 text-white hover:bg-white/20'}`}
                                                            >
                                                                {copiedId === party.id ? (
                                                                    <><CheckCircle className="w-4 h-4" /> Copied!</>
                                                                ) : (
                                                                    <>Copy Link</>
                                                                )}
                                                            </button>
                                                            <button
                                                                onClick={() => handleExportGuests(party)}
                                                                disabled={!party.registeredGuests || party.registeredGuests.length === 0}
                                                                className="py-2.5 rounded-lg font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30"
                                                            >
                                                                <Download className="w-4 h-4" /> Export
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="p-4 bg-white/5 rounded-xl border border-white/10 italic text-[11px] text-white/40">
                                                        Tip: Only registered guests can participate. Each guest creates their own driver profile.
                                                    </div>

                                                    {party.status === 'confirmed' && (
                                                        <button
                                                            onClick={() => handleCancelBooking(party.bookingId)}
                                                            className="w-full py-3 border border-[#D42428]/30 text-[#D42428] rounded-xl hover:bg-[#D42428]/10 transition-all font-display text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                                                        >
                                                            <XCircle className="w-4 h-4" />
                                                            Cancel Party Booking
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Guest List Section */}
                                            <div className="mt-8 pt-8 border-t border-white/10">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h4 className="text-white font-display font-bold uppercase text-sm flex items-center gap-2">
                                                        <Users className="w-4 h-4 text-[#2D9E49]" />
                                                        Guest Registry
                                                    </h4>
                                                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded">
                                                        {party.registeredGuests?.length || 0} / {party.maxGuests} Active
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {/* Registered Guests */}
                                                    {party.registeredGuests?.map((guest: any, idx: number) => (
                                                        <div key={`registered-${idx}`} className="flex items-center justify-between p-3 bg-[#2D9E49]/5 rounded-xl border border-[#2D9E49]/20 group hover:bg-[#2D9E49]/10 transition-colors">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 bg-[#2D9E49]/10 rounded-full flex items-center justify-center text-[#2D9E49] font-bold text-xs ring-1 ring-[#2D9E49]/30">
                                                                    {typeof guest === 'string' ? '?' : guest.name?.charAt(0) || '?'}
                                                                </div>
                                                                <div className="overflow-hidden">
                                                                    <p className="text-white text-sm font-bold truncate">
                                                                        {typeof guest === 'string' ? `Member ID: ${guest.substring(0, 8)}` : guest.name}
                                                                    </p>
                                                                    <p className="text-white/40 text-[10px] truncate">
                                                                        {typeof guest === 'string' ? 'Legacy Account' : guest.email}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            {guest.registeredAt && (
                                                                <span className="text-[9px] text-[#2D9E49]/40 font-bold uppercase shrink-0">
                                                                    {new Date(guest.registeredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}

                                                    {/* Available Slots (Empty Seats) */}
                                                    {Array.from({ length: Math.max(0, (party.maxGuests || 40) - (party.registeredGuests?.length || 0)) }).map((_, idx) => (
                                                        <div key={`empty-${idx}`} className="flex items-center gap-3 p-3 bg-white/[0.02] rounded-xl border border-dashed border-white/10 opacity-40">
                                                            <div className="w-8 h-8 rounded-full border border-dashed border-white/20 flex items-center justify-center">
                                                                <Users className="w-3 h-3 text-white/20" />
                                                            </div>
                                                            <div>
                                                                <p className="text-white/40 text-sm font-medium italic">Empty Seat</p>
                                                                <p className="text-white/20 text-[10px] uppercase">Awaiting invite</p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )
                    }

                    {/* Attending Parties (Guest View) */}
                    {
                        attendingParties.length > 0 && (
                            <div className="mt-8 md:col-span-2">
                                <h2 className="font-display text-xl font-bold text-white uppercase mb-4 flex items-center gap-2">
                                    <Rocket className="w-5 h-5 text-[#2D9E49]" />
                                    Parties You're Attending
                                </h2>
                                <div className="grid gap-4">
                                    {attendingParties
                                        .filter(party => {
                                            const isPast = isPastParty(party);
                                            const isCancelled = party.status === 'cancelled';
                                            return !isPast && !isCancelled;
                                        })
                                        .map((party) => (
                                            <div key={party.id} className="bg-[#141414] rounded-2xl p-6 border border-[#2D9E49]/30 relative overflow-hidden group hover:border-[#2D9E49]/50 transition-colors">
                                                <div className="absolute top-0 right-0 p-4">
                                                    <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-[#2D9E49]/20 text-[#2D9E49] flex items-center gap-1">
                                                        <CheckCircle className="w-3 h-3" /> Registered
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <div className="w-16 h-16 bg-[#2D9E49]/10 rounded-xl flex items-center justify-center shrink-0">
                                                        <Calendar className="w-8 h-8 text-[#2D9E49]" />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-white font-display font-bold uppercase text-lg">Facility Takeover</h3>
                                                        <p className="text-white font-medium text-sm">Hosted by <span className="text-[#2D9E49]">{party.hostName}</span></p>
                                                        <p className="text-white/60 text-xs mt-1">
                                                            {formatDate(party.bookingDate)} at {formatTime(party.bookingTime)}  {party.duration} Hours
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Action Buttons */}
                                                <div className="mt-6 flex gap-3">
                                                    <a
                                                        href={`https://maps.google.com/?q=Kartcade`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors border border-white/10"
                                                    >
                                                        <Monitor className="w-4 h-4" />
                                                        Get Directions
                                                    </a>
                                                    <Link
                                                        to="/waiver"
                                                        className="flex-1 py-3 bg-[#2D9E49]/10 hover:bg-[#2D9E49]/20 text-[#2D9E49] rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors border border-[#2D9E49]/20"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                        Update Waiver
                                                    </Link>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )
                    }

                    {/* Upcoming Bookings */}
                    <div className="mt-8 md:col-span-1">
                        <h2 className="font-display text-xl font-bold text-white uppercase mb-4 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-[#2D9E49]" />
                            Upcoming Bookings
                        </h2>
                        <div className="bg-[#141414] rounded-2xl p-6 border border-white/10">
                            {loadingBookings ? (
                                <div className="text-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#2D9E49] mx-auto mb-4"></div>
                                    <p className="text-white/60">Loading bookings...</p>
                                </div>
                            ) : upcomingList.length > 0 ? (
                                <div className="space-y-4">
                                    {upcomingList.map((booking) => (
                                        <div
                                            key={booking.id}
                                            className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-black/30 rounded-xl border border-white/5"
                                        >
                                            <div className="flex items-start gap-4">
                                                {/* Date/Time */}
                                                <div className="text-center min-w-[60px]">
                                                    <div className="text-2xl font-bold text-white">
                                                        {new Date(booking.date).getUTCDate()}
                                                    </div>
                                                    <div className="text-xs text-white/60 uppercase">
                                                        {new Date(booking.date).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
                                                    </div>
                                                </div>

                                                {/* Details */}
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span
                                                            className="w-2 h-2 rounded-full"
                                                            style={{ backgroundColor: getStationColor(booking.station) }}
                                                        ></span>
                                                        <span className="font-display text-white font-bold uppercase text-sm">
                                                            {booking.station}
                                                        </span>
                                                    </div>
                                                    <div className="text-white/60 text-sm">
                                                        {formatDate(booking.date)} at {formatTime(booking.time)}
                                                    </div>
                                                    <div className="text-white/40 text-xs mt-1">
                                                        {booking.drivers} driver{booking.drivers > 1 ? 's' : ''}  ID: {booking.id}
                                                    </div>
                                                    {/* Payment Status */}
                                                    {booking.paymentMethod && (() => {
                                                        const paymentStatus = getPaymentStatus(booking.station, booking.paymentMethod);
                                                        return (
                                                            <div className="flex items-center gap-2 mt-2">
                                                                <DollarSign className="w-3 h-3 text-white/40" />
                                                                <span className="text-[11px] font-mono text-white/60">
                                                                    PAID: {formatCurrency(paymentStatus.paid)} | REMAINING: {formatCurrency(paymentStatus.remaining)}
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            {/* Cancel Button */}
                                            <button
                                                onClick={() => handleCancelBooking(booking.id)}
                                                disabled={cancellingId === booking.id}
                                                className="mt-4 sm:mt-0 flex items-center gap-2 px-4 py-2 border border-[#D42428]/30 text-[#D42428] rounded-lg hover:bg-[#D42428]/10 transition-colors text-sm disabled:opacity-50"
                                            >
                                                {cancellingId === booking.id ? (
                                                    'Cancelling...'
                                                ) : (
                                                    <>
                                                        <X className="w-4 h-4" />
                                                        Cancel
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8">
                                    <Clock className="w-12 h-12 text-white/20 mx-auto mb-4" />
                                    <p className="text-white/60 mb-4">No upcoming bookings</p>
                                    <Link
                                        to="/book"
                                        className="inline-flex items-center gap-2 bg-[#2D9E49] text-white px-6 py-3 rounded-full font-display uppercase tracking-widest font-bold text-xs hover:bg-[#248a3f] transition-colors"
                                    >
                                        Book a Session <ArrowRight className="w-4 h-4" />
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Booking History */}
                    {
                        historyList.length > 0 && (
                            <div className="mt-12 md:col-span-3 opacity-80 hover:opacity-100 transition-opacity">
                                <h2 className="font-display text-lg font-bold text-white/40 uppercase mb-4 flex items-center gap-2">
                                    <Clock className="w-5 h-5" />
                                    Booking History
                                </h2>
                                <div className="bg-[#141414]/50 rounded-2xl p-6 border border-white/5">
                                    <div className="space-y-4">
                                        {historyList.map((booking) => (
                                            <div
                                                key={booking.id}
                                                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-black/20 rounded-xl"
                                            >
                                                <div className="flex items-start gap-4 opacity-60">
                                                    {/* Date/Time */}
                                                    <div className="text-center min-w-[60px]">
                                                        <div className="text-xl font-bold text-white">
                                                            {new Date(booking.date).getUTCDate()}
                                                        </div>
                                                        <div className="text-xs text-white/60 uppercase">
                                                            {new Date(booking.date).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
                                                        </div>
                                                    </div>

                                                    {/* Details */}
                                                    <div>
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span
                                                                className="w-2 h-2 rounded-full bg-white/40"
                                                            ></span>
                                                            <span className="font-display text-white font-bold uppercase text-sm">
                                                                {booking.station}
                                                            </span>
                                                        </div>
                                                        <div className="text-white/60 text-sm">
                                                            {formatDate(booking.date)} at {formatTime(booking.time)}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-2 sm:mt-0 text-white/20 text-xs font-mono">
                                                    COMPLETED
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )
                    }
                </div>
                {/* Edit Profile Modal */}
                {
                    showEditModal && (
                        <div
                            className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden"
                            onClick={(e) => {
                                // Close modal when clicking backdrop
                                if (e.target === e.currentTarget) setShowEditModal(false);
                            }}
                        >
                            <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-lg relative max-h-[70vh] sm:max-h-[75vh] flex flex-col my-4">
                                {/* Fixed Header with Close Button */}
                                <div className="flex items-center justify-between p-4 sm:p-6 pb-2 sm:pb-3 flex-shrink-0">
                                    <h2 className="font-display text-lg sm:text-xl font-bold uppercase text-white">Edit Driver Profile</h2>
                                    <button
                                        onClick={() => setShowEditModal(false)}
                                        className="ml-2 text-white/40 hover:text-white transition-colors flex-shrink-0"
                                        type="button"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Scrollable Content */}
                                <div
                                    className="overflow-y-auto overflow-x-hidden px-4 sm:px-6 pb-4 sm:pb-6"
                                    onWheel={(e) => {
                                        // Prevent event from bubbling to prevent background scroll
                                        e.stopPropagation();
                                    }}
                                >

                                    {saveError && (
                                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
                                            {saveError}
                                        </div>
                                    )}

                                    <form onSubmit={handleSaveProfile} className="space-y-3 sm:space-y-4">
                                        {/* Parent Photo Upload Section */}
                                        <div className="bg-black/20 border border-white/10 rounded-xl p-4">
                                            <label className="block text-xs uppercase tracking-widest text-white/40 mb-3">Profile Photo</label>
                                            <div className="flex items-center gap-4">
                                                {/* Photo Preview */}
                                                <div className="w-20 h-20 bg-[#2D9E49]/20 rounded-full overflow-hidden border-2 border-[#2D9E49]/30 flex-shrink-0">
                                                    {photoPreview ? (
                                                        <img
                                                            src={photoPreview}
                                                            alt={userProfile?.name || 'User'}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <User className="w-10 h-10 text-[#2D9E49]" />
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Upload/Delete Buttons */}
                                                <div className="flex gap-2 flex-1">
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={handleParentPhotoUpload}
                                                        className="hidden"
                                                        id="parent-photo-upload"
                                                        ref={parentPhotoInputRef}
                                                    />
                                                    <label
                                                        htmlFor="parent-photo-upload"
                                                        className="flex-1 px-4 py-2 bg-[#2D9E49] text-white rounded-lg font-bold text-sm hover:bg-[#248a3f] transition-colors cursor-pointer text-center flex items-center justify-center gap-2"
                                                    >
                                                        {uploadingPhoto ? (
                                                            <>
                                                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                                <span>Uploading...</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Camera className="w-4 h-4" />
                                                                <span>Upload</span>
                                                            </>
                                                        )}
                                                    </label>

                                                    {(photoPreview || userProfile?.photoURL) && (
                                                        <button
                                                            type="button"
                                                            onClick={handleParentPhotoDelete}
                                                            disabled={uploadingPhoto}
                                                            className="px-4 py-2 bg-[#D42428] text-white rounded-lg font-bold text-sm hover:bg-[#B91C1C] transition-colors disabled:opacity-50 flex items-center gap-2"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                            <span>Delete</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                                            <div>
                                                <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Fav Discipline</label>
                                                <input
                                                    type="text"
                                                    value={editFormData.favDiscipline}
                                                    onChange={(e) => setEditFormData({ ...editFormData, favDiscipline: e.target.value })}
                                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-white text-sm focus:border-[#2D9E49] outline-none"
                                                    placeholder="e.g. GT3"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Fav Track</label>
                                                <input
                                                    type="text"
                                                    value={editFormData.favTrack}
                                                    onChange={(e) => setEditFormData({ ...editFormData, favTrack: e.target.value })}
                                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-white text-sm focus:border-[#2D9E49] outline-none"
                                                    placeholder="e.g. Spa"
                                                />
                                            </div>
                                            <div className="col-span-2 md:col-span-1">
                                                <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Mobile Number</label>
                                                <input
                                                    type="tel"
                                                    value={editFormData.phone}
                                                    onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-[#2D9E49] outline-none"
                                                    placeholder="555-123-4567"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Fav Car</label>
                                                <input
                                                    type="text"
                                                    value={editFormData.favCar}
                                                    onChange={(e) => setEditFormData({ ...editFormData, favCar: e.target.value })}
                                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-[#2D9E49] outline-none"
                                                    placeholder="e.g. Ferrari 296"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Fav Rig</label>
                                                <input
                                                    type="text"
                                                    value={editFormData.favRig}
                                                    onChange={(e) => setEditFormData({ ...editFormData, favRig: e.target.value })}
                                                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-[#2D9E49] outline-none"
                                                    placeholder="e.g. Motion"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Settings / Notes</label>
                                            <textarea
                                                value={editFormData.settings}
                                                onChange={(e) => setEditFormData({ ...editFormData, settings: e.target.value })}
                                                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-[#2D9E49] outline-none resize-none"
                                                rows={3}
                                                placeholder="Force feedback preferences, etc."
                                            />
                                        </div>

                                        {/* Junior Drivers Section */}
                                        <div className="border-t border-white/10 pt-4">
                                            <label className="block text-xs uppercase tracking-widest text-white/40 mb-3">Junior Drivers (Optional)</label>
                                            <p className="text-xs text-white/50 mb-3">Add minors to your account. They will be covered by your acceptance of the waiver.</p>

                                            {/* List of Junior Drivers */}
                                            {juniorDrivers.length > 0 && (
                                                <div className="space-y-2 mb-3">
                                                    {juniorDrivers.map((junior, index) => (
                                                        <div key={index} className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
                                                            {/* Photo */}
                                                            <div className="w-10 h-10 bg-[#2D9E49]/20 rounded-full overflow-hidden flex-shrink-0">
                                                                {junior.photoURL ? (
                                                                    <img src={junior.photoURL} alt={junior.name} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center">
                                                                        <User className="w-5 h-5 text-[#2D9E49]" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {/* Name */}
                                                            <span className="text-white text-sm flex-1">{junior.name}</span>
                                                            {/* Upload/Delete Photo */}
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                onChange={(e) => handleJuniorPhotoUpload(index, e)}
                                                                className="hidden"
                                                                id={`junior-photo-${index}`}
                                                            />
                                                            <label
                                                                htmlFor={`junior-photo-${index}`}
                                                                className="cursor-pointer text-[#2D9E49] hover:text-[#248a3f] transition-colors"
                                                            >
                                                                {uploadingJuniorIndex === index ? (
                                                                    <div className="w-4 h-4 border-2 border-[#2D9E49] border-t-transparent rounded-full animate-spin" />
                                                                ) : (
                                                                    <Camera className="w-4 h-4" />
                                                                )}
                                                            </label>
                                                            {junior.photoURL && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleJuniorPhotoDelete(index)}
                                                                    className="text-[#D42428] hover:text-[#B91C1C] transition-colors"
                                                                    disabled={uploadingJuniorIndex === index}
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                            {/* Remove Junior */}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveJuniorDriver(index)}
                                                                className="text-[#D42428] hover:text-[#B91C1C] transition-colors"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Add Junior Driver Input */}
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={newJuniorName}
                                                    onChange={(e) => setNewJuniorName(e.target.value)}
                                                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddJuniorDriver())}
                                                    className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:border-[#2D9E49] outline-none"
                                                    placeholder="Enter child's name"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleAddJuniorDriver}
                                                    className="px-4 py-2 bg-[#2D9E49] text-white rounded-lg font-bold text-sm hover:bg-[#248a3f] transition-colors"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-3 pt-4 pb-2 sm:pb-0">
                                            <button
                                                type="button"
                                                onClick={() => setShowEditModal(false)}
                                                className="px-4 py-2 text-white/60 hover:text-white transition-colors text-sm font-bold uppercase tracking-wider"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={isSaving}
                                                className="flex items-center gap-2 px-6 py-2 bg-[#2D9E49] text-white rounded-full font-bold uppercase tracking-widest text-xs hover:bg-[#248a3f] transition-colors disabled:opacity-50"
                                            >
                                                {isSaving ? 'Saving...' : (
                                                    <>
                                                        <Save className="w-3 h-3" /> Save Changes
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div>
        </div >
    );
};

export default DashboardPage;
