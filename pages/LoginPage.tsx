import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Mail, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const LoginPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { login, loginWithGoogle } = useAuth();

    // Get the page user was trying to access
    const from = (location.state as any)?.from || '/dashboard';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            setLoading(true);
            await login(email, password);
            navigate(from, { replace: true });
        } catch (err: any) {
            if (err.code === 'auth/user-not-found') {
                setError('No account found with this email.');
            } else if (err.code === 'auth/wrong-password') {
                setError('Incorrect password.');
            } else if (err.code === 'auth/invalid-email') {
                setError('Please enter a valid email address.');
            } else {
                setError('Failed to sign in. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            setLoading(true);
            await loginWithGoogle();
            navigate(from, { replace: true });
        } catch (err: any) {
            setError('Failed to sign in with Google. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative bg-[#0A0A0A] min-h-screen pt-20 md:pt-24 pb-12">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden opacity-10">
                <div className="absolute top-0 left-1/4 w-32 h-full bg-gradient-to-b from-[#2D9E49] to-transparent transform -skew-x-12"></div>
                <div className="absolute top-0 left-1/3 w-16 h-full bg-gradient-to-b from-white to-transparent transform -skew-x-12"></div>
                <div className="absolute top-0 left-[40%] w-32 h-full bg-gradient-to-b from-[#D42428] to-transparent transform -skew-x-12"></div>
            </div>

            <div className="container mx-auto px-4 md:px-6 lg:px-12 relative z-10">
                <div className="max-w-md mx-auto">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <span className="font-mono text-[#2D9E49] tracking-widest uppercase text-xs md:text-sm mb-4 block">
                            Welcome Back
                        </span>
                        <h1 className="font-display text-3xl md:text-4xl font-bold uppercase text-white mb-2">
                            Sign In to<br />
                            <span className="text-[#D42428]">Kartcade</span>
                        </h1>
                        <p className="text-white/60 font-sans text-sm">
                            {(location.state as any)?.reason === 'booking'
                                ? 'Your time is saved. Sign in, or create a free driver profile, to finish booking.'
                                : 'Access your Driver Profile and book sessions'}
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
                            onClick={handleGoogleSignIn}
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
                            {/* Email */}
                            <div>
                                <label className="block text-white/60 text-sm mb-2">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="w-full pl-12 pr-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-[#2D9E49] focus:outline-none transition-colors"
                                        placeholder="you@email.com"
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
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
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

                            {/* Forgot Password */}
                            <div className="text-right">
                                <Link to="/forgot-password" className="text-[#2D9E49] text-sm hover:underline">
                                    Forgot password?
                                </Link>
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full mt-2 py-4 bg-[#D42428] text-white rounded-full font-display uppercase tracking-widest font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#b91f22] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Signing In...' : (
                                    <>
                                        Sign In
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Sign Up Link */}
                        <p className="text-center text-white/60 text-sm mt-6">
                            Don't have an account?{' '}
                            <Link to="/signup" className="text-[#2D9E49] hover:underline">
                                Create Driver Profile
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
