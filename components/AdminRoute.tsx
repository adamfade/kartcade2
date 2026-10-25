import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/** Signed-in admins only; everyone else goes to login or back to their dashboard. */
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentUser, isAdmin, loading } = useAuth();
    const location = useLocation();
    if (loading) {
        return (
            <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#2D9E49]"></div>
            </div>
        );
    }
    if (!currentUser) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    if (!isAdmin) return <Navigate to="/dashboard" replace />;
    return <>{children}</>;
};

export default AdminRoute;
