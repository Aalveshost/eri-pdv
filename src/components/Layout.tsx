import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Layers,
  Settings,
  LogOut,
  Clock,
  History
} from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { setPdvShouldFocusOnMount, pdvNavigateAwayInterceptor, pdvModalOpen } from "../pages/PDV";
import { cn } from "../utils/cn";

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { db } = useDatabase();
  const [nomeLoja, setNomeLoja] = useState("Salgados Pro");
  const [isSidebarFocused, setIsSidebarFocused] = useState(false);


  useEffect(() => {
    if (!db) return;
    db.select("SELECT nome_loja FROM configuracoes WHERE id = 1")
      .then((res: unknown) => { const rows = res as any[]; if (rows.length > 0) setNomeLoja(rows[0].nome_loja || "Salgados Pro"); })
      .catch(() => {});
  }, [db, location.pathname]); // re-read on every page change so it updates after saving

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

      // Detect if ANY modal is open (PDV or generic Modal)
      const isAnyModalOpen = pdvModalOpen || !!document.querySelector('.fixed.inset-0.z-\\[100\\]') || !!document.querySelector('.fixed.inset-0.z-\\[300\\]');
      
      if (isAnyModalOpen) {
        // If it's a modal, we only allow global ESC if not handled locally
        if (e.key === "Escape" && !document.querySelector('.fixed.inset-0.z-\\[100\\]') && !document.querySelector('.fixed.inset-0.z-\\[300\\]')) {
          // fallback
        } else {
          return; 
        }
      }

      const isSidebarFocused = document.activeElement?.closest('aside') !== null;
      const isMainFocused = document.activeElement?.closest('main') !== null;

      // Don't intercept keys while user is typing in an input inside main
      if (!isSidebarFocused && ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;

      // ESC fallback ou ativação da sidebar se foco perdido (/aprazo gerencia isso internamente)
      if (!isSidebarFocused && !isMainFocused && e.key && location.pathname !== '/aprazo') {
        if (["Escape", "ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
            activeSidebarLink?.focus();
            return;
        }
      }

      // Logica da Sidebar (Quando foco esta na esquerda)
      if (isSidebarFocused) {
        const links = Array.from(document.querySelectorAll('aside nav a')) as HTMLElement[];
        const idx = links.indexOf(document.activeElement as HTMLElement);

        const goNext = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey);
        const goPrev = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey);

        if (goNext) {
          e.preventDefault();
          if (idx >= 0 && idx < links.length - 1) {
            const nextPath = menuItems[idx + 1].path;
            if (location.pathname === '/pdv' && pdvNavigateAwayInterceptor?.()) return;
            navigate(nextPath);
            setTimeout(() => (document.querySelectorAll('aside nav a')[idx + 1] as HTMLElement)?.focus(), 0);
          }
        }

        if (goPrev) {
          e.preventDefault();
          if (idx > 0) {
            const prevPath = menuItems[idx - 1].path;
            if (location.pathname === '/pdv' && pdvNavigateAwayInterceptor?.()) return;
            navigate(prevPath);
            setTimeout(() => (document.querySelectorAll('aside nav a')[idx - 1] as HTMLElement)?.focus(), 0);
          }
        }

        if (e.key === "Enter") {
          e.preventDefault();
          const activeLink = document.activeElement as HTMLAnchorElement;
          const href = activeLink?.getAttribute('href');
          if (location.pathname === '/' && href !== '/' && pdvNavigateAwayInterceptor?.()) return;
          
          if (href === '/') {
            setPdvShouldFocusOnMount(true);
            setTimeout(() => {
              const main = document.querySelector('main');
              // Try to focus date input or search input
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
          } else if (href === '/lotes') {
            setTimeout(() => {
              const card = document.getElementById('card-0');
              if (card) card.focus();
              else {
                const dateInput = document.getElementById('date-input');
                if (dateInput) dateInput.focus();
              }
            }, 50);
          }
        }
        return;
      }

      // Lógica do Main Content (Quando foco esta na direita)
      // /aprazo gerencia seu próprio ESC internamente
      const isAprazo = location.pathname === '/aprazo';
      if (isMainFocused && e.key === "Escape" && !isAprazo) {
        if (location.pathname === '/pdv' && pdvNavigateAwayInterceptor?.()) {
          return; // PDV showed its own confirm modal
        }

        e.preventDefault();
        const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
        if (activeSidebarLink) {
            (document.activeElement as HTMLElement)?.blur();
            activeSidebarLink.focus();
        }
      }
    };
    const handleFocus = () => setIsSidebarFocused(document.activeElement?.closest('aside') !== null);
    window.addEventListener("keydown", handleArrows, true);
    window.addEventListener("focusin", handleFocus);
    return () => {
      window.removeEventListener("keydown", handleArrows, true);
      window.removeEventListener("focusin", handleFocus);
    };
  }, [location.pathname, navigate]);

  return (
    <div className="flex h-screen w-screen bg-background text-white overflow-hidden font-sans selection:bg-luxury-orange/30">
      {/* Sidebar */}
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
                if (location.pathname === '/pdv' && item.path !== '/pdv' && pdvNavigateAwayInterceptor?.()) {
                  e.preventDefault();
                }
              }}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl group focus:outline-none no-underline transition-all duration-200",
                location.pathname === item.path
                  ? isSidebarFocused && document.activeElement?.getAttribute('href') === item.path
                    ? "bg-luxury-orange text-white shadow-lg shadow-luxury-orange/20" // Img 2: Active + Focused
                    : "border border-luxury-orange/30 bg-luxury-orange/5 text-luxury-orange shadow-sm" // Img 3: Active + Not Focused
                  : "text-white/40 hover:bg-white/5 hover:text-white focus:bg-white/10 focus:text-white"
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

        <div className="mt-auto pt-6 border-t border-white/5">
          <button className="flex items-center gap-3 px-4 py-3 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-all w-full">
            <LogOut size={20} />
            <span className="font-medium">Sair</span>
          </button>
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
      </main>
    </div>
  );
}
