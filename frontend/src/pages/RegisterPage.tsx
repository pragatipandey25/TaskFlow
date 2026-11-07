import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '@taskflow/shared';
import { Lock, Mail, User, Shield, AlertTriangle, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.DEVELOPER);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Real-time password requirement indicators
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
  const isPasswordValid = hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isPasswordValid) {
      setErrorMessage('Please satisfy all password complexity requirements');
      return;
    }

    setLoading(true);
    try {
      await register({ name, email, password, role });
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to register account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-600 mx-auto flex items-center justify-center font-black text-xl text-white shadow-xl shadow-indigo-600/30">
          TF
        </div>
        <h2 className="mt-6 text-3xl font-extrabold text-white tracking-tight">Create your account</h2>
        <p className="mt-2 text-sm text-slate-400">
          Join the TaskFlow distributed computing platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 border border-slate-800 py-8 px-4 shadow-2xl sm:rounded-xl sm:px-10">
          {errorMessage && (
            <div className="mb-6 p-4 bg-red-950/50 border border-red-800/50 rounded-lg flex items-center space-x-3 text-red-300">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <div className="text-sm font-medium">{errorMessage}</div>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Full Name
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <User className="w-5 h-5" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                  required
                  className="block w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Work Email
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-5 h-5" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ada@company.com"
                  required
                  className="block w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Initial Role (RBAC)
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Shield className="w-5 h-5" />
                </div>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="block w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                >
                  <option value={UserRole.DEVELOPER}>Developer (Full queue & job management)</option>
                  <option value={UserRole.VIEWER}>Viewer (Read-only telemetry access)</option>
                  <option value={UserRole.ADMIN}>Admin (System administration)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="block w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
              </div>

              {/* Password strength checklist */}
              <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] text-slate-400">
                <span className={`flex items-center space-x-1.5 ${hasMinLength ? 'text-emerald-400' : ''}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>8+ characters</span>
                </span>
                <span className={`flex items-center space-x-1.5 ${hasUpper ? 'text-emerald-400' : ''}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Uppercase letter</span>
                </span>
                <span className={`flex items-center space-x-1.5 ${hasLower ? 'text-emerald-400' : ''}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Lowercase letter</span>
                </span>
                <span className={`flex items-center space-x-1.5 ${hasNumber && hasSpecial ? 'text-emerald-400' : ''}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Number & symbol</span>
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 border border-transparent rounded-lg shadow-lg shadow-indigo-600/30 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-400">
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-indigo-400 hover:text-indigo-300">
              Sign in to your account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
