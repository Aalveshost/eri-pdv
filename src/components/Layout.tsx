import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Layers,
  Settings,
  LogOut,
  Clock,
  History,
  Eye,
  EyeOff,
  Lock
} from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { setPdvShouldFocusOnMount, pdvNavigateAwayInterceptor, pdvModalOpen } from "../pages/PDV";
import { setConfigShouldFocusOnMount } from "../pages/Configuracoes";
import { setProducaoShouldFocusOnMount } from "../pages/Lotes";
import { cn } from "../utils/cn";
import {
  DEFAULT_ACCESS_PASSWORD,
  canUnlockWithAccessPassword,
  normalizeStoredAccessPassword,
  sanitizeAccessPassword,
} from "../utils/accessPassword";

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { db } = useDatabase();
  const [nomeLoja, setNomeLoja] = useState("Salgados Pro");
  const [isSidebarFocused, setIsSidebarFocused] = useState(false);
  const sidebarFocusedRef = useRef(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [correctPassword, setCorrectPassword] = useState(DEFAULT_ACCESS_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const MASTER_PASSWORD = "1973";


  useEffect(() => {
    if (!db) return;
    db.select("SELECT nome_loja, senha FROM configuracoes WHERE id = 1")
      .then((res: unknown) => { 
        const rows = res as any[]; 
        if (rows.length > 0) {
          setNomeLoja(rows[0].nome_loja || "Salgados Pro"); 
          setCorrectPassword(normalizeStoredAccessPassword(rows[0].senha));
        }
      })
      .catch(() => {});
  }, [db, location.pathname, showPasswordModal]); 

  useEffect(() => {
    if (location.pathname === "/") {
      setIsUnlocked(false);
    }
  }, [location.pathname]);

  const handleProtectedNavigation = (path: string) => {
    if (path === "/") {
      setIsUnlocked(false);
      navigate("/");
      return;
    }
    
    if (!isUnlocked) {
      setPendingPath(path);
      setShowPasswordModal(true);
      setPasswordInput("");
      setPasswordError(false);
      return;
    }

    navigate(path);
  };

  useEffect(() => {
    if (showPasswordModal) {
      setTimeout(() => passwordInputRef.current?.focus(), 50);
    }
  }, [showPasswordModal]);

  const verifyPassword = (input: string) => {
    if (canUnlockWithAccessPassword(input, correctPassword, MASTER_PASSWORD)) {
      setIsUnlocked(true);
      setShowPasswordModal(false);
      if (pendingPath) navigate(pendingPath);
      setPendingPath(null);
    } else {
      setPasswordError(true);
      setPasswordInput("");
      setTimeout(() => passwordInputRef.current?.focus(), 10);
    }
  };

  const menuItems = [
    { icon: ShoppingCart, label: "VENDA", path: "/" },
    { icon: LayoutDashboard, label: "DASHBOARD", path: "/dashboard" },
    { icon: Package, label: "PRODUTOS", path: "/produtos" },
    { icon: Layers, label: "PRODUÇÃO", path: "/lotes" },
    { icon: Clock, label: "A PRAZO", path: "/aprazo" },
    { icon: History, label: "HISTORICO", path: "/historico" },
    { icon: Settings, label: "CONFIG", path: "/config" },
  ];

  useEffect(() => {
    const handleArrows = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.body.hasAttribute('data-esc-handled')) return;

      const isAnyModalOpen = pdvModalOpen || !!document.querySelector('.fixed.inset-0[class*="z-"]');
      
      if (isAnyModalOpen) {
        if (e.key === "Escape" && !document.querySelector('.fixed.inset-0.z-\\[100\\]') && !document.querySelector('.fixed.inset-0.z-\\[300\\]')) {
          // Permite passar
        } else {
          return; 
        }
      }
      
      const activeEl = document.activeElement as HTMLElement;
      const isInput = activeEl && ["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName);
      const hasTabIndex = activeEl && activeEl.tabIndex >= 0;
      const isInteractive = isInput || (activeEl && activeEl.tagName === "BUTTON") || hasTabIndex;
      
      if (e.key === "Escape") {
        e.preventDefault();

        if (isInput) {
          (activeEl as HTMLElement).blur();
        } else {
          const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
          if (activeSidebarLink) {
              activeSidebarLink.focus();
          }
        }
        return;
      }

      // If we are in the main content area (not sidebar) and pressing arrows,
      // prevent global sidebar navigation to avoid accidental page changes.
      const isSidebarFocused = sidebarFocusedRef.current;
      if (!isSidebarFocused) {
        if (isInteractive) return;
        
        // Extra guard for PDV page: if focus is anywhere in the main container,
        // arrows should stay local to the page logic.
        const mainContent = document.querySelector('main');
        if (mainContent && mainContent.contains(activeEl)) return;
      }

      if (!sidebarFocusedRef.current && !isInteractive) {
        const idx = menuItems.findIndex(m => m.path === location.pathname);
        const goNext = e.key === "ArrowDown";
        const goPrev = e.key === "ArrowUp";

        if (goNext && idx >= 0 && idx < menuItems.length - 1) {
          e.preventDefault();
          handleProtectedNavigation(menuItems[idx + 1].path);
          return;
        }
        if (goPrev && idx > 0) {
          e.preventDefault();
          handleProtectedNavigation(menuItems[idx - 1].path);
          return;
        }
      }

      if (sidebarFocusedRef.current) {
        const links = Array.from(document.querySelectorAll('aside nav a')) as HTMLElement[];
        const idx = links.indexOf(document.activeElement as HTMLElement);

        const goNext = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey);
        const goPrev = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey);

        if (goNext) {
          e.preventDefault();
          if (idx >= 0 && idx < links.length - 1) {
            const nextPath = menuItems[idx + 1].path;
            if (location.pathname === '/' && pdvNavigateAwayInterceptor?.()) return;
            handleProtectedNavigation(nextPath);
            setTimeout(() => (document.querySelectorAll('aside nav a')[idx + 1] as HTMLElement)?.focus(), 0);
          }
        }

        if (goPrev) {
          e.preventDefault();
          if (idx > 0) {
            const prevPath = menuItems[idx - 1].path;
            if (location.pathname === '/' && pdvNavigateAwayInterceptor?.()) return;
            handleProtectedNavigation(prevPath);
            setTimeout(() => (document.querySelectorAll('aside nav a')[idx - 1] as HTMLElement)?.focus(), 0);
          }
        }

        if (e.key === "Enter") {
          e.preventDefault();
          const activeLink = document.activeElement as HTMLAnchorElement;
          const href = activeLink?.getAttribute('href');
          if (location.pathname === '/' && href !== '/' && pdvNavigateAwayInterceptor?.()) return;
          
          activeLink?.blur();

          if (href === '/') {
            setPdvShouldFocusOnMount(true);
            navigate("/");
            setTimeout(() => {
              const main = document.querySelector('main');
              const dateInput = main?.querySelector('input[type="text"]') as HTMLElement;
              const preferred = main?.querySelector('[data-autofocus]') as HTMLElement;
              const firstFocusable = main?.querySelector('input, button, select, [tabindex]:not([tabindex="-1"])') as HTMLElement;
              
              if (dateInput) {
                dateInput.focus();
                if (dateInput instanceof HTMLInputElement) {
                  dateInput.setSelectionRange(0, 0);
                }
              }
              else if (preferred) preferred.focus();
              else if (firstFocusable) firstFocusable.focus();
            }, 50);
          } else if (href) {
            if (href === '/config') {
              if (location.pathname === '/config') {
                const input = document.querySelector('input[name="nome_loja"]') as HTMLInputElement;
                if (input) {
                  input.focus();
                  input.setSelectionRange(input.value.length, input.value.length);
                }
              } else {
                setConfigShouldFocusOnMount(true);
              }
            }
            if (href === '/lotes') {
              if (location.pathname === '/lotes') {
                const firstRow = document.querySelector('tbody tr[tabindex="0"]') as HTMLElement;
                if (firstRow) {
                  firstRow.focus();
                } else {
                  document.getElementById('btn-registrar')?.focus();
                }
              } else {
                setProducaoShouldFocusOnMount(true);
              }
            }
            handleProtectedNavigation(href);
          }
        }
        return;
      }
    };
    const handleFocus = () => {
      const focused = document.activeElement?.closest('aside') !== null;
      setIsSidebarFocused(focused);
      sidebarFocusedRef.current = focused;
    };
    window.addEventListener("keydown", handleArrows, true);
    window.addEventListener("focusin", handleFocus);
    return () => {
      window.removeEventListener("keydown", handleArrows, true);
      window.removeEventListener("focusin", handleFocus);
    };
  }, [location.pathname, navigate, isUnlocked]);

  return (
    <div className="flex h-screen w-screen bg-background text-white overflow-hidden font-sans selection:bg-luxury-orange/30">
      <aside className="w-56 border-r border-white/5 bg-black/20 flex flex-col p-4 shrink-0 relative z-20">
        <div className="flex items-center gap-3 mb-4 px-2">
          <div className="w-10 h-10 bg-luxury-orange rounded-xl flex items-center justify-center shadow-lg shadow-luxury-orange/20 shrink-0">
            <ShoppingCart className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent truncate">
            {nomeLoja}
          </h1>
        </div>


        <nav className="flex-1 space-y-2">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={e => {
                e.preventDefault();
                if (location.pathname === '/' && item.path !== '/' && pdvNavigateAwayInterceptor?.()) {
                  return;
                }
                if (item.path === '/config') {
                  setConfigShouldFocusOnMount(true);
                }
                if (item.path === '/lotes') {
                  setProducaoShouldFocusOnMount(true);
                }
                handleProtectedNavigation(item.path);
              }}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all outline-none",
                location.pathname === item.path
                  ? "bg-luxury-orange text-black font-bold shadow-lg shadow-luxury-orange/20"
                  : "text-white/40 hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon size={20} className={cn(
                "transition-transform group-hover:scale-110",
                location.pathname === item.path ? "text-white" : "text-white/40 group-hover:text-white"
              )} />
              <span className="font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5 opacity-20 pointer-events-none">
          <div className="flex items-center gap-3 px-4 py-3">
             <Lock size={16} />
             <span className="text-xs font-bold uppercase tracking-widest">Sistema Travado</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden bg-luxury-gradient p-8 relative">
        {/* Background Gradients - constrained with overflow-hidden on parent */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-luxury-orange/5 blur-[120px] rounded-full -mr-64 -mt-64 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-luxury-orange/5 blur-[120px] rounded-full -ml-64 -mb-64 pointer-events-none" />
        
        <div className="relative z-10 w-full h-full">
          {children}
        </div>

        {/* Password Modal */}
        {showPasswordModal && (
          <div 
            className="fixed inset-0 z-[400] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
            onClick={() => {
              setShowPasswordModal(false);
              setPendingPath(null);
            }}
          >
            <div 
              className="glass-card w-full max-w-sm p-8 border-luxury-orange/20 shadow-2xl"
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  passwordInputRef.current?.focus();
                  const val = passwordInputRef.current?.value || "";
                  passwordInputRef.current?.setSelectionRange(val.length, val.length);
                }
              }}
            >
              <div className="flex flex-col items-center text-center mb-8">
                <div className="w-16 h-16 bg-luxury-orange/10 rounded-full flex items-center justify-center mb-4 border border-luxury-orange/20">
                  <Lock className="text-luxury-orange" size={32} />
                </div>
                <h3 className="text-2xl font-black italic text-white uppercase tracking-tighter">Acesso Restrito</h3>
                <p className="text-white/40 text-sm mt-1">Insira a senha para acessar esta área.</p>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <input
                    ref={passwordInputRef}
                    autoFocus
                    type="password"
                    maxLength={4}
                    className={cn(
                      "luxury-input w-full h-16 text-center text-3xl font-black tracking-[1em] transition-all",
                      passwordError ? "border-red-500/50 bg-red-500/5 ring-4 ring-red-500/10 text-red-500" : "text-white"
                    )}
                    placeholder="****"
                    value={passwordInput}
                    onChange={e => { 
                      const val = sanitizeAccessPassword(e.target.value);
                      setPasswordError(false); 
                      setPasswordInput(val);
                      if (val.length === 4) {
                        verifyPassword(val);
                      }
                    }}
                    onKeyDown={e => { 
                      const isAlphaNumeric = /^[a-zA-Z0-9]$/.test(e.key);
                      const isControl = ['Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'Delete'].includes(e.key);

                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                        passwordInputRef.current?.focus();
                        const val = passwordInputRef.current?.value || "";
                        passwordInputRef.current?.setSelectionRange(val.length, val.length);
                        return;
                      }

                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          
                          const targetPath = pendingPath;
                          setShowPasswordModal(false);
                          setPendingPath(null);
                          
                          // Smart focus return
                          setTimeout(() => {
                            if (location.pathname === '/') {
                              // If we are in PDV, focus the date input
                              const dateInput = document.getElementById('header-date-input') as HTMLInputElement;
                              if (dateInput) {
                                dateInput.focus();
                                // Double-tap to ensure selection range is applied after focus
                                setTimeout(() => {
                                  dateInput.setSelectionRange(0, 0);
                                }, 10);
                              }
                            } else {
                              // Standard behavior for other pages
                              const links = Array.from(document.querySelectorAll('aside nav a')) as HTMLElement[];
                              const menuIdx = menuItems.findIndex(m => m.path === targetPath);
                              const prevIdx = Math.max(0, menuIdx - 1);
                              links[prevIdx]?.focus();
                            }
                          }, 50);
                          return;
                        }

                      if (!isAlphaNumeric && !isControl) {
                        e.preventDefault();
                      }
                    }}
                    onBlur={e => {
                      if (showPasswordModal) {
                        setTimeout(() => e.target.focus(), 0);
                      }
                    }}
                  />
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20">
                    <Lock size={18} />
                  </div>
                </div>

                {passwordError && (
                  <p className="text-red-400 text-xs font-bold text-center uppercase tracking-[0.2em] animate-pulse">Senha Incorreta</p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
