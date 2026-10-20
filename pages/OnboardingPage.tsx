
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, Trophy, Globe, Car, Settings, Monitor } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const OnboardingPage: React.FC = () => {
    const navigate = useNavigate();
    const { updateProfile, userProfile, currentUser } = useAuth();

    // Safety check: specific fields
    const [formData, setFormData] = useState({
        favDiscipline: userProfile?.favDiscipline || '',
        favTrack: userProfile?.favTrack || '',
        favCar: userProfile?.favCar || '',
        favRig: userProfile?.favRig || '',
        settings: userProfile?.settings || '',
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await updateProfile({
                ...formData,
                // Mark rules/waiver as accepted since they clicked through the modal to get here (or we can re-confirm if needed, but Google modal had it)
                // Actually, wait, the Google Modal had the checkboxes. So we are good.
            });
            const hasPendingBooking = (() => { try { return !!sessionStorage.getItem('kartcade.pendingBooking'); } catch { return false; } })();
            navigate(hasPendingBooking ? '/book' : '/dashboard');
        } catch (err) {
            console.error(err);
            setError('Failed to update profile. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen bg-[#0A0A0A] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
            {/* Background elements */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-[#2D9E49]/10 to-transparent transform skew-x-12"></div>
                <div className="absolute bottom-0 left-0 w-1/2 h-full bg-gradient-to-r from-[#D42428]/10 to-transparent transform -skew-x-12"></div>
            </div>

            <div className="relative max-w-2xl mx-auto w-full">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="w-16 h-16 bg-[#2D9E49]/20 rounded-full flex items-center justify-center mx-auto mb-6 ring-4 ring-[#2D9E49]/10">
                        <Trophy className="w-8 h-8 text-[#2D9E49]" />
                    </div>
                    <h1 className="font-display text-4xl md:text-5xl font-bold uppercase text-white mb-4">
                        Welcome to the <span className="text-[#D42428]">Team</span>
                    </h1>
                    <p className="text-white/60 text-lg max-w-lg mx-auto">
                        Your account is created. Now let's set up your driver profile so our staff can have your rig ready when you arrive.
                    </p>
                </div>

                {/* Form Card */}
                <div className="bg-[#141414] border border-white/10 rounded-2xl p-6 md:p-10 shadow-2xl backdrop-blur-sm relative z-10">
                    {error && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Discipline */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-white/80 uppercase tracking-wide">
                                    <Trophy className="w-4 h-4 text-[#D42428]" /> Favorite Discipline
                                </label>
                                <input
                                    type="text"
                                    name="favDiscipline"
                                    value={formData.favDiscipline}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-[#2D9E49] focus:ring-1 focus:ring-[#2D9E49] outline-none transition-all"
                                    placeholder="e.g. F1, GT3, Rally, NASCAR..."
                                />
                            </div>

                            {/* Track */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-white/80 uppercase tracking-wide">
                                    <Globe className="w-4 h-4 text-[#2D9E49]" /> Favorite Track
                                </label>
                                <input
                                    type="text"
                                    name="favTrack"
                                    value={formData.favTrack}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-[#2D9E49] focus:ring-1 focus:ring-[#2D9E49] outline-none transition-all"
                                    placeholder="e.g. Spa, Nordschleife, Monza..."
                                />
                            </div>

                            {/* Car */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-white/80 uppercase tracking-wide">
                                    <Car className="w-4 h-4 text-[#D42428]" /> Favorite Car
                                </label>
                                <input
                                    type="text"
                                    name="favCar"
                                    value={formData.favCar}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-[#2D9E49] focus:ring-1 focus:ring-[#2D9E49] outline-none transition-all"
                                    placeholder="e.g. Ferrari 296 GT3, Red Bull RB19..."
                                />
                            </div>

                            {/* Rig */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-white/80 uppercase tracking-wide">
                                    <Monitor className="w-4 h-4 text-[#2D9E49]" /> Preferred Rig
                                </label>
                                <input
                                    type="text"
                                    name="favRig"
                                    value={formData.favRig}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-[#2D9E49] focus:ring-1 focus:ring-[#2D9E49] outline-none transition-all"
                                    placeholder="e.g. Motion Lab, Static, VR..."
                                />
                            </div>
                        </div>

                        {/* Settings */}
                        <div className="space-y-2 pt-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-white/80 uppercase tracking-wide">
                                <Settings className="w-4 h-4 text-white/60" /> Force Feedback / Settings Notes
                            </label>
                            <input
                                type="text"
                                name="settings"
                                value={formData.settings}
                                onChange={handleChange}
                                className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus:border-[#2D9E49] focus:ring-1 focus:ring-[#2D9E49] outline-none transition-all"
                                placeholder="e.g. Prefer stiff brake pedal, max FFB..."
                            />
                        </div>

                        <div className="pt-6">
                            <button
                                type="submit"
                                disabled={loading}
                                className="group relative w-full flex justify-center py-4 px-4 border border-transparent text-sm font-display uppercase tracking-widest font-bold rounded-full text-black bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2D9E49] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <span className="flex items-center gap-2">Saving Profile...</span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        Enter Pit Lane <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                    </span>
                                )}
                            </button>
                            <p className="text-center text-white/40 text-xs mt-4">
                                You can update these details anytime from your dashboard.
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default OnboardingPage;
