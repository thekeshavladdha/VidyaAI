import React, { useState } from 'react';
import { loginUser, registerUser, type ApiUser } from './api';

interface AuthPageProps {
  onSuccess: (user: ApiUser, isGuest?: boolean) => void;
  onContinueAsGuest: () => void;
}

export function AuthPage({ onSuccess, onContinueAsGuest }: AuthPageProps) {
  const [activeTab, setActiveTab] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('vidya_theme') as 'dark' | 'light';
    const active = saved || 'dark';
    if (active === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    return active;
  });

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('vidya_theme', next);
    if (next === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlert(null);

    if (!email.trim() || !password) {
      setAlert({ message: 'Please enter both email and password.', type: 'error' });
      return;
    }

    setLoading(true);

    try {
      if (activeTab === 'signUp') {
        const res = await registerUser(email.trim(), password, fullName.trim());
        if (res.error) throw new Error(res.error);
        if (res.user) {
          setAlert({ message: 'Account created successfully.', type: 'success' });
          setTimeout(() => onSuccess(res.user!, res.isDemo), 600);
        }
      } else {
        const res = await loginUser(email.trim(), password);
        if (res.error) throw new Error(res.error);
        if (res.user) {
          setAlert({ message: 'Signed in successfully.', type: 'success' });
          setTimeout(() => onSuccess(res.user!, res.isDemo), 500);
        }
      }
    } catch (err: any) {
      setAlert({ message: err.message || 'Authentication failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const isLight = theme === 'light';

  return (
    <div className={`min-h-screen ${theme} ${isLight ? 'bg-[#f0f4f9] text-[#1f1f1f]' : 'bg-[#0f172a] text-[#f8fafc]'} flex items-center justify-center p-4 font-sans relative`}>
      <div className={`w-full max-w-md ${isLight ? 'bg-white border-[#e3e3e3] shadow-lg' : 'bg-[#1e293b] border-[#334155] shadow-md'} border rounded-xl p-8 relative`}>
        
        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          className={`absolute top-4 right-4 p-2 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1.5 ${
            isLight
              ? 'bg-[#f0f4f9] border-[#e3e3e3] text-[#444746] hover:bg-[#e9eef6]'
              : 'bg-[#0f172a] border-[#334155] text-[#cbd5e1] hover:bg-[#334155]'
          }`}
          title="Toggle Dark / Light Theme"
        >
          {isLight ? '🌙 Dark' : '☀️ Light'}
        </button>

        {/* Header Branding */}
        <div className="text-center mb-8">
          <h1 className={`text-2xl font-bold tracking-tight ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`}>
            VidyaAI
          </h1>
          <p className={`text-xs mt-1 ${isLight ? 'text-[#444746]' : 'text-[#94a3b8]'}`}>
            Learning System Portal
          </p>
        </div>

        {/* Tab Selector */}
        <div className={`grid grid-cols-2 p-1 rounded-lg mb-6 border ${
          isLight ? 'bg-[#f0f4f9] border-[#e3e3e3]' : 'bg-[#0f172a] border-[#334155]'
        }`}>
          <button
            type="button"
            onClick={() => { setActiveTab('signIn'); setAlert(null); }}
            className={`py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'signIn'
                ? isLight ? 'bg-[#d3e3fd] text-[#041e49] font-semibold' : 'bg-[#334155] text-white'
                : isLight ? 'text-[#444746] hover:text-[#1f1f1f]' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('signUp'); setAlert(null); }}
            className={`py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'signUp'
                ? isLight ? 'bg-[#d3e3fd] text-[#041e49] font-semibold' : 'bg-[#334155] text-white'
                : isLight ? 'text-[#444746] hover:text-[#1f1f1f]' : 'text-[#94a3b8] hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Alert Notification */}
        {alert && (
          <div
            className={`p-3 rounded-lg text-xs leading-relaxed mb-5 border ${
              alert.type === 'error'
                ? isLight ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-950/40 border-red-800 text-red-300'
                : isLight ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-slate-800 border-slate-600 text-slate-200'
            }`}
          >
            {alert.message}
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {activeTab === 'signUp' && (
            <div>
              <label className={`block text-xs font-medium mb-1 ${isLight ? 'text-[#444746]' : 'text-[#94a3b8]'}`}>
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full Name"
                className={`w-full rounded-lg px-3.5 py-2 text-xs border outline-none transition-colors ${
                  isLight
                    ? 'bg-white border-[#c4c7c5] text-[#1f1f1f] focus:border-[#0b57d0] placeholder-[#747775]'
                    : 'bg-[#0f172a] border-[#334155] text-white focus:border-blue-500 placeholder-[#64748b]'
                }`}
              />
            </div>
          )}

          <div>
            <label className={`block text-xs font-medium mb-1 ${isLight ? 'text-[#444746]' : 'text-[#94a3b8]'}`}>
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className={`w-full rounded-lg px-3.5 py-2 text-xs border outline-none transition-colors ${
                isLight
                  ? 'bg-white border-[#c4c7c5] text-[#1f1f1f] focus:border-[#0b57d0] placeholder-[#747775]'
                  : 'bg-[#0f172a] border-[#334155] text-white focus:border-blue-500 placeholder-[#64748b]'
              }`}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${isLight ? 'text-[#444746]' : 'text-[#94a3b8]'}`}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`w-full rounded-lg px-3.5 py-2 pr-10 text-xs border outline-none transition-colors ${
                  isLight
                    ? 'bg-white border-[#c4c7c5] text-[#1f1f1f] focus:border-[#0b57d0] placeholder-[#747775]'
                    : 'bg-[#0f172a] border-[#334155] text-white focus:border-blue-500 placeholder-[#64748b]'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${
                  isLight ? 'text-[#444746] hover:text-[#1f1f1f]' : 'text-[#64748b] hover:text-white'
                }`}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full text-white font-medium text-xs py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2 ${
              isLight ? 'bg-[#0b57d0] hover:bg-[#0842a0]' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <span>{activeTab === 'signIn' ? 'Sign In' : 'Create Account'}</span>
          </button>
        </form>

        <div className="relative my-5 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className={`w-full border-t ${isLight ? 'border-[#e3e3e3]' : 'border-[#334155]'}`} />
          </div>
          <span className={`relative px-3 text-[11px] ${isLight ? 'bg-white text-[#747775]' : 'bg-[#1e293b] text-[#64748b]'}`}>
            OR
          </span>
        </div>

        {/* Demo Mode Action */}
        <button
          type="button"
          onClick={onContinueAsGuest}
          className={`w-full text-xs font-medium py-2 rounded-lg transition-colors text-center border ${
            isLight
              ? 'bg-[#f0f4f9] hover:bg-[#e9eef6] border-[#e3e3e3] text-[#1f1f1f]'
              : 'bg-[#0f172a] hover:bg-[#334155] border-[#334155] text-[#cbd5e1]'
          }`}
        >
          Continue as Guest Mode
        </button>
      </div>
    </div>
  );
}
